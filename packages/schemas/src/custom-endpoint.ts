import { z } from "@hono/zod-openapi";
import { OperationMethodSchema } from "./mock";

// Statuses the mock runtime always sends without a body (Fetch "null body
// status"). Custom responses and overrides can't give them one.
export const NO_BODY_STATUS_CODES: readonly number[] = [101, 204, 205, 304];
export const MAX_CUSTOM_RESPONSE_HEADERS = 20;

// The status Prism serves when a request has no `Prefer: code=` (verified
// against prism-http 5.16): the lowest 2xx, else the lowest code.
export function defaultServedStatus(statuses: readonly number[]): number | null {
  const sorted = [...statuses].sort((a, b) => a - b);
  return sorted.find((status) => status >= 200 && status < 300) ?? sorted[0] ?? null;
}

// Shapes only. Path, status, header and body rules are the service's, so the
// UI gets the spec's error codes and messages (custom mocks spec § Validation).
export const CustomResponseSchema = z
  .object({
    status: z.number().int().openapi({ example: 200 }),
    headers: z.record(z.string(), z.string()).openapi({ example: { "x-total-count": "3" } }),
    body: z.string().nullable().openapi({
      example: '{\n  "id": 1\n}',
      description: "Default response as JSON text; null for an empty body",
    }),
  })
  .openapi("CustomResponse");
export type CustomResponse = z.infer<typeof CustomResponseSchema>;

export const CustomEndpointSchema = z
  .object({
    kind: z.literal("http"),
    method: OperationMethodSchema,
    path: z.string().min(1).max(2000).openapi({ example: "/users/{id}" }),
    summary: z.string().max(200).optional(),
    responses: z.array(CustomResponseSchema),
  })
  .openapi("CustomEndpoint");
export type CustomEndpoint = z.infer<typeof CustomEndpointSchema>;

export const CustomEndpointSummarySchema = z
  .object({
    kind: z.literal("http"),
    method: OperationMethodSchema,
    path: z.string(),
    summary: z.string().nullable(),
    responses: z.array(
      z.object({
        status: z.number().int(),
        headerNames: z.array(z.string()),
        hasBody: z.boolean(),
      }),
    ),
  })
  .openapi("CustomEndpointSummary");
export type CustomEndpointSummary = z.infer<typeof CustomEndpointSummarySchema>;

export const CustomEndpointListSchema = z
  .object({ version: z.number().int(), endpoints: z.array(CustomEndpointSummarySchema) })
  .openapi("CustomEndpointList");
export type CustomEndpointList = z.infer<typeof CustomEndpointListSchema>;

export const CustomEndpointResultSchema = z
  .object({ version: z.number().int(), endpoint: CustomEndpointSchema })
  .openapi("CustomEndpointResult");
export type CustomEndpointResult = z.infer<typeof CustomEndpointResultSchema>;

export const SaveCustomEndpointSchema = z
  .object({
    baseVersion: z
      .number()
      .int()
      .min(1)
      .openapi({ description: "Live version number the editor loaded" }),
    endpoint: CustomEndpointSchema,
  })
  .openapi("SaveCustomEndpoint");
export type SaveCustomEndpoint = z.infer<typeof SaveCustomEndpointSchema>;

export const MockSchemaFileSchema = z
  .object({
    filename: z.string().openapi({ example: "orders.openapi.json" }),
    content: z.string(),
  })
  .openapi("MockSchemaFile");
export type MockSchemaFile = z.infer<typeof MockSchemaFileSchema>;
