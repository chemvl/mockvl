import type { SchemaFormat } from "@starter/schemas";
import { MAX_SCHEMA_BYTES } from "../mocks.constants";
import { mockErrors } from "../mocks.errors";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bytes, not characters — a UTF-8 schema can be far larger than its length.
export function assertSchemaSize(content: string, label: string): number {
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_SCHEMA_BYTES) throw mockErrors.schemaTooLarge(label);
  return sizeBytes;
}

// `{` → JSON, anything else → YAML (Bun.YAML; YAML is a JSON superset, but
// JSON.parse gives the precise error path for the common case).
export function parseSchemaContent(content: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = content.trimStart().startsWith("{") ? JSON.parse(content) : Bun.YAML.parse(content);
  } catch {
    throw mockErrors.schemaParseFailed(label);
  }
  if (!isPlainObject(parsed)) throw mockErrors.schemaParseFailed(label);
  return parsed;
}

const POSTMAN_SCHEMA_VERSION = /\/collection\/v(2\.\d+)(\.\d+)?/;

export interface DetectedFormat {
  format: SchemaFormat;
  specVersion: string;
}

export function detectFormat(doc: Record<string, unknown>): DetectedFormat {
  const openapi = doc.openapi;
  if (typeof openapi === "string" && openapi.startsWith("3.")) {
    return { format: "openapi3", specVersion: openapi };
  }
  // Swagger 2.0 is explicitly out of scope for v1.
  if ("swagger" in doc) throw mockErrors.schemaUnsupported();

  const info = doc.info;
  const schemaUrl = isPlainObject(info) && typeof info.schema === "string" ? info.schema : "";
  const version = schemaUrl.match(POSTMAN_SCHEMA_VERSION);
  if (schemaUrl.includes("/collection/v2.") && Array.isArray(doc.item) && version?.[1]) {
    return { format: "postman2", specVersion: `${version[1]}${version[2] ?? ".0"}` };
  }
  throw mockErrors.schemaUnsupported();
}
