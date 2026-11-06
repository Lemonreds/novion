import { convertFileSrc } from "@tauri-apps/api/core";
import {
  api,
  errorMessage,
  getRoot,
  type ExportFormat,
  type ExportResult,
} from "@/lib/tauri";
import { saveQueue } from "@/lib/save-scheduler";
import { useUi } from "@/store/ui";

/**
 * Export entry points shared by the document menu, the ⌘⇧P palette and the
 * storage settings page — one implementation, one message format, one place
 * that knows how to reveal the result in Finder.
 */

const LABELS: Record<ExportFormat, string> = {
  md: "Markdown",
  html: "HTML",
  json: "JSON",
};

/** `~/Downloads/Novion/x.md` → `Novion/x.md`, short enough for a toast. */
export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function reveal(path: string) {
  void api.revealPath(path).catch((err) => {
    useUi.getState().notify(errorMessage(err), { tone: "error" });
  });
}

function announce(path: string, text: string) {
  useUi.getState().notify(text, {
    tone: "success",
    actionLabel: "在 Finder 中显示",
    action: () => reveal(path),
  });
}

function announceError(err: unknown) {
  useUi.getState().notify(errorMessage(err), { tone: "error", timeout: 7000 });
}

/**
 * Exports one document. Pending autosave work is flushed first, otherwise the
 * file on disk could be one edit behind what the user is looking at.
 */
export async function exportDoc(
  docId: string,
  format: ExportFormat,
): Promise<ExportResult | null> {
  try {
    await saveQueue.flush(`doc:${docId}`);
    const result = await api.exportDoc(docId, format);
    announce(result.path, `${LABELS[format]} 已导出到 ${shortPath(result.path)}`);
    return result;
  } catch (err) {
    announceError(err);
    return null;
  }
}

/** Full backup: raw JSON copy + Markdown mirror of the whole workspace. */
export async function exportWorkspace(): Promise<ExportResult | null> {
  try {
    await saveQueue.flushAll();
    const result = await api.exportWorkspace();
    announce(
      result.path,
      `备份完成：${result.files} 个文件（${formatBytes(result.bytes)}）`,
    );
    return result;
  } catch (err) {
    announceError(err);
    return null;
  }
}

/**
 * Prints a document through the system print dialog, which is also where macOS
 * offers "存储为 PDF". Rendering happens in WebKit itself, so the PDF has real
 * text (selectable, searchable) and correctly embedded CJK fonts — something a
 * hand-written PDF export cannot promise.
 *
 * The frame is removed on `afterprint`; a user who cancels the dialog leaves
 * nothing behind.
 */
export async function printDoc(docId: string): Promise<void> {
  try {
    await saveQueue.flush(`doc:${docId}`);
    // images inside the frame have to come through the asset protocol: a
    // `file://` URL is blocked from the webview's own origin
    const root = await getRoot();
    const assetBase = convertFileSrc(`${root}/assets/`);
    const html = await api.renderDocHtml(docId, assetBase);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:820px;height:1100px;border:0;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(frame);

    const cleanup = () => {
      window.setTimeout(() => frame.remove(), 500);
    };
    frame.addEventListener("load", () => {
      const win = frame.contentWindow;
      if (!win || typeof win.print !== "function") {
        // no print support in this webview: hand over the HTML instead of
        // failing silently
        cleanup();
        useUi.getState().notify("当前环境不支持直接打印，已改为导出 HTML（可在浏览器中 ⌘P）", {
          tone: "info",
          timeout: 8000,
        });
        void exportDoc(docId, "html");
        return;
      }
      win.addEventListener("afterprint", cleanup, { once: true });
      // the load event fires before images decode; printing too early would
      // leave empty boxes where the screenshots are
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          cleanup();
        }
      }, 260);
    });
    frame.srcdoc = html;
  } catch (err) {
    announceError(err);
  }
}
