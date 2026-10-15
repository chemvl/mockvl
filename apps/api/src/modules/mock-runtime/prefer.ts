// Port of Prism's request-config parsing (getHttpConfigFromRequest in
// @stoplight/prism-http-server, which is not exported): preferences come from
// the Prefer header, or — only when there is no Prefer header — from the
// __code / __example / __dynamic / __seed query parameters.
import parsePreferHeader from "parse-prefer-header";

export interface PreferOverrides {
  code?: number;
  exampleKey?: string;
  dynamic?: boolean;
  seed?: string;
}

export type PreferResult = { ok: true; overrides: PreferOverrides } | { ok: false; detail: string };

// Stripped from the query Prism sees (request-mapper.ts).
export const PREFER_QUERY_PARAMS: readonly string[] = [
  "__code",
  "__example",
  "__dynamic",
  "__seed",
];

type RawPreferences = Record<string, string | true | undefined>;

function fromQuery(query: URLSearchParams): RawPreferences {
  return {
    code: query.get("__code") ?? undefined,
    example: query.get("__example") ?? undefined,
    dynamic: query.get("__dynamic") ?? undefined,
    seed: query.get("__seed") ?? undefined,
  };
}

export function parsePreferences(
  preferHeader: string | undefined,
  query: URLSearchParams,
): PreferResult {
  const raw: RawPreferences = preferHeader ? parsePreferHeader(preferHeader) : fromQuery(query);
  const overrides: PreferOverrides = {};
  const problems: string[] = [];

  if (raw.code !== undefined) {
    if (typeof raw.code === "string" && /^\d{3}$/.test(raw.code)) overrides.code = Number(raw.code);
    else problems.push("code must be a 3-digit HTTP status");
  }
  if (raw.dynamic !== undefined) {
    if (raw.dynamic === "true" || raw.dynamic === true) overrides.dynamic = true;
    else if (raw.dynamic === "false") overrides.dynamic = false;
    else problems.push("dynamic must be true or false");
  }
  if (raw.example !== undefined) {
    if (typeof raw.example === "string") overrides.exampleKey = raw.example;
    else problems.push("example must name an example");
  }
  if (raw.seed !== undefined) {
    if (typeof raw.seed === "string") overrides.seed = raw.seed;
    else problems.push("seed must be a value");
  }

  return problems.length > 0 ? { ok: false, detail: problems.join("; ") } : { ok: true, overrides };
}
