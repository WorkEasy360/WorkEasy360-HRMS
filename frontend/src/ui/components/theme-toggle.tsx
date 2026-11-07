"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "we-theme";

/**
 * Applied before first paint, so a dark session never flashes light. Keep it in
 * sync with `applyToDom` below; it is inlined into <head> by the root layout.
 */
export const themeScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Private windows and blocked site data: fall back to the OS.
  }
  return "system";
}

function applyToDom(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * The live theme is the attribute the pre-paint script already put on <html>,
 * so this reads it from the DOM rather than keeping a second copy in state.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      applyToDom(readStored());
      onChange();
    }
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Theme {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "dark" || value === "light" ? value : "system";
}

/** The server renders the OS default; the attribute decides in the browser. */
const getServerSnapshot = (): Theme => "system";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: Monitor, light: Sun, dark: Moon };
const LABEL: Record<Theme, string> = {
  system: "Theme: following your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * Dark mode follows the operating system until someone chooses here. The
 * choice is saved per browser.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    const next = NEXT[theme];
    applyToDom(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice then lasts for this page only.
    }
    listeners.forEach((notify) => notify());
  }

  const Icon = ICON[theme];
  return (
    <button
      type="button"
      onClick={cycle}
      className="c-btn-ghost c-btn-icon"
      aria-label={`${LABEL[theme]}. Switch to ${NEXT[theme]}.`}
      title={LABEL[theme]}
    >
      <Icon className="size-icon" strokeWidth={2} aria-hidden />
    </button>
  );
}
