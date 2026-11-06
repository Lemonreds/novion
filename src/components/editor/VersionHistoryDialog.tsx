import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage, type DocVersionMeta } from "@/lib/tauri";
import { saveQueue } from "@/lib/save-scheduler";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

interface Props {
  docId: string;
  /** called after a restore so the view can reload the editor */
  onRestored: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

function clock(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function relative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return clock(ts).slice(0, 10);
}

/**
 * Rolling version history of one document.
 *
 * Restoring flushes and cancels pending autosave first, so the editor that is
 * about to be remounted cannot write its stale body back over the restored one.
 */
export function VersionHistoryDialog({ docId, onRestored }: Props) {
  const openDocId = useUi((s) => s.historyDocId);
  const close = useUi((s) => s.closeHistory);
  const notify = useUi((s) => s.notify);
  const open = openDocId === docId;

  const [versions, setVersions] = useState<DocVersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTs, setConfirmTs] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  /** retention picked in the settings, shown so the list length is explained */
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVersions(null);
    setError(null);
    setConfirmTs(null);
    api
      .getHistoryLimit()
      .then((value) => {
        if (alive) setLimit(value);
      })
      .catch(() => {
        /* the default is a fine fallback for a caption */
      });
    api
      .listDocVersions(docId)
      .then((list) => {
        if (alive) setVersions(list);
      })
      .catch((err) => {
        if (!alive) return;
        setVersions([]);
        setError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [open, docId]);

  const restore = async (ts: number) => {
    setRestoring(ts);
    const key = `doc:${docId}`;
    try {
      await saveQueue.flush(key);
      saveQueue.cancel(key);
      await api.restoreDocVersion(docId, ts);
      notify("已恢复到所选版本", { tone: "success" });
      onRestored();
      close();
    } catch (err) {
      notify(errorMessage(err), { tone: "error", timeout: 7000 });
    } finally {
      setRestoring(null);
      setConfirmTs(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogTitle>版本历史</DialogTitle>
        <DialogDescription>
          每 5 分钟自动保存一份正文快照，最多保留 {limit} 份（可在设置里调整）。恢复时只替换正文，标题保持不变。
        </DialogDescription>

        <div className="mt-3 max-h-[min(380px,52vh)] overflow-y-auto rounded-lg border border-border/70">
          {versions === null ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              正在读取历史版本…
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <History className="size-5 text-muted-foreground/50" strokeWidth={1.6} />
              <p className="text-[12.5px] text-muted-foreground">
                还没有历史版本
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                继续编辑一会儿，改动前的正文会自动存成一份快照。
              </p>
            </div>
          ) : (
            versions.map((version, index) => {
              const confirming = confirmTs === version.ts;
              const busy = restoring === version.ts;
              return (
                <div
                  key={version.ts}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5",
                    index > 0 && "border-t border-border/60",
                    confirming && "bg-brand-soft",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-medium tabular-nums">
                        {clock(version.ts)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {relative(version.ts)} · {version.words} 字
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 break-words text-[11.5px] leading-relaxed text-muted-foreground">
                      {version.preview || "（空文档）"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={confirming ? "default" : "outline"}
                    disabled={busy || (restoring !== null && !busy)}
                    onClick={() => {
                      if (!confirming) {
                        setConfirmTs(version.ts);
                        return;
                      }
                      void restore(version.ts);
                    }}
                    className="shrink-0"
                  >
                    {busy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3" />
                    )}
                    {confirming ? "确认恢复" : "恢复"}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-destructive">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            恢复前的正文也会存成一份快照，随时可以再退回来。
          </p>
          <Button size="sm" variant="ghost" onClick={close}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
