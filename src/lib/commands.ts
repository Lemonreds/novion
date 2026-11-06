import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileDown,
  FileText,
  FolderPlus,
  Import,
  PanelLeft,
  Printer,
  HardDrive,
  Heading,
  History,
  Moon,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquareCheckBig,
  Sun,
  Archive,
  Laptop,
  type LucideIcon,
} from "lucide-react";
import { api, errorMessage } from "@/lib/tauri";
import { exportDoc, exportWorkspace, printDoc } from "@/lib/export-actions";
import { importMarkdownFolder } from "@/lib/import-actions";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

/**
 * Everything the ⌘⇧P palette can run.
 *
 * Actions are plain functions over the stores (never React state), so they can
 * also be triggered from menus and keyboard shortcuts without prop drilling.
 * `available()` decides whether an entry is shown for the current selection.
 */

export type CommandGroup = "文档" | "视图" | "导出" | "设置";

export interface Command {
  id: string;
  title: string;
  detail?: string;
  /** shortcut hint rendered on the right of the row */
  hint?: string;
  keywords?: string[];
  group: CommandGroup;
  icon: LucideIcon;
  available: () => boolean;
  run: () => void;
}

function selectedDocId(): string | null {
  const state = useWorkspace.getState();
  const id = state.selectedId;
  if (!id) return null;
  return state.nodes[id]?.kind === "doc" ? id : null;
}

function hasDoc() {
  return selectedDocId() !== null;
}

function withErrorHandling(run: () => Promise<unknown>) {
  return () => {
    void run().catch((err) => {
      useUi.getState().notify(errorMessage(err), { tone: "error", timeout: 7000 });
    });
  };
}

function ui() {
  return useUi.getState();
}

export const COMMANDS: Command[] = [
  // ---------------------------------------------------------------- 文档
  {
    id: "doc.new",
    title: "新建文档",
    detail: "在当前选中的文件夹里创建",
    hint: "⌘N",
    keywords: ["new", "doc", "create", "新建"],
    group: "文档",
    icon: Plus,
    available: () => true,
    run: () => {
      const state = useWorkspace.getState();
      const current = state.selectedId ? state.nodes[state.selectedId] : null;
      const parentId = current
        ? current.kind === "folder"
          ? current.id
          : current.parentId
        : null;
      void state.createDoc(parentId);
    },
  },
  {
    id: "folder.new",
    title: "新建文件夹",
    detail: "建在第一层",
    hint: "⌘⇧N",
    keywords: ["new", "folder", "create", "文件夹"],
    group: "文档",
    icon: FolderPlus,
    available: () => true,
    run: () => void useWorkspace.getState().createFolder(null),
  },
  {
    id: "doc.completed",
    title: "归档",
    keywords: ["done", "complete", "archive", "归档", "完成"],
    group: "文档",
    icon: SquareCheckBig,
    available: () => {
      const id = selectedDocId();
      if (!id) return false;
      return !useWorkspace.getState().nodes[id]?.completedAt;
    },
    run: () => {
      const id = selectedDocId();
      if (id) void useWorkspace.getState().setCompleted(id, true);
    },
  },
  {
    id: "doc.uncompleted",
    title: "取消归档",
    keywords: ["undo", "restore", "unarchive", "归档", "完成", "取消"],
    group: "文档",
    icon: SquareCheckBig,
    available: () => {
      const id = selectedDocId();
      return !!id && !!useWorkspace.getState().nodes[id]?.completedAt;
    },
    run: () => {
      const id = selectedDocId();
      if (id) void useWorkspace.getState().setCompleted(id, false);
    },
  },
  {
    id: "doc.pin",
    title: "置顶到文件夹顶部",
    keywords: ["pin", "置顶", "收藏"],
    group: "文档",
    icon: Pin,
    available: () => {
      const id = selectedDocId();
      return !!id && !useWorkspace.getState().nodes[id]?.pinnedAt;
    },
    run: () => {
      const id = selectedDocId();
      if (id) void useWorkspace.getState().setPinned(id, true);
    },
  },
  {
    id: "doc.unpin",
    title: "取消置顶",
    keywords: ["unpin", "置顶"],
    group: "文档",
    icon: PinOff,
    available: () => {
      const id = selectedDocId();
      return !!id && !!useWorkspace.getState().nodes[id]?.pinnedAt;
    },
    run: () => {
      const id = selectedDocId();
      if (id) void useWorkspace.getState().setPinned(id, false);
    },
  },
  {
    id: "doc.history",
    title: "版本历史…",
    detail: "查看并恢复这篇文档的历史版本",
    keywords: ["history", "version", "restore", "版本", "历史", "恢复"],
    group: "文档",
    icon: History,
    available: hasDoc,
    run: () => {
      const id = selectedDocId();
      if (id) ui().openHistory(id);
    },
  },

  // ---------------------------------------------------------------- 视图
  {
    id: "find.inDoc",
    title: "在本文中查找",
    hint: "⌘F",
    keywords: ["find", "search", "查找", "文内"],
    group: "视图",
    icon: Search,
    available: hasDoc,
    run: () => ui().setFindOpen(true),
  },
  {
    id: "search.open",
    title: "搜索文档",
    hint: "⌘K",
    keywords: ["search", "find", "搜索", "查找"],
    group: "视图",
    icon: Search,
    available: () => true,
    run: () => ui().setSearchOpen(true),
  },
  {
    id: "sidebar.toggle",
    title: "切换侧边栏",
    detail: "收起或展开左侧导航，专注正文",
    hint: "⌘⇧\\",
    keywords: ["sidebar", "panel", "focus", "侧边栏", "导航", "专注"],
    group: "视图",
    icon: PanelLeft,
    available: () => true,
    run: () => ui().toggleSidebar(),
  },
  {
    id: "outline.toggle",
    title: "切换文档大纲",
    hint: "⌘\\",
    keywords: ["outline", "toc", "heading", "大纲", "目录"],
    group: "视图",
    icon: Heading,
    available: hasDoc,
    run: () => ui().toggleOutline(),
  },
  {
    id: "tree.expand",
    title: "展开全部文件夹",
    keywords: ["expand", "展开"],
    group: "视图",
    icon: ChevronsUpDown,
    available: () => true,
    run: () => useWorkspace.getState().expandAll(),
  },
  {
    id: "tree.collapse",
    title: "收起全部文件夹",
    keywords: ["collapse", "收起"],
    group: "视图",
    icon: ChevronsDownUp,
    available: () => true,
    run: () => useWorkspace.getState().collapseAll(),
  },
  {
    id: "theme.light",
    title: "浅色主题",
    keywords: ["theme", "light", "浅色", "亮"],
    group: "视图",
    icon: Sun,
    available: () => ui().theme !== "light",
    run: () => ui().setTheme("light"),
  },
  {
    id: "theme.dark",
    title: "深色主题",
    keywords: ["theme", "dark", "深色", "暗"],
    group: "视图",
    icon: Moon,
    available: () => ui().theme !== "dark",
    run: () => ui().setTheme("dark"),
  },
  {
    id: "theme.system",
    title: "跟随系统外观",
    keywords: ["theme", "system", "auto", "跟随", "系统"],
    group: "视图",
    icon: Laptop,
    available: () => ui().theme !== "system",
    run: () => ui().setTheme("system"),
  },

  // ---------------------------------------------------------------- 导出
  {
    id: "export.md",
    title: "导出当前文档为 Markdown",
    keywords: ["export", "markdown", "md", "导出"],
    group: "导出",
    icon: FileDown,
    available: hasDoc,
    run: () => {
      const id = selectedDocId();
      if (id) void exportDoc(id, "md");
    },
  },
  {
    id: "export.html",
    title: "导出当前文档为 HTML",
    detail: "单文件网页，图片在旁边",
    keywords: ["export", "html", "导出"],
    group: "导出",
    icon: FileText,
    available: hasDoc,
    run: () => {
      const id = selectedDocId();
      if (id) void exportDoc(id, "html");
    },
  },
  {
    id: "export.json",
    title: "导出当前文档为 JSON",
    detail: "原始 TipTap 数据",
    keywords: ["export", "json", "raw", "导出"],
    group: "导出",
    icon: Archive,
    available: hasDoc,
    run: () => {
      const id = selectedDocId();
      if (id) void exportDoc(id, "json");
    },
  },
  {
    id: "export.pdf",
    title: "打印 / 导出 PDF…",
    detail: "通过系统打印面板，可存储为 PDF",
    keywords: ["pdf", "print", "打印", "导出"],
    group: "导出",
    icon: Printer,
    available: hasDoc,
    run: () => {
      const id = selectedDocId();
      if (id) void printDoc(id);
    },
  },
  {
    id: "import.markdown",
    title: "导入 Markdown 文件夹…",
    detail: "Obsidian / Notion 导出的 .md 都能读",
    keywords: ["import", "markdown", "obsidian", "导入"],
    group: "文档",
    icon: Import,
    available: () => true,
    run: () => void importMarkdownFolder(),
  },
  {
    id: "export.backup",
    title: "备份整个工作区",
    detail: "原始 JSON 副本 + Markdown 镜像",
    keywords: ["backup", "export", "archive", "备份", "导出"],
    group: "导出",
    icon: HardDrive,
    available: () => true,
    run: () => void exportWorkspace(),
  },

  // ---------------------------------------------------------------- 设置
  {
    id: "settings.open",
    title: "打开设置",
    hint: "⌘,",
    keywords: ["settings", "preferences", "设置"],
    group: "设置",
    icon: Settings,
    available: () => true,
    run: () => ui().setSettingsOpen(true),
  },
  {
    id: "settings.notion",
    title: "Notion 同步设置",
    keywords: ["notion", "sync", "同步"],
    group: "设置",
    icon: NotebookPen,
    available: () => true,
    run: () => {
      ui().setSettingsSection("notion");
      ui().setSettingsOpen(true);
    },
  },
  {
    id: "settings.storage",
    title: "存储位置与备份",
    keywords: ["storage", "icloud", "folder", "存储", "位置", "备份"],
    group: "设置",
    icon: HardDrive,
    available: () => true,
    run: () => {
      ui().setSettingsSection("storage");
      ui().setSettingsOpen(true);
    },
  },
  {
    id: "storage.reveal",
    title: "在 Finder 中显示数据目录",
    keywords: ["finder", "open", "reveal", "打开", "目录"],
    group: "设置",
    icon: HardDrive,
    available: () => true,
    run: withErrorHandling(() => api.revealStorageFolder()),
  },
];

export const COMMAND_GROUPS: CommandGroup[] = ["文档", "视图", "导出", "设置"];

export function availableCommands(): Command[] {
  return COMMANDS.filter((command) => {
    try {
      return command.available();
    } catch {
      return false;
    }
  });
}

/** Fuzzy-ish match: title first, then detail and keywords. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const title = command.title.toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score = 100;
    else if (title.includes(q)) score = 70;
    else if ((command.detail ?? "").toLowerCase().includes(q)) score = 40;
    else if (command.keywords?.some((word) => word.toLowerCase().includes(q))) score = 30;
    if (score > 0) scored.push({ command, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.command);
}
