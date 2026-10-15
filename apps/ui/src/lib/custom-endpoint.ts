// Mirrors packages/schemas custom-endpoint.ts and the API's header rules
// (custom mocks spec § Validation) for inline hints; the API stays the authority.
export const NO_BODY_STATUS_CODES: readonly number[] = [101, 204, 205, 304];

export function isNoBodyStatus(status: number): boolean {
  return NO_BODY_STATUS_CODES.includes(status);
}

/** The status the mock serves without `Prefer: code=`: lowest 2xx, else lowest code. */
export function defaultServedStatus(statuses: readonly number[]): number | null {
  const sorted = [...statuses].sort((a, b) => a - b);
  return sorted.find((status) => status >= 200 && status < 300) ?? sorted[0] ?? null;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_HEADERS = new Set([
  "set-cookie",
  "content-security-policy",
  "content-type",
  "content-length",
  "transfer-encoding",
  "connection",
]);
const BLOCKED_PREFIXES = ["access-control-", "x-mockvl-"];

/** Why a header name will be rejected, or null when it's fine (blank rows are ignored). */
export function headerProblem(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (key === "") return null;
  if (!HEADER_NAME.test(key)) return "Not a valid header name.";
  if (BLOCKED_HEADERS.has(key) || BLOCKED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return `${key} can't be set on a mock response.`;
  }
  return null;
}

export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1] ?? "");
}
