import { convertFileSrc } from "@tauri-apps/api/core";

const ASSET_URL_RE =
  /^(?:asset:\/\/localhost|http:\/\/asset\.localhost|https?:\/\/asset\.localhost)\/(.*)$/i;
const REMOTE_RE = /^(https?:|data:|blob:|asset:)/i;

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Walks TipTap-style JSON and rewrites `image.attrs.src`.
 *
 * Returns the *same reference* when nothing was rewritten. Documents without
 * images (the overwhelming majority) therefore travel through this function
 * without any copying at all, and an unchanged image keeps its object identity.
 */
function mapImageSrc(node: unknown, fn: (src: string) => string): unknown {
  if (Array.isArray(node)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < node.length; i += 1) {
      const next = mapImageSrc(node[i], fn);
      if (next !== node[i]) {
        out ??= node.slice();
        out[i] = next;
      }
    }
    return out ?? node;
  }
  if (!isJson(node)) return node;

  if (node.type === "image" && isJson(node.attrs) && typeof node.attrs.src === "string") {
    const src = node.attrs.src;
    const next = fn(src);
    if (next === src) return node;
    return { ...node, attrs: { ...node.attrs, src: next } };
  }

  let out: Json | null = null;
  for (const [key, value] of Object.entries(node)) {
    const next = mapImageSrc(value, fn);
    if (next !== value) {
      out ??= { ...node };
      out[key] = next;
    }
  }
  return out ?? node;
}

/** JSON on disk stores `assets/x.png`; the editor needs an asset:// URL. */
export function absolutizeContent(content: unknown, root: string): unknown {
  if (!root) return content;
  return mapImageSrc(content, (src) => {
    if (!src || REMOTE_RE.test(src)) return src;
    return convertFileSrc(`${root}/${src.replace(/^\.?\//, "")}`);
  });
}

/** Inverse of absolutizeContent so documents stay portable. */
export function relativizeContent(content: unknown, root: string): unknown {
  if (!root) return content;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return mapImageSrc(content, (src) => {
    const match = src.match(ASSET_URL_RE);
    if (!match) return src;
    let abs = match[1];
    try {
      abs = decodeURIComponent(abs);
    } catch {
      /* keep raw */
    }
    return abs.startsWith(prefix) ? abs.slice(prefix.length) : src;
  });
}

/**
 * Turns the snapshot the editor hands over into plain JSON.
 *
 * The editor passes its immutable ProseMirror document (see `DocEditor`), which
 * is only converted here — at save time — instead of on every keystroke. Plain
 * JSON is passed through untouched, so both shapes are accepted.
 */
export function serializeContent(snapshot: unknown): unknown {
  if (isJson(snapshot) && typeof snapshot.toJSON === "function") {
    return (snapshot as { toJSON: () => unknown }).toJSON();
  }
  return snapshot;
}
