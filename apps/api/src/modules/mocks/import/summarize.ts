import { createHash } from "node:crypto";
import { OPERATION_METHODS, type OperationMethod, type OperationSummary } from "@starter/schemas";
import { isPlainObject } from "./parse";

// Structural subset of @stoplight/types IHttpOperation that this module reads
// (IHttpOperation is assignable to it). Keeps the summary testable without
// building full Prism operations.
export interface OperationLike {
  method: string;
  path: string;
  summary?: string;
  responses: {
    code: string;
    contents?: {
      mediaType: string;
      examples?: { key: string; value?: unknown; externalValue?: string }[];
    }[];
  }[];
}

export interface OperationsSummary {
  operations: OperationSummary[];
  endpointCount: number;
  exampleCount: number;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Key-sorted JSON so semantically equal examples hash equally.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function isOperationMethod(method: string): method is OperationMethod {
  return (OPERATION_METHODS as readonly string[]).includes(method);
}

// Named example keys and single `example` values (Prism keys those
// "default") are both counted; Prism's random example `id` is ignored.
export function summarizeOperations(ops: readonly OperationLike[]): OperationsSummary {
  let exampleCount = 0;
  const operations = ops.map((op): OperationSummary => {
    const method = op.method.toLowerCase();
    if (!isOperationMethod(method)) {
      throw new Error(`Unexpected HTTP method from Prism: ${op.method}`);
    }
    const keys = new Set<string>();
    const hashed: { sortKey: string; entry: unknown }[] = [];
    for (const response of op.responses) {
      for (const content of response.contents ?? []) {
        for (const example of content.examples ?? []) {
          exampleCount += 1;
          keys.add(example.key);
          hashed.push({
            sortKey: `${response.code}\u0000${content.mediaType}\u0000${example.key}`,
            entry: {
              code: response.code,
              mediaType: content.mediaType,
              key: example.key,
              value:
                example.externalValue === undefined
                  ? example.value
                  : { externalValue: example.externalValue },
            },
          });
        }
      }
    }
    hashed.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    return {
      method,
      path: op.path,
      summary: op.summary ?? null,
      codes: [...new Set(op.responses.map((response) => response.code))].sort(),
      examples: [...keys].sort(),
      examplesHash: sha256Hex(canonicalJson(hashed.map((item) => item.entry))),
    };
  });
  operations.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  );
  return { operations, endpointCount: operations.length, exampleCount };
}
