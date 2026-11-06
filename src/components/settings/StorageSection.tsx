import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  FolderOpen,
  HardDrive,
  Loader2,
  PackageOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage, type StorageKind, type SwitchMode } from "@/lib/tauri";
import { exportWorkspace, formatBytes, shortPath } from "@/lib/export-actions";
import { useStorage } from "@/store/storage";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

type Phase = "idle" | "confirm" | "running" | "done";

interface Choice {
  mode: SwitchMode;
  label: string;
  hint: string;
}

const CONFLICT_CHOICES: Choice[] = [
  {
    mode: "merge",
    label: "合并两边数据（推荐）",
    hint: "两边的内容都保留；同一篇文档以较新的为准，另一个版本会存成「（本机副本）」。",
  },
  {
    mode: "use_target",
    label: "只用目标位置的数据",
    hint: "采用目标位置的内容，本机当前数据会先备份成 Novion.backup-时间戳，可随时找回。",
  },
  {
    mode: "keep_local",
    label: "只用本机数据",
    hint: "用本机内容覆盖目标位置，目标位置原有数据会先备份成 Novion.backup-时间戳。",
  },
];

const EMPTY_CHOICES: Choice[] = [
  {
    mode: "keep_local",
    label: "复制到目标位置",
    hint: "目标位置还没有数据，本机全部文档与图片会被复制过去，然后切换。",
  },
];

export function StorageSection() {
  const info = useStorage((s) => s.info);
  const loading = useStorage((s) => s.loading);
  const switching = useStorage((s) => s.switching);
  const progress = useStorage((s) => s.progress);
  const error = useStorage((s) => s.error);
  const load = useStorage((s) => s.load);
  const switchTo = useStorage((s) => s.switchTo);

  const [phase, setPhase] = useState<Phase>("idle");
  const [target, setTarget] = useState<StorageKind | null>(null);
  const [mode, setMode] = useState<SwitchMode>("merge");
  const [summary, setSummary] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<{ path: string; files: number; bytes: number } | null>(
    null,
  );

  useEffect(() => {
    if (!info && !loading) void load();
  }, [info, loading, load]);

  if (!info) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        正在读取存储状态…
      </div>
    );
  }

  const targetInfo = target === "icloud"
    ? { path: info.icloudRoot, ready: info.icloudReady, docs: info.icloudDocs }
    : { path: info.localRoot, ready: info.localReady, docs: info.localDocs };

  const choices = targetInfo.ready ? CONFLICT_CHOICES : EMPTY_CHOICES;

  const start = async () => {
    if (!target) return;
    setPhase("running");
    const stats = await switchTo(target, mode);
    if (!stats) {
      setPhase("confirm");
      return;
    }
    const lines: string[] = [];
    if (stats.docsCopied) lines.push(`复制 ${stats.docsCopied} 篇文档`);
    if (stats.docsMerged) lines.push(`更新 ${stats.docsMerged} 篇同名文档`);
    if (stats.copiesRenamed) lines.push(`保留 ${stats.copiesRenamed} 个冲突副本`);
    if (stats.assetsCopied) lines.push(`复制 ${stats.assetsCopied} 张图片`);
    if (stats.backupPath) lines.push(`备份位置：${stats.backupPath}`);
    setSummary(lines.length ? lines : ["没有需要移动的内容"]);
    setPhase("done");
  };

  const cards: {
    kind: StorageKind;
    title: string;
    subtitle: string;
    detail: string;
    docs: number;
    ready: boolean;
    disabled?: boolean;
  }[] = [
    {
      kind: "local",
      title: "本机文档",
      subtitle: "~/Documents/Novion",
      detail: info.localRoot,
      docs: info.localDocs,
      ready: info.localReady,
    },
    {
      kind: "icloud",
      title: "iCloud 云盘",
      subtitle: "iCloud Drive / Novion",
      detail: info.icloudRoot,
      docs: info.icloudDocs,
      ready: info.icloudReady,
      disabled: !info.icloudAvailable,
    },
  ];

  if (phase === "confirm" && target) {
    return (
      <div>
        <div className="text-[13px] font-medium">
          切换到{target === "icloud" ? " iCloud 云盘" : "本机文档"}
        </div>
        <div className="mt-1 selectable break-all rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/75">
          {targetInfo.path}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {targetInfo.ready
            ? `目标位置已有 ${targetInfo.docs} 篇文档，需要先决定怎么合并。`
            : "目标位置还没有 Novion 数据。"}
        </div>

        <div className="mt-3 space-y-2">
          {choices.map((choice) => {
            const active = mode === choice.mode;
            return (
              <button
                key={choice.mode}
                onClick={() => setMode(choice.mode)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
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
                  <span className="block text-[12.5px] font-medium">{choice.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {choice.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-1.5 rounded-md border border-destructive/35 px-2 py-1.5 text-[11.5px] leading-relaxed text-destructive">
            <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPhase("idle")}>
            取消
          </Button>
          <Button variant="default" size="sm" onClick={() => void start()}>
            开始切换
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    const total = progress?.total ?? 0;
    const done = progress?.done ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    return (
      <div className="py-6">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Loader2 className="size-3.5 animate-spin text-brand" />
          {progress?.phase === "merge" ? "正在合并数据…" : "正在复制数据…"}
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-brand transition-[width] duration-200",
              pct === null && "w-1/3 animate-pulse",
            )}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 text-[11.5px] tabular-nums text-muted-foreground">
          {total > 0 ? `${done} / ${total}` : "正在准备…"}
          <span className="ml-2 opacity-70">请不要关闭窗口</span>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div>
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Check className="size-4 text-brand" />
          已切换到{info.storage === "icloud" ? " iCloud 云盘" : "本机文档"}
        </div>
        <ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-muted-foreground">
          {summary.map((line) => (
            <li key={line} className="break-all">
              · {line}
            </li>
          ))}
        </ul>
        <div className="mt-3 selectable break-all rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] text-foreground/75">
          {info.activeRoot}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="default" onClick={() => setPhase("idle")}>
            完成
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        数据位置
      </div>
      <div className="mt-2 space-y-2">
        {cards.map((card) => {
          const active = info.storage === card.kind;
          const Icon = card.kind === "icloud" ? Cloud : HardDrive;
          return (
            <div
              key={card.kind}
              className={cn(
                "rounded-lg border px-3 py-2.5 transition-colors",
                active ? "border-brand/60 bg-brand-soft" : "border-border",
                card.disabled && "opacity-55",
              )}
            >
              <div className="flex items-start gap-2">
                <Icon
                  className={cn(
                    "mt-[2px] size-4 shrink-0",
                    active ? "text-brand" : "text-muted-foreground",
                  )}
                  strokeWidth={1.8}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-medium">{card.title}</span>
                    {active && (
                      <span className="rounded border border-brand/40 px-1 text-[10px] text-brand">
                        当前
                      </span>
                    )}
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                      {card.docs} 篇
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{card.subtitle}</div>
                  <div
                    className="mt-1 selectable break-all font-mono text-[10.5px] leading-relaxed text-muted-foreground/70"
                    title={card.detail}
                  >
                    {card.detail}
                  </div>
                  {card.disabled && (
                    <div className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-destructive">
                      <AlertTriangle className="mt-[1px] size-3 shrink-0" />
                      未检测到 iCloud 云盘，请在系统设置中登录 iCloud 并开启「iCloud 云盘」
                    </div>
                  )}
                  {!active && !card.disabled && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={switching}
                        onClick={() => {
                          setTarget(card.kind);
                          setMode(card.ready ? "merge" : "keep_local");
                          setPhase("confirm");
                        }}
                      >
                        切换到这里
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          默认保存在本机文档；选择 iCloud 后所有读写都会走云端目录，多台 Mac 自动同步。
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void api.revealStorageFolder().catch((err) => errorMessage(err));
          }}
        >
          <FolderOpen className="size-3.5" />
          在 Finder 中显示
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <PackageOpen
            className="mt-[2px] size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.8}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium">导出与备份</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              把整个工作区导出一份：原始 JSON 逐字节副本 + 按目录结构生成的 Markdown，
              存放在「下载 / Novion」下，不需要本 app 也能打开。
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  const result = await exportWorkspace();
                  setExporting(false);
                  if (result) {
                    setLastExport({
                      path: result.path,
                      files: result.files,
                      bytes: result.bytes,
                    });
                  }
                }}
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <PackageOpen className="size-3.5" />
                )}
                备份整个工作区
              </Button>
              {lastExport && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void api.revealPath(lastExport.path).catch((err) => {
                      useUi.getState().notify(errorMessage(err), { tone: "error" });
                    });
                  }}
                >
                  <FolderOpen className="size-3.5" />
                  在 Finder 中显示
                </Button>
              )}
            </div>
            {lastExport && (
              <p className="mt-1.5 break-all font-mono text-[10.5px] leading-relaxed text-muted-foreground/70">
                {shortPath(lastExport.path)} · {lastExport.files} 个文件 ·{" "}
                {formatBytes(lastExport.bytes)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        iCloud 的同步是文件级的：两台 Mac 同时编辑同一篇文档时，以最后写入的版本为准；
        切换存储前会自动等待未保存内容落盘。
      </div>
    </div>
  );
}
