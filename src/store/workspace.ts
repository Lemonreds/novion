import { create } from "zustand";
import {
  api,
  errorMessage,
  type NodeKind,
  type TreeNode,
  type Workspace,
} from "@/lib/tauri";

export type { NodeKind, TreeNode };

export interface WorkspaceState {
  ready: boolean;
  rootPath: string;
  nodes: Record<string, TreeNode>;
  /** parentId ("" = root) -> ordered child ids */
  children: Record<string, string[]>;
  selectedId: string | null;
  expanded: Record<string, boolean>;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  apply: (ws: Workspace) => void;
  /** Full re-index after the workspace root changed (storage switch). */
  adopt: (ws: Workspace, root: string) => void;
  setError: (msg: string | null) => void;
  select: (id: string | null) => void;
  /** Expands every ancestor of `id` then selects it (search jumps). */
  reveal: (id: string) => void;
  toggleExpand: (id: string) => void;
  createDoc: (parentId: string | null) => Promise<string | null>;
  createFolder: (parentId: string | null) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setCompleted: (id: string, completed: boolean) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  expandAll: () => void;
  collapseAll: () => void;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  move: (id: string, parentId: string | null, index: number) => Promise<void>;
}

const ROOT = "";

/** Stable ids of the two system folders, mirrored from the Rust side. */
export const COMPLETED_ID = "f_completed";
export const TRASH_ID = "f_trash";

function sameNode(old: TreeNode, next: TreeNode): boolean {
  return (
    old.kind === next.kind &&
    old.name === next.name &&
    old.parentId === next.parentId &&
    old.order === next.order &&
    old.updatedAt === next.updatedAt &&
    old.builtin === next.builtin &&
    old.originParent === next.originParent &&
    old.completedAt === next.completedAt &&
    old.trashedAt === next.trashedAt &&
    old.pinnedAt === next.pinnedAt
  );
}

/**
 * Re-indexes the flat node list into `nodes` + `children`.
 *
 * Unchanged nodes keep their previous object identity, and when *nothing* at all
 * changed the previous containers are returned as well: a workspace write that
 * resolved to the same tree (a rename that was a no-op, an optimistic update the
 * backend echoed back) then costs zero re-renders.
 */
function indexWorkspace(
  ws: Workspace,
  prev: Record<string, TreeNode>,
  prevChildren?: Record<string, string[]>,
) {
  const nodes: Record<string, TreeNode> = {};
  const children: Record<string, string[]> = { [ROOT]: [] };
  let changed = Object.keys(prev).length !== ws.nodes.length;

  for (const n of ws.nodes) {
    const old = prev[n.id];
    // keep object identity when nothing changed so memoised rows stay quiet
    if (old && sameNode(old, n)) {
      nodes[n.id] = old;
    } else {
      nodes[n.id] = n;
      changed = true;
    }
    const key = n.parentId ?? ROOT;
    (children[key] ??= []).push(n.id);
    if (n.kind === "folder") children[n.id] ??= [];
  }

  if (!changed) return { nodes: prev, children: prevChildren ?? children, changed };

  for (const key of Object.keys(children)) {
    // pinned documents float to the top of their folder, mirroring the Rust
    // `siblings()` ordering so drag & drop indices agree with what is rendered
    children[key].sort((a, b) => {
      const na = nodes[a];
      const nb = nodes[b];
      const pa = na?.pinnedAt ?? 0;
      const pb = nb?.pinnedAt ?? 0;
      if (!!pb !== !!pa) return pb > 0 ? 1 : -1;
      if (pa !== pb) return pb - pa;
      return (na?.order ?? 0) - (nb?.order ?? 0);
    });
  }
  return { nodes, children, changed };
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ready: false,
  rootPath: "",
  nodes: {},
  children: { [ROOT]: [] },
  selectedId: null,
  expanded: {},
  busy: false,
  error: null,

  init: async () => {
    try {
      set({ busy: true });
      const [root, ws] = await Promise.all([api.root(), api.ensure()]);
      const { nodes, children } = indexWorkspace(ws, {});
      const expanded: Record<string, boolean> = {};
      for (const n of ws.nodes) if (n.kind === "folder") expanded[n.id] = true;
      const firstDoc = ws.nodes.find(
        (n) =>
          n.kind === "doc" &&
          !n.completedAt &&
          !n.trashedAt &&
          !(n.parentId && isTrashed(nodes, n.parentId)),
      );
      set({
        ready: true,
        busy: false,
        rootPath: root,
        nodes,
        children,
        expanded,
        selectedId: firstDoc?.id ?? null,
        error: null,
      });
    } catch (err) {
      set({ ready: true, busy: false, error: errorMessage(err) });
    }
  },

  apply: (ws) => {
    const state = get();
    const { nodes, children, changed } = indexWorkspace(ws, state.nodes, state.children);
    const selectedId = state.selectedId;
    const nextSelected = selectedId && nodes[selectedId] ? selectedId : null;
    // an identical tree must not wake the sidebar (or the editor) up at all
    if (!changed && nextSelected === selectedId) return;
    set({ nodes, children, selectedId: nextSelected });
  },

  adopt: (ws, root) => {
    const { nodes, children } = indexWorkspace(ws, {});
    const expanded: Record<string, boolean> = {};
    for (const n of ws.nodes) if (n.kind === "folder") expanded[n.id] = true;
    const firstDoc = ws.nodes.find(
      (n) =>
        n.kind === "doc" &&
        !n.completedAt &&
        !n.trashedAt &&
        !(n.parentId && isTrashed(nodes, n.parentId)),
    );
    set({
      ready: true,
      rootPath: root,
      nodes,
      children,
      expanded,
      selectedId: firstDoc?.id ?? null,
      error: null,
    });
  },

  setError: (error) => set({ error }),

  select: (id) => set({ selectedId: id }),

  reveal: (id) => {
    const { nodes, expanded } = get();
    const next = { ...expanded };
    let cur = nodes[id];
    let guard = 0;
    while (cur?.parentId && guard++ < 64) {
      next[cur.parentId] = true;
      cur = nodes[cur.parentId];
    }
    set({ expanded: next, selectedId: id });
  },

  toggleExpand: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),

  createDoc: async (parentId) => {
    try {
      const res = await api.createDoc(parentId, "");
      get().apply(res.workspace);
      if (parentId) set((s) => ({ expanded: { ...s.expanded, [parentId]: true } }));
      set({ selectedId: res.docId });
      return res.docId;
    } catch (err) {
      set({ error: errorMessage(err) });
      return null;
    }
  },

  createFolder: async (parentId) => {
    try {
      const ws = await api.createFolder(parentId, "New folder");
      get().apply(ws);
      if (parentId) set((s) => ({ expanded: { ...s.expanded, [parentId]: true } }));
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  rename: async (id, name) => {
    const node = get().nodes[id];
    if (!node) return;
    const clean = name.trim() || (node.kind === "doc" ? "Untitled" : "New folder");
    if (clean === node.name) return;
    // optimistic: the row should not flicker while the file write lands
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...node, name: clean } } }));
    try {
      const ws =
        node.kind === "doc"
          ? await api.renameDoc(id, clean)
          : await api.renameFolder(id, clean);
      get().apply(ws);
    } catch (err) {
      set((s) => ({ nodes: { ...s.nodes, [id]: node }, error: errorMessage(err) }));
    }
  },

  remove: async (id) => {
    const node = get().nodes[id];
    if (!node) return;
    try {
      const ws = node.kind === "doc" ? await api.deleteDoc(id) : await api.deleteFolder(id);
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  setCompleted: async (id, completed) => {
    try {
      const ws = await api.setCompleted(id, completed);
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  setPinned: async (id, pinned) => {
    try {
      const ws = await api.setPinned(id, pinned);
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  expandAll: () =>
    set((s) => {
      const expanded = { ...s.expanded };
      for (const node of Object.values(s.nodes)) {
        if (node.kind === "folder" && !node.builtin) expanded[node.id] = true;
      }
      return { expanded };
    }),

  collapseAll: () =>
    set((s) => {
      const expanded = { ...s.expanded };
      for (const node of Object.values(s.nodes)) {
        if (node.kind === "folder" && !node.builtin) expanded[node.id] = false;
      }
      return { expanded };
    }),

  restore: async (id) => {
    try {
      const ws = await api.restoreNode(id);
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  purge: async (id) => {
    try {
      const ws = await api.purgeNode(id);
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  emptyTrash: async () => {
    try {
      const ws = await api.emptyTrash();
      get().apply(ws);
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  move: async (id, parentId, index) => {
    try {
      const ws = await api.moveNode(id, parentId, index);
      get().apply(ws);
      if (parentId) set((s) => ({ expanded: { ...s.expanded, [parentId]: true } }));
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },
}));

export const selectChildren = (parentId: string | null) => (s: WorkspaceState) =>
  s.children[parentId ?? ROOT] ?? [];

/** True when the node or any ancestor sits in 回收站. */
export function isTrashed(nodes: Record<string, TreeNode>, id: string): boolean {
  let cur: TreeNode | undefined = nodes[id];
  let guard = 0;
  while (cur && guard++ < 128) {
    if (cur.trashedAt || cur.builtin === "trash") return true;
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return false;
}

/** True when every expandable folder is currently open. */
export function allFoldersExpanded(
  nodes: Record<string, TreeNode>,
  expanded: Record<string, boolean>,
): boolean {
  const folders = Object.values(nodes).filter((n) => n.kind === "folder" && !n.builtin);
  return folders.length > 0 && folders.every((n) => expanded[n.id]);
}

/** True when `ancestorId` is on the node's parent chain (or is the node). */
export function hasAncestor(
  nodes: Record<string, TreeNode>,
  id: string,
  ancestorId: string,
): boolean {
  let cur: TreeNode | undefined = nodes[id];
  let guard = 0;
  while (cur && guard++ < 128) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return false;
}

/** Flattened, visible rows for the sidebar (folders collapsed are skipped,
 * system folders are rendered in their own section). */
export interface FlatRow {
  id: string;
  depth: number;
  node: TreeNode;
}

export function flattenTree(
  nodes: Record<string, TreeNode>,
  children: Record<string, string[]>,
  expanded: Record<string, boolean>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const id of children[parentId] ?? []) {
      const node = nodes[id];
      if (!node || node.builtin) continue;
      rows.push({ id, depth, node });
      if (node.kind === "folder" && expanded[id]) walk(id, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}

/** Fully expanded rows below a system folder (回收站 / 已归档). */
export function flattenAll(
  nodes: Record<string, TreeNode>,
  children: Record<string, string[]>,
  rootId: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const id of children[parentId] ?? []) {
      const node = nodes[id];
      if (!node) continue;
      rows.push({ id, depth, node });
      if (node.kind === "folder") walk(id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}

/** Number of documents below a system folder. */
export function countDocs(
  nodes: Record<string, TreeNode>,
  children: Record<string, string[]>,
  rootId: string,
): number {
  return sectionTree(nodes, children, rootId).docs;
}

/**
 * Fully expanded rows below a system folder plus its document count.
 *
 * The badge and the list are always needed together, so they come from one
 * walk: counting used to build every `FlatRow` again only to filter it.
 */
export function sectionTree(
  nodes: Record<string, TreeNode>,
  children: Record<string, string[]>,
  rootId: string,
): { rows: FlatRow[]; docs: number } {
  const rows: FlatRow[] = [];
  let docs = 0;
  const walk = (parentId: string, depth: number) => {
    for (const id of children[parentId] ?? []) {
      const node = nodes[id];
      if (!node) continue;
      rows.push({ id, depth, node });
      if (node.kind === "folder") walk(id, depth + 1);
      else docs += 1;
    }
  };
  walk(rootId, 0);
  return { rows, docs };
}