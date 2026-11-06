import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace";
import { useStorage } from "@/store/storage";

const VERSION = "0.1.0";

export function AboutSection() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const nodeCount = useWorkspace((s) => Object.keys(s.nodes).length);
  const info = useStorage((s) => s.info);
  const load = useStorage((s) => s.load);

  useEffect(() => {
    if (!info) void load();
  }, [info, load]);

  const rows = [
    { label: "版本", value: VERSION },
    { label: "存储位置", value: info?.storage === "icloud" ? "iCloud 云盘" : "本机文档" },
    { label: "当前目录", value: rootPath || info?.activeRoot || "—" },
    { label: "节点总数", value: `${nodeCount}` },
  ];

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <span className="text-[15px] font-semibold">N</span>
        </div>
        <div>
          <div className="text-[13.5px] font-medium leading-tight">Novion</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            本地优先的知识笔记
          </div>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-border/70 rounded-lg border border-border/70">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-3 px-3 py-2">
            <dt className="w-20 shrink-0 text-[11.5px] text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 selectable break-all font-mono text-[11px] leading-relaxed text-foreground/80">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void api.revealStorageFolder().catch((err) => errorMessage(err))}
        >
          <FolderOpen className="size-3.5" />
          在 Finder 中显示
        </Button>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        所有文档都是普通 JSON 文件（workspace.json + docs/ + assets/），可以直接备份、迁移或放进
        Git。数据不经过任何服务器。
      </p>
    </div>
  );
}
