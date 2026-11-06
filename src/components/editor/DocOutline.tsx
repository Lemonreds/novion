import { useEffect, useState, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OutlineItem } from "./DocEditor";

interface Props {
  items: OutlineItem[];
  editor: TiptapEditor | null;
  /** the `.doc-scroll` element the outline is tracking */
  scrollRef: RefObject<HTMLDivElement>;
  onClose: () => void;
}

/** where a heading jump lands, in pixels below the top of the scroll pane */
const JUMP_OFFSET = 88;
/** a heading counts as "current" once it is this far into the viewport */
const ACTIVE_OFFSET = 96;

/**
 * Heading outline for the open document.
 *
 * Positions come from `view.coordsAtPos`, so it works no matter how the editor
 * is scrolled and needs no DOM ids or anchors in the document itself.
 */
export function DocOutline({ items, editor, scrollRef, onClose }: Props) {
  const [activePos, setActivePos] = useState<number | null>(null);

  // scroll-spy: the last heading above the reading line is the current one
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !editor || items.length === 0) {
      setActivePos(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = scroller.getBoundingClientRect();
      const line = box.top + ACTIVE_OFFSET;
      let current: number | null = null;
      for (const item of items) {
        let top: number;
        try {
          top = editor.view.coordsAtPos(item.pos).top;
        } catch {
          continue;
        }
        if (top <= line) current = item.pos;
        else break;
      }
      setActivePos((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, items, scrollRef]);

  const jump = (pos: number) => {
    if (!editor) return;
    const scroller = scrollRef.current;
    let top = 0;
    try {
      top = editor.view.coordsAtPos(pos).top;
    } catch {
      return;
    }
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      scroller.scrollTop += top - box.top - JUMP_OFFSET;
    }
    try {
      editor.chain().focus().setTextSelection(pos + 1).run();
    } catch {
      /* a heading at the very edge of the document — scrolling is enough */
    }
  };

  return (
    <aside className="relative z-30 flex w-[204px] shrink-0 flex-col border-l border-border/70">
      <div className="flex h-10 shrink-0 items-center gap-1 pl-3 pr-1.5">
        <span className="flex-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          大纲
        </span>
        <button
          type="button"
          onClick={onClose}
          title="关闭大纲"
          aria-label="关闭大纲"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
        >
          <X className="size-4" strokeWidth={1.9} />
        </button>
      </div>

      <div className="scroller min-h-0 flex-1 overflow-y-auto px-1.5 pb-8">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-[11.5px] leading-relaxed text-muted-foreground/80">
            这篇文档还没有标题。用 <kbd>/</kbd> 插入标题后会显示在这里。
          </p>
        ) : (
          items.map((item, index) => {
            const active = activePos === item.pos;
            return (
              <button
                key={`${item.pos}-${index}`}
                type="button"
                onClick={() => jump(item.pos)}
                title={item.text || "空标题"}
                className={cn(
                  "relative flex w-full items-start rounded-md py-[3px] pr-1.5 text-left text-[12px] leading-[1.45] transition-colors duration-75",
                  active
                    ? "bg-brand-soft text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                style={{ paddingLeft: 8 + (item.level - 1) * 10 }}
              >
                <span className="line-clamp-2 break-words">{item.text || "空标题"}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
