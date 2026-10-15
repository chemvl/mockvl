import { isPlainObject } from "../import/parse";

export type JsonSchema = Record<string, unknown>;

// JSON Schema from one example value (custom mocks spec § Inference).
// A lone null doesn't reveal the real type, so it allows anything.
export function inferSchema(value: unknown): JsonSchema {
  if (value === null) return {};
  if (Array.isArray(value)) {
    return { type: "array", items: value.length === 0 ? {} : inferSchema(value[0]) };
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return {
      type: "object",
      properties: Object.fromEntries(keys.map((key) => [key, inferSchema(value[key])])),
      required: keys,
    };
  }
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    default:
      return {};
  }
}
