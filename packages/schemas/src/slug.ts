// Slug rules shared by the API (validation, personal-workspace slugs) and the
// UI (auto-deriving a mock slug from its name) so both agree byte-for-byte.

export const SLUG_MAX_LENGTH = 40;

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Mock slugs live under /{ws}/… in the UI router next to these pages.
export const RESERVED_MOCK_SLUGS: readonly string[] = ["new", "usage", "members", "settings"];

// Workspace slugs are the first UI path segment and share the domain with
// nginx-routed prefixes (m, connect, svc, …) and app pages (invite, new, …).
export const RESERVED_WORKSPACE_SLUGS: readonly string[] = [
  "api",
  "app",
  "admin",
  "login",
  "logout",
  "auth",
  "invite",
  "new",
  "settings",
  "docs",
  "static",
  "assets",
  "health",
  "www",
  "m",
  "connect",
  "svc",
];

// New and renamed workspace slugs only. Existing slugs are grandfathered under
// SLUG_PATTERN, which is a superset, so `{ws}` params keep using isValidSlug.
export const WORKSPACE_SLUG_MAX_LENGTH = 32;

// Starts with a letter, 2–32 chars, no leading/trailing/double hyphens.
export const WORKSPACE_SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){1,31}$/;

export function isValidWorkspaceSlug(value: string): boolean {
  return WORKSPACE_SLUG_PATTERN.test(value);
}

// Pattern first, then the reserved list; null means the slug is usable
// (availability against existing workspaces is the API's job).
export function workspaceSlugProblem(slug: string): "invalid" | "reserved" | null {
  if (!isValidWorkspaceSlug(slug)) return "invalid";
  if (RESERVED_WORKSPACE_SLUGS.includes(slug)) return "reserved";
  return null;
}

// Lowercase, whitespace → "-", drop everything else outside [a-z0-9-],
// collapse hyphen runs, trim hyphens, cap at 32 (re-trimming a hyphen the cut
// may expose). May return "" or a digit-led slug — callers validate.
export function slugifyWorkspaceName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

// Lowercase, every run of non-alphanumerics → one "-", trim hyphens, cap at
// 40 (re-trimming a hyphen the cut may expose). May return "" — callers decide
// the fallback.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
