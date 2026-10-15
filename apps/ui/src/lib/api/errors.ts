import { z } from "zod";

// Every API failure surfaces as ApiError { code, message, status }. `message`
// is user-facing copy from the API and is rendered verbatim in error Notices.
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
const UNKNOWN_ERROR_MESSAGE = "Something went wrong. Try again.";

export function toApiError(error: unknown, status: number | undefined): ApiError {
  if (error instanceof ApiError) return error;
  const parsed = ErrorEnvelopeSchema.safeParse(error);
  if (parsed.success) return new ApiError(parsed.data.error.code, parsed.data.error.message, status ?? 0);
  if (status === undefined) return new ApiError("NETWORK_ERROR", NETWORK_ERROR_MESSAGE, 0);
  return new ApiError("UNKNOWN", UNKNOWN_ERROR_MESSAGE, status);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UNKNOWN_ERROR_MESSAGE;
}
