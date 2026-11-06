import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, type SearchHit } from "@/lib/tauri";
import { isTrashed, useWorkspace, type TreeNode } from "@/store/workspace";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Free-text part of a query: filters (`tag:`, `path:`, …) are not highlighted. */
function textTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(path|in|folder|title|updated|before|after):/i.test(word))
    .map((word) => word.replace(/^#/, ""))
    .filter((word) => word.length > 0);
}

/** Wraps query terms in `<mark>` so hits are visible at a glance. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = textTerms(query);
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[2px] bg-brand/20 px-[1px] text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** `A / B / C` for one document, walking its parent chain once. */
function breadcrumbOf(nodes: Record<string, TreeNode>, id: string): string {
  const names: string[] = [];
  let cur = nodes[id];
  let guard = 0;
  while (cur?.parentId && guard++ < 64) {
    const parent = nodes[cur.parentId];
    if (!parent || parent.builtin) break;
    names.unshift(parent.name || "Untitled");
    cur = parent;
  }
  return names.join(" / ");
}

export function SearchDialog() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const reveal = useWorkspace((s) => s.reveal);
  const setError = useWorkspace((s) => s.setError);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // debounced search; results are ignored when a newer request has started
  useEffect(() => {
    if (!open) return;
    const token = ++seq.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .searchDocs(query)
        .then((res) => {
          if (token !== seq.current) return;
          setHits(res);
          setActive(0);
        })
        .catch((err) => {
          if (token !== seq.current) return;
          setError(errorMessage(err));
        })
        .finally(() => {
          if (token === seq.current) setLoading(false);
        });
    }, query.trim() ? 120 : 0);
    return () => clearTimeout(timer);
  }, [open, query, setError]);

  const openHit = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      reveal(hit.id);
      setOpen(false);
    },
    [reveal, setOpen],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openHit(hits[active]);
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, hits]);

  // one pass per result set: the trashed flag and the breadcrumb used to be
  // recomputed inside the render loop (twice per row!), and the whole tree was
  // subscribed just for that
  const results = useMemo(() => {
    const { nodes } = useWorkspace.getState();
    return hits.map((hit) => ({
      hit,
      trashed: isTrashed(nodes, hit.id),
      crumb: breadcrumbOf(nodes, hit.id),
    }));
  }, [hits]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent align="top" className="w-[min(680px,calc(100vw-32px))] overflow-hidden p-0">
        <DialogTitle className="sr-only">搜索文档</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border/70 px-3.5">
          <Search className="size-4 shrink-0 text-brand" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索标题与正文，支持 path: / title: / updated:>7d"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 selectable bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60"
          />
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground/60" />}
          <kbd className="hidden shrink-0 sm:block">esc</kbd>
        </div>

        <div ref={listRef} className="scroller scroll-pane max-h-[58vh] overflow-y-auto p-1.5">
          {results.length === 0 && !loading && (
            <div className="px-3 py-8 text-center text-[12.5px] text-muted-foreground/70">
              {query.trim() ? "没有匹配的内容" : "还没有可搜索的文档"}
            </div>
          )}

          {!query.trim() && results.length > 0 && (
            <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              最近编辑
            </div>
          )}

          {results.map(({ hit, trashed, crumb }, index) => (
            <button
              key={hit.id}
              data-index={index}
              onMouseMove={() => setActive(index)}
              onClick={() => openHit(hit)}
              className={cn(
                "flex w-full cursor-default items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none",
                index === active ? "bg-brand-soft text-foreground" : "text-foreground/85",
              )}
            >
              <FileText
                className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/80"
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[13.5px] font-medium">
                    {hit.title ? (
                      <Highlight text={hit.title} query={query} />
                    ) : (
                      <span className="text-muted-foreground/70">Untitled</span>
                    )}
                  </span>
                  {trashed && (
                    <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                      回收站
                    </span>
                  )}
                </span>
                {hit.snippet && (
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.5] text-muted-foreground">
                    <Highlight text={hit.snippet} query={query} />
                  </span>
                )}
                {crumb && (
                  <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground/60">
                    {crumb}
                  </span>
                )}
              </span>
              {index === active && (
                <ArrowRight className="mt-[3px] size-3.5 shrink-0 text-brand" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border/70 px-3.5 py-1.5 text-[10.5px] text-muted-foreground/70">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline">
              可用 <code className="font-mono">path:文件夹</code>、
              <code className="font-mono">title:标题</code>、
              <code className="font-mono">updated:&gt;7d</code>
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
