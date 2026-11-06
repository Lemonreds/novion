import type { Editor, Range } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Info,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { pickImage } from "./image-insert";

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  run: (ctx: { editor: Editor; range: Range }) => void;
}

const chain = (editor: Editor, range: Range) =>
  editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "paragraph",
    title: "Text",
    description: "普通文本块",
    keywords: ["text", "paragraph", "正文", "p"],
    icon: Type,
    run: ({ editor, range }) => chain(editor, range).setParagraph().run(),
  },
  {
    id: "h1",
    title: "Heading 1",
    description: "大标题",
    keywords: ["h1", "heading", "title", "标题"],
    icon: Heading1,
    run: ({ editor, range }) => chain(editor, range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "中标题",
    keywords: ["h2", "heading", "subtitle", "标题"],
    icon: Heading2,
    run: ({ editor, range }) => chain(editor, range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "小标题",
    keywords: ["h3", "heading", "标题"],
    icon: Heading3,
    run: ({ editor, range }) => chain(editor, range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "bullet",
    title: "Bullet List",
    description: "无序列表",
    keywords: ["bulleted", "list", "ul", "无序", "列表"],
    icon: List,
    run: ({ editor, range }) => chain(editor, range).toggleBulletList().run(),
  },
  {
    id: "numbered",
    title: "Numbered List",
    description: "有序列表",
    keywords: ["numbered", "ordered", "list", "ol", "有序", "编号"],
    icon: ListOrdered,
    run: ({ editor, range }) => chain(editor, range).toggleOrderedList().run(),
  },
  {
    id: "todo",
    title: "To-do",
    description: "待办清单",
    keywords: ["todo", "task", "checkbox", "待办", "任务", "清单"],
    icon: CheckSquare,
    run: ({ editor, range }) => chain(editor, range).toggleTaskList().run(),
  },
  {
    id: "code",
    title: "Code Block",
    description: "代码块",
    keywords: ["code", "pre", "代码"],
    icon: Code2,
    run: ({ editor, range }) => chain(editor, range).toggleCodeBlock().run(),
  },
  {
    id: "quote",
    title: "Quote",
    description: "引用块",
    keywords: ["quote", "blockquote", "引用"],
    icon: Quote,
    run: ({ editor, range }) => chain(editor, range).toggleBlockquote().run(),
  },
  {
    id: "divider",
    title: "Divider",
    description: "分割线",
    keywords: ["divider", "hr", "line", "分割", "分隔"],
    icon: Minus,
    run: ({ editor, range }) => chain(editor, range).setHorizontalRule().run(),
  },
  {
    id: "image",
    title: "Image",
    description: "插入本地图片",
    keywords: ["image", "img", "photo", "图片", "照片"],
    icon: ImageIcon,
    run: ({ editor, range }) => {
      chain(editor, range).run();
      void pickImage(editor);
    },
  },
  {
    id: "table",
    title: "Table",
    description: "三行三列表格",
    keywords: ["table", "grid", "sheet", "表格", "表"],
    icon: TableIcon,
    run: ({ editor, range }) => {
      chain(editor, range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    id: "callout",
    title: "Callout",
    description: "提示 / 注意块",
    keywords: ["callout", "note", "tip", "warning", "提示", "注意", "强调"],
    icon: Info,
    run: ({ editor, range }) => {
      chain(editor, range)
        .insertContent({
          type: "callout",
          attrs: { kind: "info" },
          content: [{ type: "paragraph" }],
        })
        .run();
    },
  },
  {
    id: "toggle",
    title: "Toggle",
    description: "可折叠的内容块",
    keywords: ["toggle", "fold", "collapse", "details", "折叠", "收起", "展开"],
    icon: ChevronRight,
    run: ({ editor, range }) => {
      chain(editor, range)
        .insertContent({
          type: "toggle",
          attrs: { open: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "折叠标题" }] },
            { type: "paragraph" },
          ],
        })
        .run();
    },
  },
  {
    id: "doc-link",
    title: "Link to page",
    description: "链接到另一篇文档（也可直接输入 [[）",
    keywords: ["link", "wiki", "reference", "链接", "引用", "关联"],
    icon: Link2,
    run: ({ editor, range }) => {
      // leaving the `[[` typed in place lets the suggestion popup take over
      chain(editor, range).insertContent("[[").run();
    },
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}