import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "@/lib/context";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${c.req.method} ${c.req.path}`,
        requestId: c.get("requestId"),
      },
    },
    404,
  );

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestContext = {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
  };

  // Hono raises HTTPExceptions itself (e.g. malformed JSON before Zod runs,
  // body limits in later phases). Keep their status instead of degrading to
  // 500: a 400 is a validation failure with the same details shape as
  // schema errors; anything else gets the envelope under a generic code.
  if (err instanceof HTTPException && err.status !== 400) {
    logger.warn({ err, status: err.status, ...requestContext }, "request failed");
    return c.json(
      {
        error: {
          code: "HTTP_ERROR",
          message: err.message,
          requestId: requestContext.requestId,
        },
      },
      err.status,
    );
  }

  const appError =
    err instanceof HTTPException
      ? new ValidationError(err.message, { formErrors: [err.message], fieldErrors: {} })
      : err;

  if (appError instanceof AppError) {
    logger.warn({ err: appError, code: appError.code, ...requestContext }, "request failed");
    return c.json(
      {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details !== undefined && { details: appError.details }),
          requestId: requestContext.requestId,
        },
      },
      appError.status,
    );
  }

  logger.error({ err, ...requestContext }, "unhandled error");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: requestContext.requestId,
      },
    },
    500,
  );
};
