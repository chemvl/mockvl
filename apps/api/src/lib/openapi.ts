import { OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@starter/schemas";
import type { AppEnv } from "@/lib/context";
import { ValidationError } from "@/lib/errors";

// Every router is built here so a wrong-shaped request anywhere in the app
// throws the same ValidationError, which the global onError turns into the
// standard 400 envelope with flattened field details.
export function createRouter(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ValidationError("Invalid request body", z.flattenError(result.error));
      }
    },
  });
}

// The root app's exact type after `.basePath(env.API_BASE_PATH || "/")` in
// app.ts: API_BASE_PATH is a runtime string, so the BasePath type param widens
// to `string`. Mount helpers (modules/index.ts, admin/mount.ts, ...) accept
// this alias so none of them import from app.ts — no import cycles.
export type AppOpenAPI = ReturnType<OpenAPIHono<AppEnv>["basePath"]>;

// Response helpers so route definitions stay declarative one-liners.
export function jsonContent<T extends z.ZodType>(schema: T, description: string) {
  return { content: { "application/json": { schema } }, description };
}

export function errorResponse(description: string) {
  return jsonContent(ErrorResponseSchema, description);
}

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { content: { "application/json": { schema } }, required: true } };
}
