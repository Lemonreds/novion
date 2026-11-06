import { useState } from "react";
import {
  Archive,
  FileDown,
  FileText,
  History,
  MoreHorizontal,
  Printer,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { exportDoc, printDoc } from "@/lib/export-actions";
import { useUi } from "@/store/ui";
import { DocActionButton } from "./DocAction";

/** Per-document actions that are too rare for a permanent button. */
export function DocMenu({ docId }: { docId: string }) {
  const openHistory = useUi((s) => s.openHistory);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/* the tooltip has to be controlled: it would otherwise stay visible
          underneath the open menu, since the pointer never leaves the button */}
      <Tooltip open={tipOpen && !menuOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <DocActionButton aria-label="更多操作" aria-haspopup="menu">
              <MoreHorizontal className="size-4" strokeWidth={1.7} />
            </DocActionButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">导出、打印与版本历史</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-48">
        <DropdownMenuItem onSelect={() => void exportDoc(docId, "md")}>
          <FileDown />
          导出为 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportDoc(docId, "html")}>
          <FileText />
          导出为 HTML
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportDoc(docId, "json")}>
          <Archive />
          导出为 JSON
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void printDoc(docId)}>
          <Printer />
          打印 / 导出 PDF…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openHistory(docId)}>
          <History />
          版本历史…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
