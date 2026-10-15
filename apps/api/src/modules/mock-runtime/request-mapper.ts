import type { IHttpRequest } from "@stoplight/prism-http";
import type { HttpMethod } from "@stoplight/types";
import { PREFER_QUERY_PARAMS } from "./prefer";

const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

export interface IncomingMockRequest {
  method: string;
  // The part after /m/{ws}/{slug}; "/" when empty.
  path: string;
  query: URLSearchParams;
  headers: Headers;
  bodyText: string;
}

function isHttpMethod(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

// Repeated keys become arrays (Prism validates `explode` params that way).
function toRecord(params: URLSearchParams, skip: readonly string[] = []) {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    if (skip.includes(key)) continue;
    const values = params.getAll(key);
    record[key] = values.length === 1 ? (values[0] ?? "") : values;
  }
  return record;
}

function parseBody(contentType: string | null, text: string): unknown {
  if (text === "") return undefined;
  const mediaType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    try {
      return JSON.parse(text);
    } catch {
      // Let Prism's validator report the mismatch against the schema.
      return text;
    }
  }
  if (mediaType === "application/x-www-form-urlencoded") return toRecord(new URLSearchParams(text));
  return text;
}

// Cookies never reach Prism: mocks are same-origin with the app, and a mock
// has no business seeing the caller's session cookies.
export function mapRequest(input: IncomingMockRequest): IHttpRequest | null {
  const method = input.method.toLowerCase();
  if (!isHttpMethod(method)) return null;
  const headers: Record<string, string> = {};
  input.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "cookie") headers[name.toLowerCase()] = value;
  });
  return {
    method,
    url: { path: input.path, query: toRecord(input.query, PREFER_QUERY_PARAMS) },
    headers,
    body: parseBody(input.headers.get("content-type"), input.bodyText),
  };
}
