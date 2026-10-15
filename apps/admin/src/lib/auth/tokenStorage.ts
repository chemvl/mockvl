/**
 * Token storage — typed wrapper over the namespaced localStorage helper.
 * Holds the OAuth access/refresh tokens and the access-token expiry timestamp.
 */
import storage from '@/lib/storage';

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const TOKEN_EXPIRES_AT_KEY = 'tokenExpiresAt';

const DEFAULT_EXPIRY_SKEW_MS = 30_000;

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export function setTokens(res: TokenResponse): void {
  storage.setItem(ACCESS_TOKEN_KEY, res.access_token);
  if (res.refresh_token) {
    storage.setItem(REFRESH_TOKEN_KEY, res.refresh_token);
  }
  storage.setItem(TOKEN_EXPIRES_AT_KEY, Date.now() + res.expires_in * 1000);
}

export function getAccessToken(): string | undefined {
  return storage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | undefined {
  return storage.getItem(REFRESH_TOKEN_KEY);
}

export function clearTokens(): void {
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
  storage.removeItem(TOKEN_EXPIRES_AT_KEY);
}

/** True when no expiry is stored or the access token is within `skewMs` of expiring. */
export function isExpiredOrExpiring(
  skewMs: number = DEFAULT_EXPIRY_SKEW_MS,
): boolean {
  const expiresAt = storage.getItem(TOKEN_EXPIRES_AT_KEY);
  if (typeof expiresAt !== 'number') return true;
  return Date.now() >= expiresAt - skewMs;
}
