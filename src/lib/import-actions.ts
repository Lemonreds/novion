import { api, errorMessage, type ImportStats } from "@/lib/tauri";
import { saveQueue } from "@/lib/save-scheduler";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

/**
 * Markdown import entry points.
 *
 * Both paths end in the same place: new folders and documents appended to the
 * workspace, images copied into `assets/`. Nothing is ever overwritten, so an
 * import is always safe to repeat.
 */

function parentForSelection(): string | null {
  const { nodes, selectedId } = useWorkspace.getState();
  const node = selectedId ? nodes[selectedId] : null;
  if (!node || node.builtin) return null;
  return node.kind === "folder" ? node.id : node.parentId;
}

function summarize(stats: ImportStats): string {
  const parts = [`${stats.docs} 篇文档`];
  if (stats.folders > 0) parts.push(`${stats.folders} 个文件夹`);
  if (stats.assets > 0) parts.push(`${stats.assets} 张图片`);
  if (stats.skipped > 0) parts.push(`跳过 ${stats.skipped}`);
  if (stats.failed > 0) parts.push(`失败 ${stats.failed}`);
  return parts.join("，");
}

function report(stats: ImportStats) {
  const ui = useUi.getState();
  if (stats.docs === 0) {
    ui.notify("没有找到可导入的 Markdown 文档", { tone: "info" });
    return;
  }
  const failed = stats.failed > 0;
  ui.notify(`已导入 ${stats.targetName || ""}：${summarize(stats)}`.trim(), {
    tone: failed ? "info" : "success",
    timeout: failed ? 8000 : 5000,
  });
}

/** Picks a folder with the native dialog, then imports everything under it. */
export async function importMarkdownFolder(): Promise<void> {
  try {
    const source = await api.pickImportFolder();
    if (!source) return; // cancelled
    const ui = useUi.getState();
    ui.notify("正在导入 Markdown…", { timeout: 0 });
    const stats = await api.importMarkdown(source, parentForSelection());
    // the tree changed outside the usual CRUD replies: re-read it wholesale
    const ws = await api.ensure();
    useWorkspace.getState().apply(ws);
    report(stats);
  } catch (err) {
    useUi.getState().notify(errorMessage(err), { tone: "error", timeout: 8000 });
  }
}

/**
 * Imports Markdown dropped onto the window. The webview exposes dropped files as
 * `File` objects without a path, so the text is read here and the title comes
 * from the file name.
 */
export async function importDroppedMarkdown(files: File[]): Promise<void> {
  if (!files.length) return;
  await saveQueue.flushAll();
  const parent = parentForSelection();
  let docs = 0;
  const failures: string[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      const stats = await api.importMarkdownText(file.name, text, parent);
      docs += stats.docs;
    } catch (err) {
      failures.push(`${file.name}：${errorMessage(err)}`);
    }
  }
  const ws = await api.ensure();
  useWorkspace.getState().apply(ws);
  const ui = useUi.getState();
  if (docs > 0) {
    ui.notify(`已导入 ${docs} 篇文档`, {
      tone: "success",
      actionLabel: failures.length ? undefined : "打开",
    });
  }
  if (failures.length) {
    ui.notify(failures.slice(0, 3).join("；"), { tone: "error", timeout: 9000 });
  }
}
