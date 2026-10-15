import { UpstreamError } from "@/lib/errors";

// Base wrapper for third-party HTTP APIs: per-attempt timeout via
// AbortController, exponential backoff + jitter on transient failures only
// (429 / 5xx / network / timeout — never other 4xx), and every failure mapped
// to UpstreamError so upstream problems surface as our 502 envelope.
//
// Credential safety: request headers and bodies are NEVER copied into error
// messages, error details, or logs — only the provider name, URL path-less
// status, and attempt count may leave this module.

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 250;

export interface HttpClientOptions {
  /** Provider name carried in UpstreamError details (e.g. "example"). */
  name: string;
  baseUrl: string;
  /** Default headers sent on every request (e.g. authorization). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Extra attempts after the first (2 → up to 3 attempts total). */
  retries?: number;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** JSON-serialized into the body with content-type application/json. */
  body?: unknown;
  query?: Record<string, string>;
}

interface UpstreamErrorDetails {
  provider: string;
  status?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Reads the upstream HTTP status off an UpstreamError thrown by this client.
 * Lets services map specific upstream statuses (e.g. 404) to domain errors
 * without reaching into `details` untyped.
 */
export function getUpstreamStatus(error: unknown): number | undefined {
  if (!(error instanceof UpstreamError)) return undefined;
  const details = error.details as Partial<UpstreamErrorDetails> | undefined;
  return typeof details?.status === "number" ? details.status : undefined;
}

export function createHttpClient(options: HttpClientOptions) {
  const {
    name,
    baseUrl,
    headers: defaultHeaders = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    fetchFn = fetch,
    sleepFn = defaultSleep,
    randomFn = Math.random,
  } = options;

  const baseOrigin = new URL(baseUrl).origin;

  function buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(path, baseUrl);
    if (url.origin !== baseOrigin) {
      // An absolute or protocol-relative `path` would override baseUrl and
      // send the default headers (the provider's credential) to another host.
      throw new Error(`${name}: request path must stay on ${baseOrigin}, got ${url.origin}`);
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  function backoffDelay(attempt: number): number {
    return BACKOFF_BASE_MS * 2 ** attempt + randomFn() * BACKOFF_BASE_MS;
  }

  // Core retry loop. `consume` runs while the attempt's timeout is still
  // armed, so reading the body counts against timeoutMs — an upstream that
  // sends headers and then stalls the body still gets aborted and retried.
  async function performRequest<T>(
    path: string,
    requestOptions: RequestOptions,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const { method = "GET", headers, body, query } = requestOptions;
    const url = buildUrl(path, query);
    const init: RequestInit = {
      method,
      headers: {
        ...defaultHeaders,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let lastFailure: { status?: number; message: string } = { message: "request failed" };

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleepFn(backoffDelay(attempt - 1));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, { ...init, signal: controller.signal });

        if (response.ok) return await consume(response);

        // Drain the failed body so the connection returns to the pool
        // instead of leaking until GC — retry storms during an upstream
        // outage would otherwise exhaust it.
        await response.body?.cancel().catch(() => {});
        lastFailure = { status: response.status, message: `upstream returned ${response.status}` };
        if (!isRetryableStatus(response.status)) break;
      } catch (error) {
        if (error instanceof UpstreamError) throw error; // consume() mapped it — final
        // Timeout (headers or body) and network errors are transient — retry.
        lastFailure = isAbortError(error)
          ? { message: `request timed out after ${timeoutMs}ms` }
          : { message: error instanceof Error ? error.message : "network error" };
      } finally {
        clearTimeout(timer);
      }
    }

    throw new UpstreamError(`${name}: ${lastFailure.message}`, {
      provider: name,
      ...(lastFailure.status === undefined ? {} : { status: lastFailure.status }),
    });
  }

  /**
   * Returns the raw 2xx Response. The timeout only covers time-to-headers
   * here — the caller owns the body stream. Prefer json() unless streaming.
   */
  function request(path: string, requestOptions: RequestOptions = {}): Promise<Response> {
    return performRequest(path, requestOptions, async (response) => response);
  }

  /** Fetches and parses a JSON body, all within the attempt's timeout. */
  function json(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    return performRequest(path, requestOptions, async (response) => {
      try {
        return await response.json();
      } catch (error) {
        if (isAbortError(error)) throw error; // stalled body — let the loop retry
        throw new UpstreamError(`${name}: invalid JSON in response body`, { provider: name });
      }
    });
  }

  return { request, json };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
