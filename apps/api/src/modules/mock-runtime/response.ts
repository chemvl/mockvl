import { NO_BODY_STATUS_CODES } from "@starter/schemas";
import { type IHttpResponse, ProblemJsonError } from "@stoplight/prism-http";

export interface SerializedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  [extra: string]: unknown;
}

export const MOCKVL_ERROR_TYPE = "https://mockvl.dev/errors#";

export const MOCK_PROBLEMS = {
  notFound: {
    type: `${MOCKVL_ERROR_TYPE}NOT_FOUND`,
    title: "Mock not found",
    status: 404,
    detail: "No mock is published at this URL.",
  },
  paused: {
    type: `${MOCKVL_ERROR_TYPE}MOCK_PAUSED`,
    title: "Mock paused",
    status: 503,
    detail: "This mock is paused. Requests return 503 until it is resumed.",
  },
  methodNotAllowed: {
    type: `${MOCKVL_ERROR_TYPE}METHOD_NOT_ALLOWED`,
    title: "Method not allowed",
    status: 405,
    detail: "Mocks answer GET, PUT, POST, DELETE, OPTIONS, HEAD, PATCH and TRACE.",
  },
  internal: {
    type: `${MOCKVL_ERROR_TYPE}INTERNAL`,
    title: "Mock server error",
    status: 500,
    detail: "The mock server failed to handle this request.",
  },
  invalidPreference: (detail: string): Problem => ({
    type: `${MOCKVL_ERROR_TYPE}INVALID_PREFERENCE`,
    title: "Invalid Prefer value",
    status: 422,
    detail,
  }),
} as const satisfies Record<string, Problem | ((detail: string) => Problem)>;

// A mock may never set cookies on the app's origin.
function isForbiddenHeader(name: string): boolean {
  return name === "set-cookie";
}

function lowercaseHeaders(source: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    const key = name.toLowerCase();
    if (typeof value === "string" && !isForbiddenHeader(key)) headers[key] = value;
  }
  return headers;
}

export function serializePrismResponse(output: IHttpResponse): SerializedResponse {
  const headers = lowercaseHeaders(output.headers ?? {});
  if (NO_BODY_STATUS_CODES.includes(output.statusCode) || output.body === undefined) {
    return { status: output.statusCode, headers, body: null };
  }
  if (typeof output.body === "string") {
    return { status: output.statusCode, headers, body: output.body };
  }
  headers["content-type"] ??= "application/json";
  return { status: output.statusCode, headers, body: JSON.stringify(output.body) };
}

// Marks responses that carry a saved body (overrides spec § Mock runtime 3);
// readable cross-origin through access-control-expose-headers: *.
export const OVERRIDE_HEADER = "x-mockvl-override";

// Prism's status and headers with the saved text as the body, sent byte for
// byte. Prism's negotiated content-type is kept, defaulting to JSON.
export function serializeOverride(output: IHttpResponse, body: string): SerializedResponse {
  const serialized = serializePrismResponse({ ...output, body });
  serialized.headers["content-type"] ??= "application/json";
  serialized.headers[OVERRIDE_HEADER] = "1";
  return serialized;
}

export function problemResponse(
  problem: Problem,
  headers: Record<string, string> = {},
): SerializedResponse {
  return {
    status: problem.status,
    headers: { ...headers, "content-type": "application/problem+json" },
    body: JSON.stringify(problem),
  };
}

// Prism's Left: ProblemJsonError (or anything else it threw). Headers Prism
// wants on the response (e.g. WWW-Authenticate) travel in additional.headers;
// toProblemJson spreads `additional` into the body, so they are removed there.
export function serializePrismError(error: Error): SerializedResponse {
  const fields = error as Error & { status?: unknown; additional?: unknown };
  const status = typeof fields.status === "number" ? fields.status : 500;
  const body: Record<string, unknown> = { ...ProblemJsonError.toProblemJson(error), status };
  delete body.headers;
  const additional = fields.additional;
  const extra =
    typeof additional === "object" &&
    additional !== null &&
    "headers" in additional &&
    typeof additional.headers === "object" &&
    additional.headers !== null
      ? lowercaseHeaders(additional.headers as Record<string, unknown>)
      : {};
  return {
    status,
    headers: { ...extra, "content-type": "application/problem+json" },
    body: JSON.stringify(body),
  };
}
