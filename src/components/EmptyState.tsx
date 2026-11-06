import { FilePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  hasDocs,
  onCreate,
}: {
  hasDocs: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-brand/25 bg-brand-soft shadow-sm">
        <FilePlus className="size-5 text-brand" strokeWidth={1.6} />
      </div>
      <div className="mt-4 text-[14.5px] font-medium tracking-[-0.01em]">
        {hasDocs ? "选择一个文档开始" : "No documents yet"}
      </div>
      <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-muted-foreground">
        {hasDocs
          ? "从左侧选择文档，或新建一篇继续写作。"
          : "创建你的第一篇笔记，内容会以本地文件保存在 ~/Documents/Novion。"}
      </p>
      <Button variant="accent" size="sm" className="mt-5" onClick={onCreate}>
        <Plus className="size-3.5" />
        新建文档
      </Button>
    </div>
  );
}