import { client } from "@/client/client.gen";
import { refreshTokens } from "@/client/sdk.gen";
import { clearSession, getAccessToken, getRefreshToken, setSession } from "@/features/auth/token-store";
import { ApiError, toApiError } from "./errors";

// Generated SDK URLs already carry /api (the document's paths include
// API_BASE_PATH), so the client base URL is the page origin ("").
const AUTH_PATH = "/api/auth/";

let refreshInFlight: Promise<string | null> | null = null;

async function runRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await refreshTokens({ body: { refreshToken }, throwOnError: true });
    setSession(data.data);
    return data.data.accessToken;
  } catch (error) {
    // 4xx = the refresh token is dead → sign out. Network/5xx → keep the session.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) clearSession();
    return null;
  }
}

/** Single-flight: concurrent 401s share one refresh call. */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function withBearer(request: Request, token: string | null): Request {
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  // /api/auth/* never carries a bearer and never triggers a refresh (no recursion).
  if (new URL(request.url).pathname.startsWith(AUTH_PATH)) return fetch(request);

  const retry = request.clone();
  const token = getAccessToken() ?? (await refreshAccessToken());
  const response = await fetch(withBearer(request, token));
  if (response.status !== 401) return response;

  const fresh = await refreshAccessToken();
  if (!fresh) {
    clearSession();
    return response;
  }
  return fetch(withBearer(retry, fresh));
}

export function configureApiClient(): void {
  client.setConfig({ baseUrl: "", fetch: authFetch });
  // HTTP errors arrive with the parsed body; fetch failures with response undefined.
  client.interceptors.error.use((error, response) => toApiError(error, response?.status));
}
