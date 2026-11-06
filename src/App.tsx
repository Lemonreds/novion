import { lazy, Suspense, useEffect, useRef } from "react";
import { CheckCircle2, Info, PanelLeft, TriangleAlert, X } from "lucide-react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SearchDialog } from "@/components/SearchDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { useStorage } from "@/store/storage";
import { importDroppedMarkdown } from "@/lib/import-actions";
import { applyTheme, useUi } from "@/store/ui";
import { installLongPressWindowDrag } from "@/lib/window-drag";
import { api } from "@/lib/tauri";

// the editor (tiptap) is a separate chunk; the shell paints first
const DocView = lazy(() => import("@/components/editor/DocView"));
// the command palette and its icon set only load the first time ⌘⇧P is used
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);

export default function App() {
  const init = useWorkspace((s) => s.init);
  const ready = useWorkspace((s) => s.ready);
  // the id of the open document, or null: a scalar selector, so switching
  // between two documents does not re-render the shell for unrelated changes
  const selectedDocId = useWorkspace((s) =>
    s.selectedId && s.nodes[s.selectedId]?.kind === "doc" ? s.selectedId : null,
  );
  const error = useWorkspace((s) => s.error);
  const setError = useWorkspace((s) => s.setError);
  const createDoc = useWorkspace((s) => s.createDoc);
  const theme = useUi((s) => s.theme);
  const notice = useUi((s) => s.notice);
  const dismissNotice = useUi((s) => s.dismissNotice);
  const commandOpen = useUi((s) => s.commandOpen);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const rootPath = useWorkspace((s) => s.rootPath);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void init();
  }, [init]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    const uninstall = installLongPressWindowDrag();
    return uninstall;
  }, []);

  // warm the storage probe once at boot: the settings dialog then opens with
  // zero IPC / state churn during its entrance animation
  useEffect(() => {
    void useStorage.getState().load();
  }, []);

  // global shortcuts (text inputs keep their own behaviour)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const ui = useUi.getState();

      // ⌘F finds inside the open document, ⌘K finds the document itself
      if (key === "f") {
        const state = useWorkspace.getState();
        const openDoc =
          state.selectedId && state.nodes[state.selectedId]?.kind === "doc";
        if (!openDoc) return;
        e.preventDefault();
        ui.setFindOpen(!ui.findOpen);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        ui.setSearchOpen(!ui.searchOpen);
        return;
      }
      // ⌘⇧P is the action palette, plain ⌘P would fight the system print dialog
      if (key === "p" && e.shiftKey) {
        e.preventDefault();
        ui.setCommandOpen(!ui.commandOpen);
        return;
      }
      if (key === "\\") {
        e.preventDefault();
        // ⌘⇧\ collapses the rail, ⌘\ the right-hand outline
        if (e.shiftKey) ui.toggleSidebar();
        else ui.toggleOutline();
        return;
      }
      if (key === ",") {
        e.preventDefault();
        ui.setSettingsOpen(true);
        return;
      }
      if (key === "s") {
        e.preventDefault();
        window.dispatchEvent(new Event("novion:flush"));
        return;
      }
      if (key !== "n") return;
      e.preventDefault();
      const state = useWorkspace.getState();
      const current = state.selectedId ? state.nodes[state.selectedId] : null;
      const parentId = current ? (current.kind === "folder" ? current.id : current.parentId) : null;
      // ⌘⇧N always creates a first-level folder; ⌘N still follows the selection
      if (e.shiftKey) void state.createFolder(null);
      else void state.createDoc(parentId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Another device (through iCloud) can add, rename or remove notes while this
   * window is open. The tree is re-read when `workspace.json` changes; the
   * store's diffing makes an unchanged read a no-op, so our own writes never
   * cause a re-render loop here.
   */
  useEffect(() => {
    let alive = true;
    let stamp = 0;
    const tick = async () => {
      try {
        const next = await api.workspaceStamp();
        if (!alive) return;
        if (stamp === 0) {
          stamp = next;
          return;
        }
        if (next === stamp) return;
        stamp = next;
        const ws = await api.ensure();
        if (alive) useWorkspace.getState().apply(ws);
      } catch {
        /* a transient read failure just waits for the next tick */
      }
    };
    const timer = window.setInterval(() => void tick(), 9000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  /**
   * Dropping `.md` files anywhere imports them; images keep going to the
   * editor's own drop handler. Capture phase + stopPropagation, so a note
   * dropped on the sidebar does not also start a tree drag.
   */
  useEffect(() => {
    const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

    const onDragOver = (event: DragEvent) => {
      const items = Array.from(event.dataTransfer?.items ?? []);
      if (!items.some((item) => item.kind === "file")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      const markdown = files.filter((file) => isMarkdown(file.name));
      if (!markdown.length) return; // images: leave them to the editor
      event.preventDefault();
      event.stopPropagation();
      void importDroppedMarkdown(markdown);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  // a boolean selector: the shell only re-renders when the answer flips, not
  // on every workspace write
  const hasDocs = useWorkspace((s) => Object.keys(s.nodes).length > 0);

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full w-full overflow-hidden bg-background">
        {sidebarOpen && <Sidebar />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* With the rail collapsed there has to be a way back in that does not
              depend on knowing the shortcut. It sits in the title-bar strip so
              it never covers the top of the document — and to the *right* of the
              macOS traffic lights: the overlay title bar puts them at the very
              leading edge, where the button used to end up underneath the native
              close/zoom controls (invisible, and clicking it closed the window). */}
          {!sidebarOpen && (
            <div className="absolute left-[84px] top-[7px] z-30" data-no-window-drag>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={toggleSidebar}
                    aria-label="展开侧边栏"
                    className="rounded-md text-muted-foreground/75 hover:bg-accent hover:text-foreground"
                  >
                    <PanelLeft className="size-4" strokeWidth={1.7} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">展开侧边栏 ⌘⇧\</TooltipContent>
              </Tooltip>
            </div>
          )}
          {!ready ? (
            <div className="mx-auto w-full max-w-[860px] space-y-3 px-8 pt-[52px]">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-[70%]" />
              <Skeleton className="h-4 w-[55%]" />
            </div>
          ) : selectedDocId ? (
            <Suspense
              fallback={
                <div className="mx-auto w-full max-w-[860px] space-y-3 px-8 pt-[52px]">
                  <Skeleton className="h-8 w-56" />
                  <Skeleton className="h-4 w-[70%]" />
                </div>
              }
            >
              <DocView key={`${selectedDocId}:${rootPath}`} docId={selectedDocId} />
            </Suspense>
          ) : (
            <EmptyState
              hasDocs={hasDocs}
              onCreate={() => {
                void createDoc(null);
              }}
            />
          )}
        </main>

        <ConfirmDialog />
        <SearchDialog />
        {commandOpen && (
          <Suspense fallback={null}>
            <CommandPalette />
          </Suspense>
        )}
        <SettingsDialog />

        {/* All transient messages share one top-centred stack: a notice and an
            error can then never overlap, every row is vertically centred, and
            nothing covers the bottom of the document while it is being read. */}
        {(notice || error) && (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
            {notice && (
              <div
                key={notice.id}
                className={cn(
                  "anim-fade pointer-events-auto flex max-w-[min(560px,90vw)] items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-[12.5px] shadow-lg",
                  notice.tone === "error" && "border-destructive/35",
                  notice.tone === "success" && "border-success/35",
                  notice.tone === "info" && "border-border",
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {notice.tone === "error" ? (
                    <TriangleAlert className="size-3.5 text-destructive" />
                  ) : notice.tone === "success" ? (
                    <CheckCircle2 className="size-3.5 text-success" />
                  ) : (
                    <Info className="size-3.5 text-brand" />
                  )}
                </span>
                <span className="min-w-0 flex-1 break-words leading-snug">{notice.text}</span>
                {notice.actionLabel && notice.action && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      notice.action?.();
                      dismissNotice();
                    }}
                  >
                    {notice.actionLabel}
                  </Button>
                )}
                <Button
                  size="iconSm"
                  variant="ghost"
                  onClick={dismissNotice}
                  aria-label="关闭提示"
                  className="-mr-1 shrink-0"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}

            {error && (
              <div className="anim-fade pointer-events-auto flex max-w-[min(560px,90vw)] items-center gap-2 rounded-lg border border-destructive/35 bg-popover px-3 py-2 text-[12.5px] shadow-lg">
                <span className="flex size-4 shrink-0 items-center justify-center text-destructive">
                  <TriangleAlert className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 break-words leading-snug">{error}</span>
                <Button
                  size="iconSm"
                  variant="ghost"
                  onClick={() => setError(null)}
                  aria-label="关闭提示"
                  className="-mr-1 shrink-0"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* window drag strip under the overlay title bar. Kept at z-20 so the
            outline panel (z-30) can sit above it: its header lives in this strip
            and its close button has to stay clickable. */}
        <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-7" />
      </div>
    </TooltipProvider>
  );
}