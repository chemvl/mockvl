import {
  type CustomEndpoint,
  type CustomResponse,
  MAX_CUSTOM_RESPONSE_HEADERS,
  NO_BODY_STATUS_CODES,
} from "@starter/schemas";
import { MAX_OVERRIDE_BODY_BYTES } from "../mocks.constants";
import { mockErrors } from "../mocks.errors";

// Rules and messages: custom mocks spec § Validation.
const MAX_PATH_LENGTH = 2000;
const PARAM_SEGMENT = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const LITERAL_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_HEADERS = new Set([
  "set-cookie",
  "content-security-policy",
  "content-type",
  "content-length",
  "transfer-encoding",
  "connection",
]);
const BLOCKED_HEADER_PREFIXES = ["access-control-", "x-mockvl-"];

function segments(path: string): string[] {
  return path === "/" ? [] : path.slice(1).split("/");
}

/** Parameter names in order: "/users/{id}/posts/{postId}" → ["id", "postId"]. */
export function pathParams(path: string): string[] {
  return segments(path).flatMap((segment) => {
    const name = PARAM_SEGMENT.exec(segment)?.[1];
    return name ? [name] : [];
  });
}

/** Template identity without parameter names: "/users/{id}" and "/users/{userId}" → "/users/{}". */
export function pathKey(path: string): string {
  if (path === "/") return "/";
  return `/${segments(path)
    .map((segment) => (PARAM_SEGMENT.test(segment) ? "{}" : segment))
    .join("/")}`;
}

function assertPath(path: string): void {
  if (!path.startsWith("/") || path.length > MAX_PATH_LENGTH) {
    throw mockErrors.endpointPathInvalid("Paths start with / and are at most 2000 characters.");
  }
  const names = new Set<string>();
  for (const segment of segments(path)) {
    if (segment === "") {
      throw mockErrors.endpointPathInvalid("Remove the empty segment (//) or the trailing /.");
    }
    const name = PARAM_SEGMENT.exec(segment)?.[1];
    if (name) {
      if (names.has(name))
        throw mockErrors.endpointPathInvalid(`{${name}} appears twice in the path.`);
      names.add(name);
    } else if (segment.includes("{") || segment.includes("}")) {
      throw mockErrors.endpointPathInvalid(
        "A path parameter fills a whole segment and uses letters, digits and _, like /users/{id}.",
      );
    } else if (!LITERAL_SEGMENT.test(segment)) {
      throw mockErrors.endpointPathInvalid(
        `"${segment}" has characters that aren't allowed in a path.`,
      );
    }
  }
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const entries = Object.entries(headers);
  if (entries.length > MAX_CUSTOM_RESPONSE_HEADERS) {
    throw mockErrors.responseHeaderInvalid("A response can have at most 20 headers.");
  }
  // A Map, not an object: names like "__proto__" or "constructor" are plain data.
  const normalized = new Map<string, string>();
  for (const [rawName, value] of entries) {
    const name = rawName.trim().toLowerCase();
    if (!HEADER_NAME.test(name)) {
      throw mockErrors.responseHeaderInvalid(`"${rawName}" isn't a valid header name.`);
    }
    if (
      BLOCKED_HEADERS.has(name) ||
      BLOCKED_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      throw mockErrors.responseHeaderInvalid(`${name} can't be set on a mock response.`);
    }
    if (/[\r\n\0]/.test(value)) {
      throw mockErrors.responseHeaderInvalid(`The ${name} value can't contain line breaks.`);
    }
    if (normalized.has(name)) throw mockErrors.responseHeaderInvalid(`${name} is listed twice.`);
    normalized.set(name, value);
  }
  return Object.fromEntries(normalized);
}

// Checks run per response in spec order: status, size, JSON.
function normalizeResponses(responses: readonly CustomResponse[]): CustomResponse[] {
  if (responses.length === 0) throw mockErrors.responseStatusInvalid("Add at least one response.");
  const seen = new Set<number>();
  return responses.map((response) => {
    const { status, body } = response;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw mockErrors.responseStatusInvalid("Status codes are between 100 and 599.");
    }
    if (seen.has(status)) throw mockErrors.responseStatusInvalid(`${status} is listed twice.`);
    seen.add(status);
    if (body !== null) {
      if (NO_BODY_STATUS_CODES.includes(status)) {
        throw mockErrors.responseStatusInvalid(`A ${status} response can't have a body.`);
      }
      if (Buffer.byteLength(body) > MAX_OVERRIDE_BODY_BYTES)
        throw mockErrors.responseTooLarge(status);
      try {
        JSON.parse(body);
      } catch {
        throw mockErrors.responseInvalidJson(status);
      }
    }
    return { status, headers: normalizeHeaders(response.headers), body };
  });
}

/** Validates one endpoint; returns its stored form (header names lowercased, blank summary dropped). */
export function normalizeEndpoint(endpoint: CustomEndpoint): CustomEndpoint {
  assertPath(endpoint.path);
  const summary = endpoint.summary?.trim();
  return {
    kind: "http",
    method: endpoint.method,
    path: endpoint.path,
    ...(summary ? { summary } : {}),
    responses: normalizeResponses(endpoint.responses),
  };
}

/** ENDPOINT_EXISTS when another endpoint has the same method and template. */
export function assertNoDuplicate(
  others: readonly CustomEndpoint[],
  endpoint: CustomEndpoint,
): void {
  const key = pathKey(endpoint.path);
  const clash = others.find(
    (other) => other.method === endpoint.method && pathKey(other.path) === key,
  );
  if (clash) throw mockErrors.endpointExists(clash.method, clash.path);
}
