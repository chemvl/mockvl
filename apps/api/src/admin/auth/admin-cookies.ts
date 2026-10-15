import type { CookieOptions } from "hono/utils/cookie";
import { env } from "@/config/env";

export const ADMIN_SESSION_COOKIE = "admin_session";
export const OAUTH_STATE_COOKIE = "admin_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "admin_oauth_verifier";

// The consent round-trip should take seconds; ten minutes is generous.
const OAUTH_FLOW_TTL_S = 600;

// Scoped to <base path>/admin/auth so the state/verifier never ride on other
// requests. Must carry the base path or the browser won't send the cookies
// back to the Google callback and sign-in silently fails.
export const OAUTH_TEMP_COOKIE_PATH = `${env.API_BASE_PATH}/admin/auth`;

export function oauthTempCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV !== "development",
    sameSite: "Lax",
    path: OAUTH_TEMP_COOKIE_PATH,
    maxAge: OAUTH_FLOW_TTL_S,
  };
}

// httpOnly + SameSite=Lax + Secure per the security rules. Secure is relaxed
// only for local development: Safari refuses Secure cookies on plain-http
// localhost, which would make the admin flow silently undebuggable there.
export function adminSessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV !== "development",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  };
}
