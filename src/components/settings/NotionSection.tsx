import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  RefreshCw,
  Unplug,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage, type NotionSyncMode } from "@/lib/tauri";
import { useNotion } from "@/store/notion";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

const MODES: { value: NotionSyncMode; label: string; hint: string }[] = [
  {
    value: "new_only",
    label: "只同步新增的",
    hint: "已经在 Notion 里的文档跳过，不会改动你在 Notion 上做的编辑。",
  },
  {
    value: "overwrite",
    label: "全部重写已同步的正文",
    hint: "本地改动过的文档会清空 Notion 里的正文再写入；未改动的仍然跳过。",
  },
];

function formatTime(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function NotionSection() {
  const info = useNotion((s) => s.info);
  const loading = useNotion((s) => s.loading);
  const connecting = useNotion((s) => s.connecting);
  const resolving = useNotion((s) => s.resolving);
  const syncing = useNotion((s) => s.syncing);
  const progress = useNotion((s) => s.progress);
  const error = useNotion((s) => s.error);
  const lastStats = useNotion((s) => s.lastStats);
  const load = useNotion((s) => s.load);
  const connect = useNotion((s) => s.connect);
  const disconnect = useNotion((s) => s.disconnect);
  const setParent = useNotion((s) => s.setParent);
  const sync = useNotion((s) => s.sync);
  const clearError = useNotion((s) => s.clearError);
  const askConfirm = useUi((s) => s.askConfirm);

  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<NotionSyncMode>("new_only");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!info && !loading) void load();
  }, [info, loading, load]);

  if (!info) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        正在读取 Notion 设置…
      </div>
    );
  }

  const connected = info.connected;
  const hasParent = !!info.parentPageId;
  const busy = connecting || resolving || syncing;

  const submitToken = async () => {
    setNotice(null);
    const ok = await connect(token);
    if (ok) {
      setToken("");
      setNotice("已连接，接下来选择一个用来放文档的 Notion 页面。");
    }
  };

  const submitParent = async () => {
    setNotice(null);
    const result = await setParent(target);
    if (!result) return;
    setTarget("");
    setNotice(
      result.reset
        ? `目标已切换到「${result.title}」：之前的页面记录已清空，下次同步会在新目标下重新创建页面。`
        : `目标已设为「${result.title}」。`,
    );
  };

  const startSync = async () => {
    setNotice(null);
    const stats = await sync(mode, includeCompleted);
    if (!stats) return;
    if (stats.failures.length === 0) {
      setNotice("同步完成，全部文档都在 Notion 里了。");
    }
  };

  return (
    <div>
      {/* connection -------------------------------------------------- */}
      {connected ? (
        <div className="rounded-lg border border-brand/50 bg-brand-soft px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex size-4 items-center justify-center rounded-full bg-brand text-brand-foreground">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <span className="text-[12.5px] font-medium">已连接 Notion</span>
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
              ····{info.tokenTail}
            </span>
          </div>
          <div className="mt-1 pl-6 text-[11px] leading-relaxed text-muted-foreground">
            {info.botName || "Notion 集成"}
            {info.workspaceName ? ` · 工作区 ${info.workspaceName}` : ""}
            {" · 已同步 "}
            {info.syncedDocs} 篇文档
            {info.syncedFolders ? ` / ${info.syncedFolders} 个文件夹` : ""}
            {info.lastSyncAt ? ` · 上次同步 ${formatTime(info.lastSyncAt)}` : ""}
          </div>
          <div className="mt-2 flex gap-2 pl-6">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                askConfirm({
                  title: "断开 Notion 连接？",
                  description:
                    "本机会忘记 Token 与「文档 → 页面」的对应关系；Notion 里已经同步出来的页面不会被删除，但下次同步会重新创建一份。",
                  confirmLabel: "断开连接",
                  destructive: true,
                  onConfirm: () => {
                    void disconnect();
                    setNotice(null);
                  },
                })
              }
            >
              <Unplug className="size-3.5" />
              断开连接
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clearError();
                setNotice("如果要换一个集成，直接断开后重新粘贴 Token 即可。");
              }}
            >
              更换 Token
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            连接
          </div>
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                spellCheck={false}
                autoComplete="off"
                placeholder="粘贴 Integration Token（ntn_… 或 secret_…）"
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && token.trim() && !connecting) void submitToken();
                }}
                className="pr-8 font-mono text-[12px]"
              />
              <button
                type="button"
                aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Button
              size="md"
              variant="default"
              disabled={!token.trim() || connecting}
              onClick={() => void submitToken()}
            >
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              验证并保存
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            在 Notion「设置 → 连接 / Connections → 开发内部集成」创建一个集成并复制 Token；
            创建后还要在目标页面右上角「…」→「连接」里把这枚集成添加进来，否则它看不到任何页面。
          </p>
        </div>
      )}

      {/* target ------------------------------------------------------ */}
      <div className="mt-5 border-t border-border/70 pt-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          同步目标
        </div>
        {hasParent ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Link2 className="size-3.5 shrink-0 text-brand" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{info.parentPageTitle}</div>
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                {info.parentPageId}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (!info.parentUrl) return;
                void api
                  .openUrl(info.parentUrl)
                  .catch((err) => console.error(errorMessage(err)));
              }}
            >
              <ArrowUpRight className="size-3.5" />
              打开
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setTarget("");
                setNotice("粘贴一个新的页面链接可以切换目标。");
                document.getElementById("notion-target-input")?.focus();
              }}
            >
              更换
            </Button>
          </div>
        ) : null}

        <div className="mt-2 flex gap-2">
          <Input
            id="notion-target-input"
            value={target}
            spellCheck={false}
            autoComplete="off"
            placeholder="粘贴 Notion 页面链接，例如 https://www.notion.so/xxx-1a2b…"
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && target.trim() && !resolving) void submitParent();
            }}
            className="font-mono text-[12px]"
          />
          <Button
            size="md"
            variant="outline"
            disabled={!target.trim() || resolving || !connected}
            onClick={() => void submitParent()}
          >
            {resolving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            检测页面
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {connected
            ? "文档会作为子页面放在这个页面下面，文件夹会变成一层子页面。"
            : "先完成上面的连接，才能检测页面。"}
        </p>
      </div>

      {/* sync -------------------------------------------------------- */}
      <div className="mt-5 border-t border-border/70 pt-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            同步
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
              disabled={syncing}
              className="size-3.5 accent-[var(--brand-strong)]"
            />
            包含「已归档」
          </label>
        </div>

        <div className="mt-2 space-y-2">
          {MODES.map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setMode(option.value)}
                disabled={syncing}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60",
                  active ? "border-brand/60 bg-brand-soft" : "border-border hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-brand bg-brand text-brand-foreground" : "border-input",
                  )}
                >
                  {active && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {syncing ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Loader2 className="size-3.5 animate-spin text-brand" />
              正在写入 Notion…
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-brand transition-[width] duration-200",
                  (progress?.total ?? 0) === 0 && "w-1/3 animate-pulse",
                )}
                style={
                  (progress?.total ?? 0) > 0
                    ? {
                        width: `${Math.min(
                          100,
                          Math.round(((progress?.done ?? 0) / (progress?.total ?? 1)) * 100),
                        )}%`,
                      }
                    : undefined
                }
              />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2 text-[11px] tabular-nums text-muted-foreground">
              <span>
                {(progress?.done ?? 0)} / {(progress?.total ?? 0) || "?"}
              </span>
              <span className="min-w-0 flex-1 truncate">{progress?.current || "正在准备…"}</span>
              <span className="opacity-70">请不要关闭窗口</span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex justify-end">
            <Button
              size="md"
              variant="default"
              disabled={!connected || !hasParent}
              onClick={() => void startSync()}
            >
              <Upload className="size-3.5" />
              {info.syncedDocs > 0 ? "再次同步到 Notion" : "同步到 Notion"}
            </Button>
          </div>
        )}

        {notice && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-brand/40 bg-brand-soft px-2 py-1.5 text-[11.5px] leading-relaxed">
            <Check className="mt-[1px] size-3.5 shrink-0 text-brand" />
            <span className="min-w-0 break-words">{notice}</span>
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/35 px-2 py-1.5 text-[11.5px] leading-relaxed text-destructive">
            <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 text-[10.5px] underline-offset-2 hover:underline"
            >
              知道了
            </button>
          </div>
        )}

        {lastStats && (
          <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <RefreshCw className="size-3.5 text-brand" />
              同步完成
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {lastStats.foldersCreated > 0 && <li>· 新建文件夹页面 {lastStats.foldersCreated} 个</li>}
              {lastStats.pagesCreated > 0 && <li>· 新建文档页面 {lastStats.pagesCreated} 篇</li>}
              {lastStats.pagesUpdated > 0 && <li>· 重写文档正文 {lastStats.pagesUpdated} 篇</li>}
              {lastStats.pagesSkipped > 0 && <li>· 跳过已同步 {lastStats.pagesSkipped} 篇</li>}
              {lastStats.imagesUploaded > 0 && <li>· 上传图片 {lastStats.imagesUploaded} 张</li>}
              {lastStats.imagesFailed > 0 && (
                <li className="text-destructive">
                  · {lastStats.imagesFailed} 张图片没能上传，正文里已插入「图片未同步」占位
                </li>
              )}
              {lastStats.foldersCreated +
                lastStats.pagesCreated +
                lastStats.pagesUpdated +
                lastStats.pagesSkipped ===
                0 && <li>· 没有需要同步的内容</li>}
            </ul>

            {lastStats.failures.length > 0 && (
              <div className="mt-2 rounded-md border border-destructive/35 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-destructive">
                  <AlertTriangle className="size-3.5" />
                  {lastStats.failures.length} 项没能同步
                </div>
                <ul className="mt-1 space-y-1">
                  {lastStats.failures.slice(0, 8).map((failure) => (
                    <li key={failure.docId} className="text-[11px] leading-relaxed">
                      <span className="font-medium">{failure.title || failure.docId}</span>
                      <span className="text-muted-foreground">：{failure.message}</span>
                    </li>
                  ))}
                  {lastStats.failures.length > 8 && (
                    <li className="text-[11px] text-muted-foreground">
                      …另有 {lastStats.failures.length - 8} 项
                    </li>
                  )}
                </ul>
                <div className="mt-1 text-[10.5px] text-muted-foreground">
                  修好上面的问题后再点一次同步即可，已成功的页面不会重复创建。
                </div>
              </div>
            )}

            {lastStats.parentUrl && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void api.openUrl(lastStats.parentUrl).catch((err) => errorMessage(err))
                  }
                >
                  <ArrowUpRight className="size-3.5" />
                  在 Notion 中打开
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Token 保存在本机配置目录的 notion.json（权限 600），只会发往 api.notion.com；
        同步是单向的：Notion 上的改动不会回流到本地。
      </p>
    </div>
  );
}
