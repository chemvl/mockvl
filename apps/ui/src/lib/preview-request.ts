import type { OperationRequest } from "@/lib/api/types";
import { schemaType } from "@/lib/schema-sample";

export type PreviewValues = {
  path: Record<string, string>;
  query: Record<string, string>;
  header: Record<string, string>;
  /** Selected status pill; "" lets Prism pick its default. */
  code: string;
  /** Prefer dropdown choice (example=… / dynamic=true); "" sends none. */
  prefer: string;
  body: string;
};

export type PreviewResult = {
  status: number;
  statusText: string;
  durationMs: number;
  contentType: string | null;
  /** The mock served a saved custom response (x-mockvl-override: 1). */
  overridden: boolean;
  /** Body text exactly as received. */
  raw: string;
  /** Parsed JSON when the body is JSON, else the raw text. */
  body: { kind: "json"; value: unknown } | { kind: "text"; text: string } | { kind: "empty" };
};

export const OVERRIDE_HEADER = "x-mockvl-override";

/** The sent `Prefer` header: pill first, then the dropdown, e.g. "code=404, example=notFound". */
export function preferHeader(values: Pick<PreviewValues, "code" | "prefer">): string {
  return [values.code ? `code=${values.code}` : "", values.prefer].filter((part) => part !== "").join(", ");
}

const BODYLESS_METHODS: ReadonlySet<string> = new Set(["get", "head"]);

export function sendsBody(op: OperationRequest): boolean {
  return op.body !== null && !BODYLESS_METHODS.has(op.method);
}

/** Mock URL + filled path template + non-empty query values (arrays: comma list → repeated key). */
export function buildPreviewUrl(baseUrl: string, op: OperationRequest, values: PreviewValues): string {
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(values.path[name] ?? ""));
  const url = new URL(`${baseUrl}${path}`);
  for (const param of op.parameters.query) {
    const raw = values.query[param.name]?.trim();
    if (!raw) continue;
    const items = schemaType(param.schema) === "array" ? raw.split(",").map((item) => item.trim()) : [raw];
    for (const item of items) url.searchParams.append(param.name, item);
  }
  return url.toString();
}

function parseBody(text: string): PreviewResult["body"] {
  if (text === "") return { kind: "empty" };
  try {
    return { kind: "json", value: JSON.parse(text) };
  } catch {
    return { kind: "text", text };
  }
}

/** Calls the mock straight from the browser; network/CORS failures reject. */
export async function sendPreview(
  baseUrl: string,
  op: OperationRequest,
  values: PreviewValues,
  signal: AbortSignal,
): Promise<PreviewResult> {
  const headers = new Headers();
  for (const param of op.parameters.header) {
    const value = values.header[param.name]?.trim();
    if (value) headers.set(param.name, value);
  }
  const prefer = preferHeader(values);
  if (prefer) headers.set("Prefer", prefer);
  const withBody = sendsBody(op) && values.body.trim() !== "";
  if (withBody && op.body) headers.set("Content-Type", op.body.mediaType);

  const startedAt = performance.now();
  const response = await fetch(buildPreviewUrl(baseUrl, op, values), {
    method: op.method.toUpperCase(),
    headers,
    body: withBody ? values.body : undefined,
    credentials: "omit",
    signal,
  });
  const text = await response.text();
  return {
    status: response.status,
    statusText: response.statusText,
    durationMs: Math.round(performance.now() - startedAt),
    contentType: response.headers.get("content-type"),
    overridden: response.headers.get(OVERRIDE_HEADER) === "1",
    raw: text,
    body: parseBody(text),
  };
}
