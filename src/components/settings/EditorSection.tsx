import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { api, errorMessage } from "@/lib/tauri";
import { useUi } from "@/store/ui";

/**
 * Retention of the rolling version history.
 *
 * The numbers mirror `HISTORY_LIMIT_MIN / MAX / DEFAULT` in
 * `src-tauri/src/config.rs`; the backend clamps again, so a stale UI can never
 * write an out-of-range value.
 */
const LIMIT_MIN = 5;
const LIMIT_MAX = 20;
const LIMIT_DEFAULT = 10;

export function EditorSection() {
  const notify = useUi((s) => s.notify);
  const [limit, setLimit] = useState(LIMIT_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getHistoryLimit()
      .then((value) => {
        if (!alive) return;
        setLimit(value);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  /** One save per gesture: dragging the slider must not rewrite every history folder. */
  const persist = (value: number) => {
    setLimit(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void api.setHistoryLimit(value).catch((err) => {
        notify(errorMessage(err), { tone: "error", timeout: 7000 });
      });
    }, 320);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          版本历史上限
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium tabular-nums text-brand">{limit} 份</span>
          {loaded && limit !== LIMIT_DEFAULT && (
            <button
              onClick={() => persist(LIMIT_DEFAULT)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              恢复默认
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <span className="w-4 text-right text-[10.5px] tabular-nums text-muted-foreground/70">
          {LIMIT_MIN}
        </span>
        <input
          type="range"
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          step={1}
          value={limit}
          onChange={(e) => persist(Number(e.target.value))}
          aria-label="版本历史上限"
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted outline-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-sm"
        />
        <span className="w-4 text-[10.5px] tabular-nums text-muted-foreground/70">
          {LIMIT_MAX}
        </span>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
        <History className="mt-[2px] size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          每 5 分钟自动存一份正文快照，默认保留最近 {LIMIT_DEFAULT} 份。
          调低后旧版本会被立即清理，只保留最新的若干份。
        </p>
      </div>
    </div>
  );
}
