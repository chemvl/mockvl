import { QueryClient } from '@tanstack/react-query';
import { client } from '@/client/client.gen';
import { showToast } from '@/lib';
import { refreshAccessToken } from '@/lib/auth/refresh';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isExpiredOrExpiring,
} from '@/lib/auth/tokenStorage';
import { useAppStore } from '@/store';

// Auth endpoints (/auth, /auth/token, /auth/callback, /auth/faker, /auth/revoke) must never
// carry a Bearer header and must not trigger a refresh — that would loop on the refresh request
// itself. Match the path segment precisely so sibling paths like /author (which merely *starts*
// with "auth") are NOT misclassified as auth endpoints.
const AUTH_ENDPOINT_PATH = '/api/app/auth';

function isAuthEndpoint(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // request.url is normally absolute; fall back to the raw string.
  }
  return (
    path === AUTH_ENDPOINT_PATH || path.startsWith(`${AUTH_ENDPOINT_PATH}/`)
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 30_000,
    },
  },
});

function lookupError(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const { errors, messages } = useAppStore.getState();
  return errors[code] ?? messages[code] ?? fallback;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Attach the Bearer token to every request, refreshing proactively when the
// stored access token is expired or about to expire.
client.interceptors.request.use(async (request) => {
  // Admin-realm CSRF: the API rejects non-GET /admin requests that lack
  // X-Requested-With (apps/api middleware/admin-csrf.ts). Harmless elsewhere.
  if (MUTATION_METHODS.has(request.method)) {
    request.headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  if (isAuthEndpoint(request.url)) return request;

  let token = getAccessToken();
  if (token && isExpiredOrExpiring() && getRefreshToken()) {
    token = await refreshAccessToken();
  }
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

client.interceptors.response.use(async (response, request, options) => {
  if (response.ok) return response;

  // 401 — token rejected. Try a single-flight refresh and retry the request
  // once with the fresh token. Only clear tokens when the refresh itself
  // fails — otherwise a concurrent 401 (e.g. a POST list request) would wipe
  // the just-refreshed tokens and cascade every other request to 401.
  if (response.status === 401) {
    if (!isAuthEndpoint(request.url)) {
      const token = await refreshAccessToken();
      if (token) {
        const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
        const retry = new Request(request.url, {
          method: request.method,
          headers: new Headers(request.headers),
          body: hasBody
            ? (options.serializedBody as BodyInit | undefined)
            : undefined,
          redirect: 'follow',
        });
        retry.headers.set('Authorization', `Bearer ${token}`);
        // Raw fetch — bypasses the client interceptors so the retry can't loop.
        const doFetch = options.fetch ?? globalThis.fetch;
        return doFetch(retry);
      }
    }

    // The legacy product realm is parked: it must never navigate. The admin realm
    // (admin_session cookie) owns auth and /user/login; bouncing here would
    // kick a signed-in admin off the app when a legacy page's legacy call 401s.
    clearTokens();
    return response;
  }

  const data = await response
    .clone()
    .json()
    .catch(() => null);
  const code: string | undefined =
    (data as Record<string, string> | null)?.message ??
    (data as Record<string, string> | null)?.error;

  if (MUTATION_METHODS.has(request.method)) {
    showToast(lookupError(code, `An error occurred${code ? `: ${code}` : ''}`));
  }

  return response;
});
