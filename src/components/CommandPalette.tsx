import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  COMMAND_GROUPS,
  availableCommands,
  filterCommands,
  type Command,
} from "@/lib/commands";
import { useUi } from "@/store/ui";

/**
 * ⌘⇧P action palette.
 *
 * Commands are rebuilt every time the dialog opens (and on each keystroke of the
 * query) because `available()` depends on the current selection; that is a few
 * dozen cheap store reads, far below anything worth memoising across renders.
 */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    if (!open) return [];
    return filterCommands(availableCommands(), query);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    setActive((current) => (current < items.length ? current : 0));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    // let the dialog finish closing before a command opens another dialog
    requestAnimationFrame(() => command.run());
  };

  const grouped = COMMAND_GROUPS.map((group) => ({
    group,
    commands: items.filter((item) => item.group === group),
  })).filter((entry) => entry.commands.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        align="top"
        className="w-[min(560px,calc(100vw-32px))] overflow-hidden p-0"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => (items.length ? (i + 1) % items.length : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(items[active]);
          }
        }}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="搜索要执行的操作…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">
              没有匹配的操作
            </div>
          )}
          {grouped.map(({ group, commands }) => (
            <div key={group} className="mb-1 last:mb-0">
              <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">
                {group}
              </div>
              {commands.map((command) => {
                const index = items.indexOf(command);
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(command)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-75",
                      index === active
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground",
                    )}
                  >
                    <Icon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight">
                        {command.title}
                      </span>
                      {command.detail && (
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                          {command.detail}
                        </span>
                      )}
                    </span>
                    {command.hint && (
                      <kbd className="shrink-0 text-[10px]">{command.hint}</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1 text-[10.5px] text-muted-foreground">
          <span>↑↓ 选择</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-2.5" />
            执行
          </span>
          <span>esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
