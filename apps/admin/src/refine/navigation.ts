// Full-page navigation for cross-realm redirects (OAuth hand-off, logout).
// Indirection on purpose: window.location is non-configurable under jsdom,
// so callers stay testable by mocking this module.
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

// replace() keeps the abandoned page out of the back stack.
export function hardReplace(url: string): void {
  window.location.replace(url);
}
