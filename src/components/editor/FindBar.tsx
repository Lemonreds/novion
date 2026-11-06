import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImeSafeInput } from "@/lib/use-ime-safe-input";

export interface Match {
  from: number;
  to: number;
}

/**
 * Finds every occurrence of `query` in the current document.
 *
 * Walks the ProseMirror tree once per query instead of serialising the document
 * to text: the walk is O(nodes) and returns exact positions, so jumping needs no
 * second lookup and no DOM measurement.
 */
export function findMatches(editor: TiptapEditor, query: string): Match[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: Match[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = node.text.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      matches.push({ from: pos + at, to: pos + at + needle.length });
      at = haystack.indexOf(needle, at + needle.length);
    }
  });
  return matches;
}

interface Props {
  editor: TiptapEditor | null;
  onClose: () => void;
}

/**
 * In-document find (⌘F). Global search stays on ⌘K, so "find in this note" and
 * "find a note" no longer compete for the same shortcut.
 */
export function FindBar({ editor, onClose }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const field = useImeSafeInput({
    initialValue: "",
    onChange: (value) => run(value),
    onCommit: (value) => run(value),
  });

  const highlight = useCallback(
    (list: Match[], index: number) => {
      if (!editor || !list.length) return;
      const match = list[index];
      if (!match) return;
      editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
    },
    [editor],
  );

  const run = useCallback(
    (raw: string) => {
      if (!editor) return;
      const list = findMatches(editor, raw);
      setMatches(list);
      setActive(0);
      if (list.length) highlight(list, 0);
    },
    [editor, highlight],
  );

  // the document changes while the bar is open: keep the count honest
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const list = findMatches(editor, field.draft);
      setMatches(list);
      setActive((current) => (list.length ? Math.min(current, list.length - 1) : 0));
    };
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, field.draft]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const step = (delta: number) => {
    if (!matches.length) return;
    const next = (active + delta + matches.length) % matches.length;
    setActive(next);
    highlight(matches, next);
  };

  return (
    <div className="anim-pop absolute right-5 top-2 z-30 flex items-center gap-1 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.3)]">
      <input
        ref={inputRef}
        value={field.draft}
        onChange={field.handleChange}
        onCompositionStart={field.handleCompositionStart}
        onCompositionEnd={field.handleCompositionEnd}
        onKeyDown={(e) => {
          field.handleKeyDown(e);
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="在本文中查找…"
        spellCheck={false}
        className="h-7 w-[168px] min-w-0 selectable bg-transparent px-1.5 text-[12.5px] outline-none placeholder:text-muted-foreground/60"
      />
      <span
        className={cn(
          "min-w-[46px] text-center text-[11px] tabular-nums",
          matches.length ? "text-muted-foreground" : "text-muted-foreground/50",
        )}
      >
        {matches.length ? `${active + 1}/${matches.length}` : "无结果"}
      </span>
      <button
        type="button"
        aria-label="上一个"
        onClick={() => step(-1)}
        disabled={!matches.length}
        className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="下一个"
        onClick={() => step(1)}
        disabled={!matches.length}
        className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="关闭查找"
        onClick={onClose}
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
