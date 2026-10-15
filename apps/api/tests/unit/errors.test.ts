import "../setup";
import { describe, expect, test } from "bun:test";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from "@/lib/errors";

describe("AppError", () => {
  test("carries code, status, message and details", () => {
    const err = new AppError("SOME_CODE", 422, "unprocessable", { hint: "short and stout" });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("SOME_CODE");
    expect(err.status).toBe(422);
    expect(err.message).toBe("unprocessable");
    expect(err.details).toEqual({ hint: "short and stout" });
  });
});

describe("AppError subclasses", () => {
  const cases = [
    { Ctor: ValidationError, code: "VALIDATION_ERROR", status: 400 },
    { Ctor: UnauthorizedError, code: "UNAUTHORIZED", status: 401 },
    { Ctor: ForbiddenError, code: "FORBIDDEN", status: 403 },
    { Ctor: NotFoundError, code: "NOT_FOUND", status: 404 },
    { Ctor: ConflictError, code: "CONFLICT", status: 409 },
    { Ctor: RateLimitError, code: "RATE_LIMITED", status: 429 },
    { Ctor: UpstreamError, code: "UPSTREAM_ERROR", status: 502 },
  ] as const;

  for (const { Ctor, code, status } of cases) {
    test(`${Ctor.name} maps to ${status} ${code}`, () => {
      const err = new Ctor("something went wrong", { field: "x" });

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      expect(err.message).toBe("something went wrong");
      expect(err.details).toEqual({ field: "x" });
    });

    test(`${Ctor.name} has a default message`, () => {
      const err = new Ctor();

      expect(err.message.length).toBeGreaterThan(0);
      expect(err.details).toBeUndefined();
    });
  }
});
