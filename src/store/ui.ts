import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";
export type SettingsSection = "editor" | "appearance" | "storage" | "notion" | "about";

const THEME_KEY = "novion:theme";
const WIDTH_KEY = "novion:sidebar-width";
const SIDEBAR_OPEN_KEY = "novion:sidebar-open";
const SETTINGS_SECTION_KEY = "novion:settings-section";
const FONT_SIZE_KEY = "novion:doc-font-size";
const FONT_SIZE_VERSION_KEY = "novion:doc-font-size-v";
const OUTLINE_KEY = "novion:outline-open";
const FONT_SIZE_VERSION = 3;

export const FONT_SIZE_MIN = 13;
export const FONT_SIZE_MAX = 20;
export const FONT_SIZE_DEFAULT = 15;
/** the default shipped before v3; see the migration note in `readFontSize` */
const FONT_SIZE_PREVIOUS_DEFAULT = 14;

function readTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function readWidth(): number {
  const v = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(v) && v >= 180 && v <= 420 ? v : 248;
}

/** Hidden only when the user explicitly collapsed it once. */
function readSidebarOpen(): boolean {
  return localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0";
}

const clampFontSize = (v: number) =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));

function readFontSize(): number {
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  // NOTE: `Number(null)` is 0 (finite!), which used to clamp a fresh profile
  // down to 13px instead of using the default — treat "no key" as unset.
  const stored = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);

  let value = Number.isFinite(stored) ? stored : FONT_SIZE_DEFAULT;

  if (localStorage.getItem(FONT_SIZE_VERSION_KEY) !== String(FONT_SIZE_VERSION)) {
    // v2 normalised every profile onto the then-default (14px) and *wrote that
    // number back*, so a stored 14 is indistinguishable from "never touched".
    // Moving the default to 15px therefore migrates 14 → 15 once; values the
    // user picked by hand (13, 16–20) are kept.
    if (!Number.isFinite(stored) || stored === FONT_SIZE_PREVIOUS_DEFAULT) {
      value = FONT_SIZE_DEFAULT;
    }
    localStorage.setItem(FONT_SIZE_VERSION_KEY, String(FONT_SIZE_VERSION));
  }

  const size = clampFontSize(value);
  localStorage.setItem(FONT_SIZE_KEY, String(size));
  return size;
}

function readSettingsSection(): SettingsSection {
  const v = localStorage.getItem(SETTINGS_SECTION_KEY);
  return v === "editor" || v === "appearance" || v === "storage" || v === "notion" || v === "about"
    ? v
    : "appearance";
}

export interface ConfirmState {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
}

export type NoticeTone = "info" | "success" | "error";

export interface Notice {
  id: number;
  text: string;
  tone: NoticeTone;
  /** optional single action, e.g. "在 Finder 中显示" */
  actionLabel?: string;
  action?: () => void;
}

export interface NoticeOptions {
  tone?: NoticeTone;
  /** milliseconds; 0 keeps it until dismissed */
  timeout?: number;
  actionLabel?: string;
  action?: () => void;
}

let noticeSeq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export interface UiState {
  theme: ThemeMode;
  /** document body size in px (13–20) */
  fontSize: number;
  sidebarWidth: number;
  /** false = the left rail is collapsed and the content gets the full width */
  sidebarOpen: boolean;
  confirm: ConfirmState;
  searchOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  /** ⌘⇧P action palette */
  commandOpen: boolean;
  /** right-hand heading outline of the open document */
  outlineOpen: boolean;
  /** in-document find bar (⌘F) */
  findOpen: boolean;
  /** document whose version history dialog is open */
  historyDocId: string | null;
  notice: Notice | null;
  setTheme: (t: ThemeMode) => void;
  setFontSize: (px: number) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  askConfirm: (state: Omit<ConfirmState, "open">) => void;
  closeConfirm: () => void;
  setSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCommandOpen: (open: boolean) => void;
  setOutlineOpen: (open: boolean) => void;
  toggleOutline: () => void;
  setFindOpen: (open: boolean) => void;
  openHistory: (docId: string) => void;
  closeHistory: () => void;
  notify: (text: string, options?: NoticeOptions) => void;
  dismissNotice: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  fontSize: readFontSize(),
  sidebarWidth: readWidth(),
  sidebarOpen: readSidebarOpen(),
  confirm: { open: false, title: "" },
  searchOpen: false,
  settingsOpen: false,
  settingsSection: readSettingsSection(),
  commandOpen: false,
  outlineOpen: localStorage.getItem(OUTLINE_KEY) === "1",
  findOpen: false,
  historyDocId: null,
  notice: null,

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },

  setFontSize: (px) => {
    const size = clampFontSize(px);
    localStorage.setItem(FONT_SIZE_KEY, String(size));
    localStorage.setItem(FONT_SIZE_VERSION_KEY, String(FONT_SIZE_VERSION));
    applyFontSize(size);
    set({ fontSize: size });
  },

  setSidebarWidth: (w) => {
    const width = Math.min(420, Math.max(180, Math.round(w)));
    localStorage.setItem(WIDTH_KEY, String(width));
    set({ sidebarWidth: width });
  },

  setSidebarOpen: (sidebarOpen) => {
    localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
    set({ sidebarOpen });
  },

  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
    set({ sidebarOpen: next });
  },

  askConfirm: (state) => set({ confirm: { ...state, open: true } }),

  closeConfirm: () => set({ confirm: { ...get().confirm, open: false } }),

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setSettingsSection: (settingsSection) => {
    localStorage.setItem(SETTINGS_SECTION_KEY, settingsSection);
    set({ settingsSection });
  },

  setCommandOpen: (commandOpen) => set({ commandOpen }),

  setOutlineOpen: (outlineOpen) => {
    localStorage.setItem(OUTLINE_KEY, outlineOpen ? "1" : "0");
    set({ outlineOpen });
  },

  setFindOpen: (findOpen) => set({ findOpen }),

  toggleOutline: () => {
    const next = !get().outlineOpen;
    localStorage.setItem(OUTLINE_KEY, next ? "1" : "0");
    set({ outlineOpen: next });
  },

  openHistory: (historyDocId) => set({ historyDocId }),

  closeHistory: () => set({ historyDocId: null }),

  notify: (text, options) => {
    noticeSeq += 1;
    const notice: Notice = {
      id: noticeSeq,
      text,
      tone: options?.tone ?? "info",
      actionLabel: options?.actionLabel,
      action: options?.action,
    };
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    set({ notice });
    const timeout = options?.timeout ?? 4500;
    if (timeout > 0) {
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        // a newer notice must not be removed by an older timer
        if (get().notice?.id === notice.id) set({ notice: null });
      }, timeout);
    }
  },

  dismissNotice: () => {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    set({ notice: null });
  },
}));

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Document body typography is driven by two CSS variables on <html>. */
export function applyFontSize(px: number) {
  const root = document.documentElement;
  root.style.setProperty("--doc-font-size", `${px}px`);
  root.style.setProperty("--doc-title-size", `${Math.round(px * 2)}px`);
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}