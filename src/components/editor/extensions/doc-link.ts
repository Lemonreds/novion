import { Extension, type Editor, type Range } from "@tiptap/react";
import { useWorkspace } from "@/store/workspace";
import { useSlash } from "../slash-store";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { SlashItem } from "../slash-items";
import { FileText } from "lucide-react";

/**
 * `[[` document links.
 *
 * Internal links are stored as a normal link mark with the URL
 * `novion://doc/<id>`, which means: one representation for click behaviour,
 * export (`[[name]]`), Notion, backlinks and search. Typing `[[` opens the same
 * suggestion menu the `/` command uses, filled with documents instead of blocks.
 */
export const DOC_LINK_PREFIX = "novion://doc/";

export function isDocLink(href: string | null | undefined): boolean {
  return !!href && href.startsWith(DOC_LINK_PREFIX);
}

export function docIdFromHref(href: string): string | null {
  if (!href.startsWith(DOC_LINK_PREFIX)) return null;
  const id = href.slice(DOC_LINK_PREFIX.length).trim();
  return id || null;
}

/** Documents matching `query`, as suggestion rows. */
export function docLinkItems(query: string): SlashItem[] {
  const { nodes } = useWorkspace.getState();
  const q = query.trim().toLowerCase();
  const rows: SlashItem[] = [];

  for (const node of Object.values(nodes)) {
    if (node.kind !== "doc" || node.builtin) continue;
    if (node.trashedAt) continue;
    const name = node.name || "Untitled";
    if (q && !name.toLowerCase().includes(q)) continue;
    // the folder chain disambiguates documents with the same title
    const crumbs: string[] = [];
    let cur = node.parentId ? nodes[node.parentId] : undefined;
    let guard = 0;
    while (cur && !cur.builtin && guard++ < 32) {
      crumbs.unshift(cur.name || "Untitled");
      cur = cur.parentId ? nodes[cur.parentId] : undefined;
    }
    const docId = node.id;
    rows.push({
      id: `link-${docId}`,
      title: name,
      description: crumbs.length ? crumbs.join(" / ") : "链接到这篇文档",
      keywords: [name],
      icon: FileText,
      run: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: "text",
              text: name,
              marks: [{ type: "link", attrs: { href: `${DOC_LINK_PREFIX}${docId}` } }],
            },
            { type: "text", text: " " },
          ])
          .run();
      },
    });
    if (rows.length >= 12) break;
  }
  return rows;
}

type Props = {
  range: unknown;
  query: string;
  items: SlashItem[];
  command: (item: SlashItem) => void;
  editor: unknown;
  clientRect?: (() => DOMRect | null) | null;
  decorationNode?: unknown;
};

function anchorOf(props: Props) {
  const rect = props.clientRect?.();
  if (!rect) return { left: 240, top: 120, bottom: 140 };
  return { left: rect.left, top: rect.top, bottom: rect.bottom };
}

/** `[[` → document picker. */
export const DocLinkSuggestion = Extension.create({
  name: "docLinkSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        // its own key: two suggestion plugins with the same key make ProseMirror
        // throw "Adding different instances of a keyed plugin"
        pluginKey: new PluginKey("novionDocLink"),
        editor: this.editor,
        char: "[[",
        startOfLine: false,
        allowSpaces: true,
        // `[[` is usually typed straight after a word, unlike `/`
        allowedPrefixes: null,
        items: ({ query }) => docLinkItems(query),
        command: ({ editor, range, props }) => {
          (props as SlashItem).run({
            editor: editor as never,
            range: range as never,
          });
        },
        render: () => ({
          onStart: (props) => {
            const p = props as unknown as Props;
            useSlash
              .getState()
              .show(p.items, anchorOf(p), (item) => p.command(item), "链接到文档");
          },
          onUpdate: (props) => {
            const p = props as unknown as Props;
            useSlash
              .getState()
              .show(p.items, anchorOf(p), (item) => p.command(item), "链接到文档");
          },
          onKeyDown: ({ event }) => {
            const store = useSlash.getState();
            if (!store.open) return false;
            const count = store.items.length;
            if (event.key === "ArrowDown") {
              if (count) store.setIndex((store.index + 1) % count);
              return true;
            }
            if (event.key === "ArrowUp") {
              if (count) store.setIndex((store.index - 1 + count) % count);
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              if (count) store.pick();
              return true;
            }
            if (event.key === "Escape") {
              store.hide();
              return true;
            }
            return false;
          },
          onExit: () => useSlash.getState().hide(),
        }),
      }),
    ];
  },
});
