// Mirror of the workspace slug rules in packages/schemas/src/slug.ts — that file
// is the source of truth; keep these byte-for-byte in sync with it.

export const WORKSPACE_SLUG_MAX_LENGTH = 32;

// Starts with a letter, 2–32 chars, no leading/trailing/double hyphens.
export const WORKSPACE_SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){1,31}$/;

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

export const WORKSPACE_SLUG_INVALID_MESSAGE = "Use lowercase letters, numbers and hyphens.";

// Pattern first, then the reserved list; null means the slug is usable
// (availability against existing workspaces is the API's job).
export function workspaceSlugProblem(slug: string): "invalid" | "reserved" | null {
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) return "invalid";
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
