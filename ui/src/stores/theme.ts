import { create } from "zustand";
// Highlight.js ships separate light/dark stylesheets — both `.hljs` namespaced,
// so they would clash if imported together. We swap a <link> at runtime.
import hljsLightUrl from "highlight.js/styles/github.css?url";
import hljsDarkUrl from "highlight.js/styles/github-dark.css?url";

type Theme = "light" | "dark";
type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "clawagents:theme";
const HLJS_LINK_ID = "hljs-theme";

function osTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "system";
}

function effectiveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? osTheme() : mode;
}

function applyHljsTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  let link = document.getElementById(HLJS_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = HLJS_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = theme === "dark" ? hljsDarkUrl : hljsLightUrl;
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  applyHljsTheme(theme);
}

interface ThemeState {
  /** The persisted user choice — may be "system" to follow OS preference. */
  mode: ThemeMode;
  /** The effective theme actually applied to the DOM. */
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  /** Cycles light → dark → system → light. Used by the single-button toggle. */
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const mode = readInitialMode();
  const theme = effectiveTheme(mode);
  applyTheme(theme);

  // Track OS theme changes while in "system" mode so a midnight auto-dark
  // ripples into the app without a reload.
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().mode === "system") {
        const next = effectiveTheme("system");
        applyTheme(next);
        set({ theme: next });
      }
    };
    mq.addEventListener?.("change", onChange);
  }

  return {
    mode,
    theme,
    setMode: (mode) => {
      const theme = effectiveTheme(mode);
      applyTheme(theme);
      try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
      set({ mode, theme });
    },
    toggle: () =>
      set((s) => {
        const nextMode: ThemeMode = s.mode === "light" ? "dark" : s.mode === "dark" ? "system" : "light";
        const nextTheme = effectiveTheme(nextMode);
        applyTheme(nextTheme);
        try { window.localStorage.setItem(STORAGE_KEY, nextMode); } catch { /* ignore */ }
        return { mode: nextMode, theme: nextTheme };
      }),
  };
});
