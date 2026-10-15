import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createAuthService } from "@/modules/auth/auth.service";
import type { GoogleIdClaims } from "@/modules/auth/google-token";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

// The fake exchanger turns "code:<token>" into "<token>"; the fake verifier
// maps that token to claims. "bad" codes fail the exchange.
const claimsByToken = new Map<string, GoogleIdClaims>();
const emails: string[] = [];

function registerIdentity(token: string, hd: string | undefined): string {
  const email = `code-e2e-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  claimsByToken.set(token, {
    sub: `sub-${crypto.randomUUID()}`,
    email,
    email_verified: true,
    ...(hd === undefined ? {} : { hd }),
  });
  return email;
}

const app = createApp({
  authService: createAuthService({
    userRepo: createUserRepo(db),
    refreshTokenRepo: createRefreshTokenRepo(db),
    enqueue: async () => null,
    googleTokenVerifier: {
      async verify(idToken) {
        const claims = claimsByToken.get(idToken);
        if (!claims) throw new Error("unknown token");
        return claims;
      },
    },
    googleCodeExchanger: {
      async exchange(code) {
        if (!code.startsWith("code:")) throw new Error("invalid_grant");
        return code.slice("code:".length);
      },
    },
    allowedHd: "example.com",
    jwtSecret: env.JWT_SECRET,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3_600,
  }),
  rateLimit: {
    auth: { windowMs: 60_000, limit: 1_000 },
    global: { windowMs: 60_000, limit: 10_000 },
  },
});

afterAll(async () => {
  if (emails.length > 0) await db.delete(schema.users).where(inArray(schema.users.email, emails));
  await pool.end({ timeout: 5 });
});

function postCode(code: string, withHeader = true) {
  return app.request("/api/auth/google/code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withHeader ? { "x-requested-with": "XMLHttpRequest" } : {}),
    },
    body: JSON.stringify({ code }),
  });
}

describe("POST /api/auth/google/code", () => {
  test("exchanges the code and returns a session", async () => {
    const email = registerIdentity("tok-ok", "example.com");
    const res = await postCode("code:tok-ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { user: { email: string }; accessToken: string; refreshToken: string };
    };
    expect(body.data.user.email).toBe(email);
    expect(body.data.accessToken).toBeString();
    expect(body.data.refreshToken).toBeString();
  });

  test("requires X-Requested-With: XMLHttpRequest", async () => {
    registerIdentity("tok-csrf", "example.com");
    const res = await postCode("code:tok-csrf", false);
    expect(res.status).toBe(403);
  });

  test("a failed exchange is 401 GOOGLE_CODE_INVALID", async () => {
    const res = await postCode("bad");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("GOOGLE_CODE_INVALID");
  });

  test("an off-domain account is 403 DOMAIN_NOT_ALLOWED", async () => {
    registerIdentity("tok-gmail", undefined);
    const res = await postCode("code:tok-gmail");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("DOMAIN_NOT_ALLOWED");
    expect(body.error.message).toBe("Use your example.com Google account.");
  });
});
