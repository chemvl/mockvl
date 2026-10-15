import "../setup";
import { describe, expect, mock, test } from "bun:test";
import type {
  AdminAuthService,
  AdminLoginResult,
  AdminSessionResult,
} from "@/admin/auth/admin-auth.service";
import {
  ADMIN_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/admin/auth/admin-cookies";
import { createApp } from "@/app";
import { env } from "@/config/env";
import type { AdminUser } from "@/db/schema";
import { UnauthorizedError } from "@/lib/errors";

const ADMIN: AdminUser = {
  id: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f",
  email: "ada@company.com",
  name: "Ada",
  avatarUrl: null,
  role: "viewer",
  createdAt: new Date("2026-07-06T00:00:00Z"),
};

const LOGIN_RESULT: AdminLoginResult = {
  sessionToken: "raw-session-token",
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  adminUser: ADMIN,
};

const SESSION_RESULT: AdminSessionResult = {
  adminUser: ADMIN,
  expiresAt: LOGIN_RESULT.expiresAt,
  renewed: false,
};

function fakeAdminAuthService(overrides: Partial<AdminAuthService> = {}): AdminAuthService {
  return {
    startGoogleLogin: mock(() => ({
      state: "state-abc",
      codeVerifier: "verifier-abc",
      url: new URL("https://accounts.google.com/o/oauth2/v2/auth?hd=example.com"),
    })),
    handleGoogleCallback: mock(async () => LOGIN_RESULT),
    validateSession: mock(async () => SESSION_RESULT),
    logout: mock(async () => {}),
    ...overrides,
  } as AdminAuthService;
}

function cookiesOf(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe("GET /admin/auth/google", () => {
  test("redirects to Google and stashes state + verifier in scoped cookies", async () => {
    const app = createApp({ adminAuthService: fakeAdminAuthService() });

    const res = await app.request("/api/admin/auth/google");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toStartWith("https://accounts.google.com/");
    const cookies = cookiesOf(res);
    const stateCookie = cookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
    const verifierCookie = cookies.find((c) => c.startsWith(`${OAUTH_VERIFIER_COOKIE}=`));
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("Path=/api/admin/auth");
    expect(verifierCookie).toContain("HttpOnly");
  });
});

describe("GET /admin/auth/google/callback", () => {
  const TEMP_COOKIES = `${OAUTH_STATE_COOKIE}=state-abc; ${OAUTH_VERIFIER_COOKIE}=verifier-abc`;

  test("sets the session cookie and redirects to ADMIN_URL on success", async () => {
    const service = fakeAdminAuthService();
    const app = createApp({ adminAuthService: service });

    const res = await app.request("/api/admin/auth/google/callback?code=the-code&state=state-abc", {
      headers: { cookie: TEMP_COOKIES },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(env.ADMIN_URL);
    const cookies = cookiesOf(res);
    const sessionCookie = cookies.find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    expect(sessionCookie).toContain("raw-session-token");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie?.toLowerCase()).toContain("samesite=lax");
    // Temp cookies are burned after one use.
    expect(cookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=;`))).toBeDefined();
    expect(cookies.find((c) => c.startsWith(`${OAUTH_VERIFIER_COOKIE}=;`))).toBeDefined();
    expect(service.handleGoogleCallback).toHaveBeenCalledWith("the-code", "verifier-abc");
  });

  test("rejects a state mismatch without calling Google", async () => {
    const service = fakeAdminAuthService();
    const app = createApp({ adminAuthService: service });

    const res = await app.request("/api/admin/auth/google/callback?code=the-code&state=tampered", {
      headers: { cookie: TEMP_COOKIES },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${env.ADMIN_URL}?error=admin_login_failed`);
    expect(cookiesOf(res).find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`))).toBeUndefined();
    expect(service.handleGoogleCallback).not.toHaveBeenCalled();
  });

  test("rejects when the temp cookies are missing", async () => {
    const service = fakeAdminAuthService();
    const app = createApp({ adminAuthService: service });

    const res = await app.request("/api/admin/auth/google/callback?code=the-code&state=state-abc");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${env.ADMIN_URL}?error=admin_login_failed`);
    expect(service.handleGoogleCallback).not.toHaveBeenCalled();
  });

  test("redirects with the generic error when the service rejects the login", async () => {
    const service = fakeAdminAuthService({
      handleGoogleCallback: mock(async () => {
        throw new UnauthorizedError("Admin sign-in failed");
      }),
    });
    const app = createApp({ adminAuthService: service });

    const res = await app.request("/api/admin/auth/google/callback?code=the-code&state=state-abc", {
      headers: { cookie: TEMP_COOKIES },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${env.ADMIN_URL}?error=admin_login_failed`);
    expect(cookiesOf(res).find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`))).toBeUndefined();
  });
});

describe("GET /admin/auth/me", () => {
  test("returns the serialized admin user for a valid session", async () => {
    const app = createApp({ adminAuthService: fakeAdminAuthService() });

    const res = await app.request("/api/admin/auth/me", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=raw-session-token` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string; createdAt: string } };
    expect(body.data.email).toBe("ada@company.com");
    expect(body.data.createdAt).toBe("2026-07-06T00:00:00.000Z");
  });

  test("401s without a session cookie", async () => {
    const app = createApp({ adminAuthService: fakeAdminAuthService() });

    const res = await app.request("/api/admin/auth/me");

    expect(res.status).toBe(401);
  });
});

describe("POST /admin/auth/logout", () => {
  test("requires the X-Requested-With CSRF header", async () => {
    const service = fakeAdminAuthService();
    const app = createApp({ adminAuthService: service });

    const res = await app.request("/api/admin/auth/logout", {
      method: "POST",
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=raw-session-token` },
    });

    expect(res.status).toBe(403);
    expect(service.logout).not.toHaveBeenCalled();
  });

  test("deletes the session, clears the cookie, and is idempotent", async () => {
    const service = fakeAdminAuthService();
    const app = createApp({ adminAuthService: service });
    const headers = {
      cookie: `${ADMIN_SESSION_COOKIE}=raw-session-token`,
      "X-Requested-With": "XMLHttpRequest",
    };

    const res = await app.request("/api/admin/auth/logout", { method: "POST", headers });

    expect(res.status).toBe(200);
    expect(service.logout).toHaveBeenCalledWith("raw-session-token");
    expect(cookiesOf(res).find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=;`))).toBeDefined();

    // No cookie at all still 200s: nothing to learn from logout.
    const bare = await app.request("/api/admin/auth/logout", {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    expect(bare.status).toBe(200);
  });
});
