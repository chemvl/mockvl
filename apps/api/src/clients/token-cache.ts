// In-memory cache for OAuth client-credentials access tokens: returns the
// cached token until 30s before expiry, then refreshes transparently. The
// example provider uses a static API key, but providers that hand out
// short-lived tokens plug their token endpoint into `fetchToken` and pass
// `getToken`'s result as the authorization header per request.

const EXPIRY_SKEW_MS = 30_000;

export interface FetchedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export interface TokenCacheOptions {
  /** Calls the provider's token endpoint (client-credentials grant). */
  fetchToken: () => Promise<FetchedToken>;
  /** Injectable clock for tests. */
  nowFn?: () => Date;
}

export function createTokenCache(options: TokenCacheOptions) {
  const { fetchToken, nowFn = () => new Date() } = options;

  let cached: { accessToken: string; expiresAtMs: number } | undefined;
  // Single-flight: concurrent callers during a refresh await the same fetch
  // instead of stampeding the token endpoint.
  let inFlight: Promise<string> | undefined;

  async function refresh(): Promise<string> {
    const token = await fetchToken();
    cached = {
      accessToken: token.accessToken,
      expiresAtMs: nowFn().getTime() + token.expiresInSeconds * 1000,
    };
    return token.accessToken;
  }

  return {
    async getToken(): Promise<string> {
      if (cached && cached.expiresAtMs - nowFn().getTime() > EXPIRY_SKEW_MS) {
        return cached.accessToken;
      }
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}

export type TokenCache = ReturnType<typeof createTokenCache>;
