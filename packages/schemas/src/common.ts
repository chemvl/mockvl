import { z } from "@hono/zod-openapi";

// The error envelope every endpoint returns on failure (PLAN §4.1), registered
// once as a shared OpenAPI component so error responses reference it by name.
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "Invalid request body" }),
      details: z.unknown().optional(),
      requestId: z.string().openapi({ example: "9f0e2b1c-6d4a-4a5e-9b3f-2c8d7e6f5a4b" }),
    }),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Success envelope for single resources: { data: ... } (PLAN §4.1).
export function envelope<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}

// Pagination block of the list envelope (PLAN §4.1).
export const ListMetaSchema = z
  .object({
    page: z.number().int().min(1).openapi({ example: 1 }),
    pageSize: z.number().int().min(1).openapi({ example: 20 }),
    total: z.number().int().min(0).openapi({ example: 137 }),
  })
  .openapi("ListMeta");

export type ListMeta = z.infer<typeof ListMetaSchema>;

// Success envelope for lists: { data: [...], meta: { page, pageSize, total } }.
export function listEnvelope<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), meta: ListMetaSchema });
}
