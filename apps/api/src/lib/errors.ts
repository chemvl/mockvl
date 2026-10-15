// HTTP statuses an AppError may carry. A literal union (rather than `number`)
// keeps invalid statuses out at compile time and stays assignable to Hono's
// ContentfulStatusCode without a cast.
export type ErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 405
  | 409
  | 410
  | 412
  | 413
  | 415
  | 422
  | 428
  | 429
  | 431
  | 500
  | 501
  | 502
  | 503
  | 504;

export class AppError extends Error {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly details?: unknown;

  constructor(code: string, status: ErrorStatus, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", details?: unknown) {
    super("UNAUTHORIZED", 401, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Permission denied", details?: unknown) {
    super("FORBIDDEN", 403, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: unknown) {
    super("NOT_FOUND", 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: unknown) {
    super("CONFLICT", 409, message, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests", details?: unknown) {
    super("RATE_LIMITED", 429, message, details);
  }
}

export class UpstreamError extends AppError {
  constructor(message = "Upstream service error", details?: unknown) {
    super("UPSTREAM_ERROR", 502, message, details);
  }
}

// Own code (not FORBIDDEN) so the UI can show "use your company account"
// instead of a generic permissions failure. Raised when APP_GOOGLE_ALLOWED_HD
// is set and the account is outside that Google Workspace domain.
export class DomainNotAllowedError extends AppError {
  constructor(domain: string, details?: unknown) {
    super("DOMAIN_NOT_ALLOWED", 403, `Use your ${domain} Google account.`, details);
  }
}
