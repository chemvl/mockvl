import "../setup";
import { describe, expect, test } from "bun:test";
import { type CreateAppOptions, createApp } from "@/app";
import { env } from "@/config/env";
import { UnauthorizedError } from "@/lib/errors";
import type { AuthService } from "@/modules/auth/auth.service";
import type { UsersService } from "@/modules/users/users.service";

// Phase 7 hardening: rate limiting, secure headers, CORS, body limit, and
// JSON-only content-type enforcement. All middleware behavior, so services
// are mocked — the refresh mock always rejects, mimicking a bad token.

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.com",
  name: null,
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: new Date("2026-07-03T00:00:00Z"),
};
const PAIR = { accessToken: "header.payload.sig", refreshToken: "r".repeat(43) };

function buildApp(options: CreateAppOptions = {}) {
  const authService: AuthService = {
    loginWithGoogle: async () => ({ user: USER, ...PAIR }),
    loginWithGoogleCode: async () => ({ user: USER, ...PAIR }),
    refresh: async () => {
      throw new UnauthorizedError("Invalid refresh token");
    },
    logout: async () => {},
  };
  const usersService: UsersService = {
    getMe: async (userId) => ({ ...USER, id: userId }),
  };
  return createApp({ authService, usersService, ...options });
}

type App = ReturnType<typeof buildApp>;

const REFRESH_BODY = JSON.stringify({ refreshToken: "r".repeat(43) });

function refresh(app: App, headers: Record<string, string> = {}) {
  return app.request("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: REFRESH_BODY,
  });
}

interface ErrorBody {
  error: { code: string; message: string; requestId?: string };
}

describe("secure headers", () => {
  test("every response carries the hono secure-headers defaults", async () => {
    const res = await buildApp().request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });
});

describe("CORS", () => {
  const allowedOrigin = new URL(env.ADMIN_URL).origin;

  test("preflight from ADMIN_URL is allowed with credentials", async () => {
    const res = await buildApp().request("/api/auth/refresh", {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("preflight from an unknown origin gets no allow-origin header", async () => {
    const res = await buildApp().request("/api/auth/refresh", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("actual cross-origin responses carry allow-origin, credentials, and exposed headers", async () => {
    const res = await buildApp().request("/api/health", { headers: { origin: allowedOrigin } });
    expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
  });
});

describe("rate limiting: /auth", () => {
  const tightAuth = {
    rateLimit: {
      auth: { windowMs: 60_000, limit: 3 },
      global: { windowMs: 60_000, limit: 1_000 },
    },
  };

  test("requests over the auth limit get the 429 envelope", async () => {
    const app = buildApp(tightAuth);
    for (let i = 0; i < 3; i++) {
      expect((await refresh(app)).status).toBe(401);
    }
    const limited = await refresh(app);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as ErrorBody;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBeString();
    expect(body.error.requestId).toBeDefined();
    expect(limited.headers.get("retry-after")).toBeDefined();
  });

  test("responses advertise RateLimit-* headers (draft-6)", async () => {
    const res = await refresh(buildApp(tightAuth));
    expect(res.headers.get("ratelimit-limit")).toBe("3");
    expect(res.headers.get("ratelimit-remaining")).toBe("2");
  });

  const tightAuthTrusted = {
    rateLimit: {
      auth: { windowMs: 60_000, limit: 3, trustProxy: true },
      global: { windowMs: 60_000, limit: 1_000, trustProxy: true },
    },
  };

  test("behind a trusted proxy, limits are keyed per client ip", async () => {
    const app = buildApp(tightAuthTrusted);
    for (let i = 0; i < 4; i++) {
      await refresh(app, { "x-forwarded-for": "10.0.0.1" });
    }
    expect((await refresh(app, { "x-forwarded-for": "10.0.0.1" })).status).toBe(429);
    expect((await refresh(app, { "x-forwarded-for": "10.0.0.2" })).status).toBe(401);
  });

  test("behind a trusted proxy, x-real-ip wins over x-forwarded-for", async () => {
    const app = buildApp(tightAuthTrusted);
    for (let i = 0; i < 4; i++) {
      // Rotating XFF must not rotate the key while the proxy-set x-real-ip
      // pins the same client.
      await refresh(app, { "x-real-ip": "10.0.0.1", "x-forwarded-for": `1.2.3.${i}` });
    }
    expect((await refresh(app, { "x-real-ip": "10.0.0.1" })).status).toBe(429);
    expect((await refresh(app, { "x-real-ip": "10.0.0.2" })).status).toBe(401);
  });

  test("behind a trusted proxy, only the rightmost x-forwarded-for hop counts", async () => {
    const app = buildApp(tightAuthTrusted);
    for (let i = 0; i < 4; i++) {
      // The client-forged left hops rotate; the proxy-appended rightmost hop
      // is the same client, so the budget must drain.
      await refresh(app, { "x-forwarded-for": `1.2.3.${i}, 10.0.0.1` });
    }
    expect((await refresh(app, { "x-forwarded-for": "9.9.9.9, 10.0.0.1" })).status).toBe(429);
  });

  test("without a trusted proxy, forwarded headers are ignored entirely", async () => {
    // Default trustProxy=false: a client rotating x-forwarded-for (or
    // x-real-ip) must not mint fresh buckets — everything keys on the socket.
    const app = buildApp(tightAuth);
    for (let i = 0; i < 3; i++) {
      await refresh(app, { "x-forwarded-for": `1.2.3.${i}`, "x-real-ip": `5.6.7.${i}` });
    }
    expect((await refresh(app, { "x-forwarded-for": "9.9.9.9" })).status).toBe(429);
  });

  test("the auth limit does not count non-auth traffic", async () => {
    const app = buildApp(tightAuth);
    for (let i = 0; i < 4; i++) {
      await refresh(app);
    }
    expect((await refresh(app)).status).toBe(429);
    expect((await app.request("/api/health")).status).toBe(200);
  });
});

describe("rate limiting: /admin/auth", () => {
  const tightAuth = {
    rateLimit: {
      auth: { windowMs: 60_000, limit: 3 },
      global: { windowMs: 60_000, limit: 1_000 },
    },
  };

  test("the session check /admin/auth/me is exempt from the strict auth tier", async () => {
    // The admin shell calls /me on every navigation (authProvider.check +
    // route loaders); under the strict tier a handful of clicks locked the
    // admin out for the rest of the window.
    const app = buildApp(tightAuth);
    for (let i = 0; i < 10; i++) {
      expect((await app.request("/api/admin/auth/me")).status).toBe(401);
    }
  });

  test("/me traffic does not drain the strict budget for the OAuth endpoints", async () => {
    const app = buildApp(tightAuth);
    for (let i = 0; i < 10; i++) {
      await app.request("/api/admin/auth/me");
    }
    expect((await app.request("/api/admin/auth/google")).status).toBe(302);
  });

  test("the OAuth endpoints stay strictly limited", async () => {
    const app = buildApp(tightAuth);
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/api/admin/auth/google")).status).toBe(302);
    }
    expect((await app.request("/api/admin/auth/google")).status).toBe(429);
  });

  test("/admin/auth/me is still bounded by the global tier", async () => {
    const app = buildApp({
      rateLimit: {
        auth: { windowMs: 60_000, limit: 1_000 },
        global: { windowMs: 60_000, limit: 2 },
      },
    });
    expect((await app.request("/api/admin/auth/me")).status).toBe(401);
    expect((await app.request("/api/admin/auth/me")).status).toBe(401);
    expect((await app.request("/api/admin/auth/me")).status).toBe(429);
  });
});

describe("rate limiting: global default", () => {
  test("requests over the global limit get the 429 envelope", async () => {
    const app = buildApp({ rateLimit: { global: { windowMs: 60_000, limit: 2 } } });
    expect((await app.request("/api/users/me")).status).toBe(401);
    expect((await app.request("/api/users/me")).status).toBe(401);
    const limited = await app.request("/api/users/me");
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as ErrorBody).error.code).toBe("RATE_LIMITED");
  });

  test("liveness/readiness probes are exempt and don't consume the budget", async () => {
    const app = buildApp({ rateLimit: { global: { windowMs: 60_000, limit: 2 } } });
    // Probes never 429 (an orchestrator would pull the instance) and must not
    // drain the budget shared with real traffic behind the same NAT/ingress.
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/api/health")).status).toBe(200);
      expect((await app.request("/api/ready")).status).toBe(200);
    }
    expect((await app.request("/api/users/me")).status).toBe(401);
    expect((await app.request("/api/users/me")).status).toBe(401);
    expect((await app.request("/api/users/me")).status).toBe(429);
  });
});

describe("rate limiting: production defaults (Phase 7 acceptance)", () => {
  test("the 11th rapid refresh attempt returns 429 with the error envelope", async () => {
    const app = buildApp();
    const origin = new URL(env.ADMIN_URL).origin;
    for (let i = 0; i < 10; i++) {
      expect((await refresh(app, { origin })).status).toBe(401);
    }
    const limited = await refresh(app, { origin });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as ErrorBody;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBeDefined();
    // The 429 is still a well-formed cross-origin response: a browser client
    // must be able to read the envelope.
    expect(limited.headers.get("access-control-allow-origin")).toBe(origin);
  });
});

describe("body size limit", () => {
  test("an oversized body returns the 413 envelope", async () => {
    const oversized = JSON.stringify({
      refreshToken: "x".repeat(1024 * 1024 + 1),
    });
    const res = await buildApp().request("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.requestId).toBeDefined();
  });
});

describe("JSON-only content-type on mutating routes", () => {
  test("a non-JSON body is rejected with the 415 envelope", async () => {
    const res = await buildApp().request("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: REFRESH_BODY,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(body.error.requestId).toBeDefined();
  });

  test("multipart form uploads are rejected", async () => {
    const form = new FormData();
    form.set("refreshToken", "r".repeat(43));
    const res = await buildApp().request("/api/auth/refresh", { method: "POST", body: form });
    expect(res.status).toBe(415);
  });

  test("application/json with a charset parameter passes through", async () => {
    const res = await buildApp().request("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: REFRESH_BODY,
    });
    // Reaches the mocked service, which rejects the token.
    expect(res.status).toBe(401);
  });

  test("a body-less mutating request falls through to schema validation, not 415", async () => {
    const res = await buildApp().request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("GET requests are unaffected", async () => {
    const res = await buildApp().request("/api/health");
    expect(res.status).toBe(200);
  });
});
