import { useCallback, useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { api, errorMessage } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace";
import { SlashCommand } from "./extensions/slash-command";
import { CodeHighlight } from "./extensions/code-highlight";
import { Callout } from "./extensions/callout";
import { Toggle } from "./extensions/toggle";
import { DOC_LINK_PREFIX, DocLinkSuggestion } from "./extensions/doc-link";
import { insertImageFiles } from "./image-insert";
import { copySelection } from "./clipboard";
import { SlashMenu } from "./SlashMenu";

interface Props {
  initialContent: unknown;
  /**
   * Receives the *immutable* ProseMirror document of the moment, not a JSON
   * copy: serialising the whole body on every keystroke was pure garbage, and a
   * PM node is a perfect snapshot anyway (edits create new nodes).
   */
  onChange: (snapshot: unknown) => void;
  onEditorReady?: (editor: TiptapEditor) => void;
  onError?: (message: string) => void;
  /** heading outline of the current body (only reported when enabled) */
  onOutline?: (items: OutlineItem[]) => void;
  outlineEnabled?: boolean;
}

export interface OutlineItem {
  level: number;
  text: string;
  /** ProseMirror document position of the heading */
  pos: number;
}

export function DocEditor({
  initialContent,
  onChange,
  onEditorReady,
  onError,
  onOutline,
  outlineEnabled = false,
}: Props) {
  const editorRef = useRef<TiptapEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onOutlineRef = useRef(onOutline);
  onOutlineRef.current = onOutline;
  const outlineEnabledRef = useRef(outlineEnabled);
  outlineEnabledRef.current = outlineEnabled;
  const outlineSigRef = useRef("");
  const outlineFrameRef = useRef(0);

  /**
   * Rebuilds the heading list from the rendered DOM: `posAtDOM` keeps the jump
   * target exact, and the signature check stops React from re-rendering the
   * outline panel while the caret moves around inside a paragraph.
   */
  const reportOutline = useCallback(() => {
    const ed = editorRef.current;
    const report = onOutlineRef.current;
    if (!ed || !report) return;
    const heads = Array.from(
      (ed.view.dom as HTMLElement).querySelectorAll<HTMLElement>("h1, h2, h3"),
    );
    const items: OutlineItem[] = heads.map((el) => {
      let pos = 0;
      try {
        pos = ed.view.posAtDOM(el, 0);
      } catch {
        pos = 0;
      }
      return {
        level: Number(el.tagName.slice(1)) || 1,
        text: (el.textContent ?? "").trim(),
        pos,
      };
    });
    const signature = items.map((i) => `${i.level}:${i.pos}:${i.text}`).join("|");
    if (signature === outlineSigRef.current) return;
    outlineSigRef.current = signature;
    report(items);
  }, []);

  const scheduleOutline = useCallback(() => {
    if (!outlineEnabledRef.current) return;
    if (outlineFrameRef.current) return;
    outlineFrameRef.current = requestAnimationFrame(() => {
      outlineFrameRef.current = 0;
      reportOutline();
    });
  }, [reportOutline]);

  useEffect(() => {
    if (outlineEnabled) reportOutline();
  }, [outlineEnabled, reportOutline]);

  useEffect(
    () => () => {
      if (outlineFrameRef.current) cancelAnimationFrame(outlineFrameRef.current);
    },
    [],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: { HTMLAttributes: { spellcheck: "false" } },
          dropcursor: { color: "currentColor", width: 2 },
          /**
           * The undo stack is the largest thing a long note keeps resident:
           * ProseMirror stores every step plus its inverse. The default depth
           * (100) is tuned for much smaller documents, so a long note held tens
           * of megabytes of history. 50 steps still covers a normal editing
           * session, and `newGroupDelay` groups a typing burst into one step
           * instead of one per keystroke.
           */
          history: { depth: 50, newGroupDelay: 400 },
        }),
        Placeholder.configure({
          placeholder: "输入 / 添加内容",
          showOnlyWhenEditable: true,
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({
          inline: false,
          allowBase64: false,
          HTMLAttributes: {
            loading: "lazy",
            decoding: "async",
            draggable: "true",
          },
        }),
        Link.configure({
          // clicks are routed to the system browser by `handleClick` below
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        }),
        Table.configure({ resizable: false, HTMLAttributes: { class: "table-block" } }),
        TableRow,
        TableHeader,
        TableCell,
        Callout,
        Toggle,
        SlashCommand,
        DocLinkSuggestion,
        CodeHighlight,
      ],
      content: initialContent as never,
      autofocus: false,
      // the editor never needs React to re-render on transactions
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "tiptap selectable",
          spellcheck: "true",
        },
        /**
         * A plain click on a link opens it in the default browser; holding ⌥
         * (or ⌘) keeps the caret in the document so the link can be edited,
         * which is the one thing a click cannot do any more.
         *
         * NOTE: the open happens on `click`, not on ProseMirror's `handleClick`.
         * `handleClick` is only reachable from the mouseup listener that PM
         * installs inside its own mousedown handler, and the mousedown below
         * returns `true` (so the caret is not dropped into the link) — which
         * makes PM skip that handler entirely and `handleClick` never fire.
         * A plain DOM `click` handler is not affected by that short-circuit.
         */
        handleDOMEvents: {
          mousedown: (_view, event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target?.closest("a[href]")) return false;
            if (event.button !== 0) return false; // right click still opens menus
            if (event.altKey || event.metaKey || event.ctrlKey) return false;
            // keep the caret where it is: a click that opens a browser tab must
            // not also drop a cursor into the middle of the link text
            event.preventDefault();
            return true;
          },
          click: (_view, event) => {
            const target = event.target instanceof Element ? event.target : null;
            const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return false;
            const href = anchor.getAttribute("href") ?? "";
            const internal = href.startsWith(DOC_LINK_PREFIX);
            const external = /^(https?:|mailto:)/i.test(href);
            if (!internal && !external) return false;

            // never let the webview navigate itself, not even for a modified
            // click: that would replace the whole app with the page
            event.preventDefault();
            // ⌥/⌘ click keeps the link editable instead of opening it
            if (event.altKey || event.metaKey || event.ctrlKey) return true;
            if (event.button !== 0) return true;

            if (internal) {
              // an in-app link: select that document instead of leaving the app
              const id = href.slice(DOC_LINK_PREFIX.length).trim();
              if (id) useWorkspace.getState().reveal(id);
              return true;
            }
            void api
              .openUrl(href)
              .catch((err) => onErrorRef.current?.(errorMessage(err)));
            return true;
          },
          // list items are copied without their paragraph wrapper so other
          // editors do not add a blank line between every item
          copy: (view, event) =>
            copySelection(view, event as ClipboardEvent, false),
          cut: (view, event) => copySelection(view, event as ClipboardEvent, true),
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (!files.length) return false;
          event.preventDefault();
          const ed = editorRef.current;
          if (!ed) return true;
          void insertImageFiles(ed, files).catch((err) =>
            onErrorRef.current?.(String((err as Error)?.message ?? err)),
          );
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (!files.length) return false;
          event.preventDefault();
          const ed = editorRef.current;
          if (!ed) return true;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImageFiles(ed, files, pos).catch((err) =>
            onErrorRef.current?.(String((err as Error)?.message ?? err)),
          );
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        // `state.doc` is immutable, so this is a real snapshot of this instant
        // without the cost of `getJSON()` on every single keystroke
        onChangeRef.current(ed.state.doc);
        scheduleOutline();
      },
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed;
        onEditorReady?.(ed);
        scheduleOutline();
      },
    },
    [],
  );

  if (!editor) {
    return <div className="h-[40vh]" />;
  }

  return (
    <>
      <EditorContent editor={editor} />
      <SlashMenu />
    </>
  );
}