import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  COMPLETED_ID,
  TRASH_ID,
  hasAncestor,
  sectionTree,
  useWorkspace,
  type FlatRow,
} from "@/store/workspace";
import { useUi } from "@/store/ui";
import { useAutoHideScrollbar } from "@/lib/use-auto-hide-scrollbar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TruncatedLabel } from "./TruncatedLabel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const ROW_H = 30;

interface Section {
  key: "completed" | "trash";
  id: string;
  label: string;
  icon: typeof CheckCircle2;
  empty: string;
}

const SECTIONS: Section[] = [
  { key: "completed", id: COMPLETED_ID, label: "已归档", icon: CheckCircle2, empty: "还没有归档的文档" },
  { key: "trash", id: TRASH_ID, label: "回收站", icon: Trash2, empty: "回收站是空的" },
];

export function BuiltinSections() {
  const nodes = useWorkspace((s) => s.nodes);
  const children = useWorkspace((s) => s.children);
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const restore = useWorkspace((s) => s.restore);
  const purge = useWorkspace((s) => s.purge);
  const emptyTrash = useWorkspace((s) => s.emptyTrash);
  const setCompleted = useWorkspace((s) => s.setCompleted);
  const askConfirm = useUi((s) => s.askConfirm);

  const [open, setOpen] = useState<Record<string, boolean>>({ completed: false, trash: false });
  const toggle = (key: string) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  const listRef = useRef<HTMLDivElement>(null);
  useAutoHideScrollbar(listRef);

  // reveal the matching section when the open document lives in it
  useEffect(() => {
    if (!selectedId) return;
    for (const section of SECTIONS) {
      if (hasAncestor(nodes, selectedId, section.id)) {
        setOpen((s) => (s[section.key] ? s : { ...s, [section.key]: true }));
      }
    }
  }, [nodes, selectedId]);

  // one walk per section feeds both the rows and the counter badge
  const sections = useMemo(() => {
    const map: Record<string, { rows: FlatRow[]; docs: number }> = {};
    for (const section of SECTIONS) {
      map[section.key] = sectionTree(nodes, children, section.id);
    }
    return map;
  }, [children, nodes]);

  const askPurge = (row: FlatRow) => {
    askConfirm({
      title: "永久删除？",
      description:
        row.node.kind === "doc"
          ? `“${row.node.name || "Untitled"}” 将被永久删除，无法恢复。`
          : `“${row.node.name || "Untitled"}” 及其中的所有内容将被永久删除，无法恢复。`,
      confirmLabel: "永久删除",
      destructive: true,
      onConfirm: () => void purge(row.id),
    });
  };

  const askEmptyTrash = () => {
    askConfirm({
      title: "清空回收站？",
      description: "回收站中的所有内容将被永久删除，无法恢复。",
      confirmLabel: "清空回收站",
      destructive: true,
      onConfirm: () => void emptyTrash(),
    });
  };

  return (
    <div
      ref={listRef}
      className="scroller scroll-pane auto-hide-scrollbar max-h-[46vh] overflow-y-auto px-2 pb-1"
    >
      {SECTIONS.map((section) => {
        const { rows, docs } = sections[section.key] ?? { rows: [], docs: 0 };
        const isOpen = !!open[section.key];
        const Icon = section.icon;
        const isTrash = section.key === "trash";

        return (
          <div key={section.key}>
            <div
              data-no-window-drag
              className="group flex items-center rounded-md pr-1 text-[14px] text-foreground/85 hover:bg-sidebar-hover"
              style={{ height: ROW_H }}
            >
              <button
                onClick={() => toggle(section.key)}
                className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-left outline-none"
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
                    isOpen && "rotate-90",
                  )}
                />
                <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
              </button>

              {/* fixed-width counter + action slot: numbers stay right aligned
                  whether or not the clear button is visible */}
              <span className="w-7 shrink-0 text-right text-[12px] tabular-nums leading-none text-muted-foreground/70">
                {docs > 0 ? docs : ""}
              </span>
              <span className="flex w-6 shrink-0 items-center justify-end">
                {isTrash && docs > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                        aria-label="回收站操作"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem destructive onSelect={askEmptyTrash}>
                        <X /> 清空回收站
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </span>
            </div>

            {isOpen && (
              <div>
                {rows.length === 0 ? (
                  <div className="px-3 py-2 text-[13px] text-muted-foreground/70">
                    {section.empty}
                  </div>
                ) : (
                  rows.map((row) => {
                    const selected = row.id === selectedId;
                    const isFolder = row.node.kind === "folder";
                    return (
                      <ContextMenu key={row.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            data-no-window-drag
                            onClick={() => {
                              if (!isFolder) select(row.id);
                            }}
                            style={{ height: ROW_H, paddingLeft: 20 + row.depth * 13 }}
                            className={cn(
                              "group relative flex cursor-default items-center gap-1.5 rounded-md pr-1 text-[14px] transition-colors duration-75",
                              selected
                                ? "bg-brand-soft text-foreground"
                                : "text-foreground/80 hover:bg-sidebar-hover",
                            )}
                          >
                            {selected && (
                              <span className="pointer-events-none absolute inset-y-[6px] left-0 w-[2px] rounded-full bg-brand" />
                            )}
                            {isFolder ? (
                              <Folder
                                className="size-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.8}
                              />
                            ) : (
                              <FileText
                                className="size-3.5 shrink-0 text-muted-foreground/80"
                                strokeWidth={1.8}
                              />
                            )}
                            <TruncatedLabel
                              text={row.node.name}
                              className="flex-1"
                              fallback={
                                <span className="text-muted-foreground/70">Untitled</span>
                              }
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="iconSm"
                                  variant="ghost"
                                  onClick={(e) => e.stopPropagation()}
                                  className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                                  aria-label="条目操作"
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                                {isTrash ? (
                                  <>
                                    <DropdownMenuItem onSelect={() => void restore(row.id)}>
                                      <RotateCcw /> 恢复
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem destructive onSelect={() => askPurge(row)}>
                                      <Trash2 /> 永久删除
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <DropdownMenuItem
                                    onSelect={() => void setCompleted(row.id, false)}
                                  >
                                    <Undo2 /> 取消归档
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          {isTrash ? (
                            <>
                              <ContextMenuItem onSelect={() => void restore(row.id)}>
                                <RotateCcw /> 恢复
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem destructive onSelect={() => askPurge(row)}>
                                <Trash2 /> 永久删除
                              </ContextMenuItem>
                            </>
                          ) : (
                            <ContextMenuItem onSelect={() => void setCompleted(row.id, false)}>
                              <Undo2 /> 取消归档
                            </ContextMenuItem>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
