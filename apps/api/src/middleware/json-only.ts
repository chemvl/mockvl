import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";
import { AppError } from "@/lib/errors";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// application/json, optionally with parameters (e.g. "; charset=utf-8").
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

// Headers alone aren't enough: a Request built in-process (app.request in
// tests) carries a body stream without a content-length header.
function hasBody(c: Context<AppEnv>): boolean {
  const contentLength = c.req.header("content-length");
  if (contentLength !== undefined) return contentLength !== "0";
  return c.req.header("transfer-encoding") !== undefined || c.req.raw.body !== null;
}

// Mutating requests must declare application/json. Body-less requests are
// left to schema validation (a required body still 400s there), and reads
// are untouched. If a route ever needs multipart uploads, exempt its path
// where this is mounted in app.ts.
export function jsonOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method) && hasBody(c)) {
      const contentType = c.req.header("content-type") ?? "";
      if (!JSON_CONTENT_TYPE.test(contentType)) {
        throw new AppError("UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json");
      }
    }
    await next();
  };
}
