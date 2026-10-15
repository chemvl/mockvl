export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const RESERVED_MOCK_SLUGS: ReadonlySet<string> = new Set(["new", "usage", "members", "settings"]);
export const SLUG_INVALID_MESSAGE = "Use lowercase letters, numbers and hyphens (max 40).";

/** lowercase → non-alnum runs to "-" → trim "-" → max 40 → strip trailing "-". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
