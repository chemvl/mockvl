import { ADMIN_API_URL } from './config';

// Refine's HttpError contract is structural ({ message, statusCode, errors? });
// a real Error subclass satisfies it and keeps stack traces + lint happy.
export class AdminHttpError extends Error {
  readonly statusCode: number;
  readonly errors?: unknown;

  constructor(message: string, statusCode: number, errors?: unknown) {
    super(message);
    this.name = 'AdminHttpError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: unknown };
};

// Plain fetch against the admin API. NEVER the generated hey-api client — that
// one belongs to the legacy Bearer-token realm; the admin realm rides on the
// httpOnly admin_session cookie, hence credentials: 'include'. Every non-GET
// needs the X-Requested-With CSRF header or the API answers 403.
export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET') {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const envelope = (await response
      .json()
      .catch(() => null)) as ErrorEnvelope | null;
    throw new AdminHttpError(
      envelope?.error?.message ??
        `Request failed with status ${response.status}`,
      response.status,
      envelope?.error?.details,
    );
  }

  return (await response.json().catch(() => undefined)) as T;
}
