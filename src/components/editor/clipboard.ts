import type { EditorView } from "@tiptap/pm/view";

/**
 * Copy / cut with a clipboard flavour that survives other applications.
 *
 * ProseMirror serialises a list item as `<li><p>…</p></li>`. That is valid
 * HTML, but any target that does not share our stylesheet — Word, Pages,
 * Notion, 飞书, 微信, Apple Notes, Slack — gives that inner `p` its default
 * top/bottom margin, so a copied bullet list arrives with a blank line
 * between every item while the in-app rendering looks tight.
 *
 * Unwrapping the paragraph of an item (and joining a second paragraph with a
 * hard break, the way those editors write it themselves) makes the spacing
 * travel with the text instead of depending on CSS we cannot ship. The rule
 * covers `<ul>`, `<ol>`, task lists and nested lists identically, so copy and
 * cut behave the same everywhere in the document.
 */

/**
 * Flattens paragraphs inside every list item.
 *
 * `li > p > (inline)` becomes `li > (inline)`; a following `p` starts with a
 * `<br>` so multi-paragraph items keep their line breaks. Anything still
 * wrapped in a paragraph afterwards (task list items nest their text in a
 * `div`) gets an explicit zero margin, which is the portable way to say
 * "no gap" when the target reads inline styles instead of the element.
 */
function tightenListItems(root: ParentNode): void {
  for (const item of Array.from(root.querySelectorAll("li"))) {
    const paragraphs = Array.from(item.children).filter(
      (child): child is HTMLElement => child.tagName === "P",
    );
    paragraphs.forEach((paragraph, index) => {
      const fragment = item.ownerDocument.createDocumentFragment();
      if (index > 0) fragment.appendChild(item.ownerDocument.createElement("br"));
      while (paragraph.firstChild) fragment.appendChild(paragraph.firstChild);
      paragraph.replaceWith(fragment);
    });
  }

  for (const paragraph of Array.from(root.querySelectorAll("li p"))) {
    paragraph.setAttribute("style", "margin:0;padding:0");
  }
}

/**
 * Writes the current selection to the clipboard and returns `true` when it
 * took over the event, so the caller can short-circuit ProseMirror's own
 * handler (which would write the untightened HTML again).
 *
 * `view.serializeForClipboard` is ProseMirror's own serializer, so the
 * `data-pm-slice` marker that gives in-app paste its fidelity is preserved —
 * only the paragraph wrappers inside list items are rewritten.
 */
export function copySelection(
  view: EditorView,
  event: ClipboardEvent,
  cut: boolean,
): boolean {
  const selection = view.state.selection;
  if (selection.empty) return false;
  // a webview older than IE15/iOS604 has no usable clipboard API; let the
  // built-in handler fall back to its off-screen copy buffer
  const data = event.clipboardData;
  if (!data) return false;

  const { dom, text } = view.serializeForClipboard(selection.content());
  tightenListItems(dom);

  event.preventDefault();
  data.clearData();
  data.setData("text/html", dom.innerHTML);
  data.setData("text/plain", text);

  if (cut) {
    view.dispatch(
      view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"),
    );
  }
  return true;
}
