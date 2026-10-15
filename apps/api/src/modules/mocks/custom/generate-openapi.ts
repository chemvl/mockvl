import { STATUS_CODES } from "node:http";
import type { CustomEndpoint, CustomResponse } from "@starter/schemas";
import { inferSchema } from "./infer-schema";
import { pathParams } from "./validate-endpoint";

// Pure and deterministic: structural keys are inserted in sorted order, so
// the same list always gives the same bytes (and contentSha256/examplesHash).
// Examples keep the user's key order: they are served as the response body.
export function generateOpenApi(endpoints: readonly CustomEndpoint[], title: string): string {
  const sorted = [...endpoints].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  );
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of sorted) {
    const params = pathParams(endpoint.path);
    const responses = [...endpoint.responses].sort((a, b) => a.status - b.status);
    const operation: Record<string, unknown> = {
      ...(endpoint.summary ? { summary: endpoint.summary } : {}),
      ...(params.length > 0
        ? {
            parameters: params.map((name) => ({
              name,
              in: "path",
              required: true,
              schema: { type: "string" },
            })),
          }
        : {}),
      responses: Object.fromEntries(
        responses.map((response) => [String(response.status), responseObject(response)]),
      ),
    };
    const item = paths[endpoint.path] ?? {};
    item[endpoint.method] = operation;
    paths[endpoint.path] = item;
  }
  const doc = { openapi: "3.1.0", info: { title, version: "1.0.0" }, paths };
  return JSON.stringify(doc, null, 2);
}

function responseObject(response: CustomResponse): Record<string, unknown> {
  const names = Object.keys(response.headers).sort();
  const out: Record<string, unknown> = {
    description: STATUS_CODES[response.status] ?? "Response",
  };
  if (names.length > 0) {
    out.headers = Object.fromEntries(
      names.map((name) => [name, { schema: { type: "string" }, example: response.headers[name] }]),
    );
  }
  if (response.body !== null) {
    const example: unknown = JSON.parse(response.body);
    out.content = { "application/json": { schema: inferSchema(example), example } };
  }
  return out;
}
