import { useSyncExternalStore } from "react";

// Theme = user preference in localStorage, resolved to `.theme-dark` on <html>
// (tokens.scss). "system" is the default and follows the OS setting live.
export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "mockyard.theme";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

let preference = readPreference();

function apply(): void {
  const dark = preference === "dark" || (preference === "system" && darkQuery.matches);
  document.documentElement.classList.toggle("theme-dark", dark);
}

// Call once before the first render so the initial paint uses the right theme.
export function initTheme(): void {
  apply();
  darkQuery.addEventListener("change", apply);
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  if (next === "system") localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, next);
  apply();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference);
}
