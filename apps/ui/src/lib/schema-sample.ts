import type { OperationParameter, OperationRequest } from "@/lib/api/types";

type JsonSchema = Record<string, unknown>;
type RequestBody = NonNullable<OperationRequest["body"]>;

// Deep enough for realistic payloads; recursive schemas stop here.
const MAX_DEPTH = 8;

const STRING_FORMATS: Readonly<Record<string, string>> = {
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
  time: "00:00:00",
  email: "user@example.com",
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  uri: "https://example.com",
  url: "https://example.com",
  hostname: "example.com",
  ipv4: "127.0.0.1",
  ipv6: "::1",
};

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The schema's own type; for OAS 3.1 type arrays, the first non-null one. */
export function schemaType(schema: unknown): string | undefined {
  if (!isSchema(schema)) return undefined;
  const { type } = schema;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.find((item): item is string => typeof item === "string" && item !== "null");
  if (isSchema(schema.properties)) return "object";
  if (schema.items !== undefined) return "array";
  return undefined;
}

function sampleString(schema: JsonSchema): string {
  const format = typeof schema.format === "string" ? STRING_FORMATS[schema.format] : undefined;
  return format ?? "string";
}

function sampleNumber(schema: JsonSchema): number {
  return typeof schema.minimum === "number" ? schema.minimum : 0;
}

/**
 * A plausible value for a JSON Schema: its own example/default/const/enum
 * first, else a type-shaped placeholder. undefined = no sample possible
 * (unresolvable recursive `$ref`, depth cap); such properties and array
 * items are left out so the sample stays valid against the schema.
 */
export function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isSchema(schema) || depth > MAX_DEPTH) return undefined;
  if ("example" in schema) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if ("default" in schema) return schema.default;
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (typeof schema.$ref === "string") return undefined;

  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((part) => sampleFromSchema(part, depth + 1)).filter((part) => part !== undefined);
    return parts.every(isSchema) ? Object.assign({}, ...parts) : parts[0];
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length > 0) return sampleFromSchema(options[0], depth + 1);
  }

  switch (schemaType(schema)) {
    case "object": {
      const properties = isSchema(schema.properties) ? schema.properties : {};
      const entries = Object.entries(properties).map(([name, property]) => [name, sampleFromSchema(property, depth + 1)]);
      return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
    }
    case "array": {
      const item = sampleFromSchema(schema.items, depth + 1);
      return item === undefined ? [] : [item];
    }
    case "string":
      return sampleString(schema);
    case "integer":
    case "number":
      return sampleNumber(schema);
    case "boolean":
      return true;
    default:
      return null;
  }
}

/** How a sample is shown in a single-line input: arrays as comma lists. */
export function toInputText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toInputText).join(",");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Literal examples win over schema-derived samples. */
function parameterSample(param: OperationParameter): unknown {
  return param.examples.length > 0 ? param.examples[0] : sampleFromSchema(param.schema);
}

/** Required inputs start filled; optional ones start empty (sample as placeholder). */
export function initialParameterValue(param: OperationParameter): string {
  return param.required ? toInputText(parameterSample(param)) : "";
}

export function parameterPlaceholder(param: OperationParameter): string {
  return toInputText(parameterSample(param)) || (schemaType(param.schema) ?? "");
}

export function isJsonMediaType(mediaType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(mediaType);
}

export function initialBodyText(body: RequestBody): string {
  const sample = body.examples.length > 0 ? body.examples[0] : sampleFromSchema(body.schema);
  if (sample === undefined || (sample === null && body.examples.length === 0)) return "";
  return isJsonMediaType(body.mediaType) ? JSON.stringify(sample, null, 2) : toInputText(sample);
}
