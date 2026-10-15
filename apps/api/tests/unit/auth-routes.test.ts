import "../setup";
import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { UnauthorizedError } from "@/lib/errors";
import type { AuthService } from "@/modules/auth/auth.service";
import { signAccessToken } from "@/modules/auth/auth.tokens";
import type { UsersService } from "@/modules/users/users.service";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.com",
  name: null,
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: new Date("2026-07-03T00:00:00Z"),
};
const PAIR = { accessToken: "header.payload.sig", refreshToken: "r".repeat(43) };

function buildApp(overrides: Partial<AuthService> = {}) {
  const authService: AuthService = {
    loginWithGoogle: async () => ({ user: USER, ...PAIR }),
    loginWithGoogleCode: async () => ({ user: USER, ...PAIR }),
    refresh: async () => PAIR,
    logout: async () => {},
    ...overrides,
  };
  const usersService: UsersService = {
    getMe: async (userId) => ({ ...USER, id: userId }),
  };

  return createApp({ authService, usersService });
}

function postJson(app: ReturnType<typeof buildApp>, path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

type ErrorBody = {
  error: {
    code: string;
    details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
  };
};

describe("POST /auth/google", () => {
  test("returns 200 with user and tokens", async () => {
    const res = await postJson(buildApp(), "/api/auth/google", { idToken: "a-google-id-token" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { user: { email: string; createdAt: string }; accessToken: string };
    };
    expect(body.data.user.email).toBe(USER.email);
    expect(body.data.user.createdAt).toBe(USER.createdAt.toISOString());
    expect(body.data.accessToken).toBe(PAIR.accessToken);
  });

  test("rejects a missing idToken with field details", async () => {
    const res = await postJson(buildApp(), "/api/auth/google", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.fieldErrors?.idToken).toBeDefined();
  });

  test("rejects an empty idToken", async () => {
    const res = await postJson(buildApp(), "/api/auth/google", { idToken: "" });
    expect(res.status).toBe(400);
  });

  test("maps service UnauthorizedError through the error envelope", async () => {
    const app = buildApp({
      loginWithGoogle: async () => {
        throw new UnauthorizedError("Invalid Google token");
      },
    });
    const res = await postJson(app, "/api/auth/google", { idToken: "garbage" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /auth/refresh", () => {
  test("returns 200 with a new pair", async () => {
    const res = await postJson(buildApp(), "/api/auth/refresh", { refreshToken: "some-token" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: PAIR });
  });

  test("rejects a missing refreshToken", async () => {
    const res = await postJson(buildApp(), "/api/auth/refresh", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details?.fieldErrors?.refreshToken).toBeDefined();
  });
});

describe("POST /auth/logout", () => {
  test("returns 200 success", async () => {
    const res = await postJson(buildApp(), "/api/auth/logout", { refreshToken: "some-token" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true } });
  });
});

describe("GET /users/me", () => {
  test("requires a bearer token", async () => {
    const res = await buildApp().request("/api/users/me");
    expect(res.status).toBe(401);
  });

  test("returns the caller's user from the token subject", async () => {
    const token = await signAccessToken({
      sub: USER.id,
      secret: env.JWT_SECRET,
      ttlSeconds: 900,
    });
    const res = await buildApp().request("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; email: string } };
    expect(body.data.id).toBe(USER.id);
    expect(body.data.email).toBe(USER.email);
  });
});
