import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createAuthService } from "@/modules/auth/auth.service";
import type { GoogleIdClaims, GoogleTokenVerifier } from "@/modules/auth/google-token";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { createUsersService } from "@/modules/users/users.service";
import { prepareTestDatabase } from "../helpers/test-db";

// Full auth flow: google login → me → refresh → old refresh rejected →
// logout → refresh rejected.
// Runs the real stack (routes → services → repos) against the compose Postgres
// (docker compose up -d; prepareTestDatabase() below creates and migrates the
// test database). Services are built over this
// file's own pool: db.test.ts closes the shared one in its afterAll, and test
// files share a process, so relying on it would couple us to file order.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

// Injected fake for the Google seam (no real Google calls): each scenario sets
// the claims (or an Error) it wants the verifier to produce.
let googleVerifierResult: GoogleIdClaims | Error = new Error("google verifier not stubbed");
const googleTokenVerifier: GoogleTokenVerifier = {
  async verify() {
    if (googleVerifierResult instanceof Error) throw googleVerifierResult;
    return googleVerifierResult;
  },
};

const userRepo = createUserRepo(db);
const app = createApp({
  authService: createAuthService({
    userRepo,
    refreshTokenRepo: createRefreshTokenRepo(db),
    enqueue: async () => null,
    googleTokenVerifier,
    jwtSecret: env.JWT_SECRET,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3_600,
  }),
  // Over this file's own pool — the shared db client's pool may be closed by
  // another test file's afterAll (see the comment above).
  usersService: createUsersService({ userRepo }),
  // This flow makes more /auth requests than the strict production limit
  // allows (and will outgrow the global one as scenarios accrue); rate
  // limiting has its own coverage in hardening.test.ts.
  rateLimit: {
    auth: { windowMs: 60_000, limit: 1_000 },
    global: { windowMs: 60_000, limit: 10_000 },
  },
});

const email = `phase3-e2e-${crypto.randomUUID()}@example.com`;
const cleanupEmails: string[] = [email];

afterAll(async () => {
  for (const cleanupEmail of cleanupEmails) {
    await db.delete(schema.users).where(eq(schema.users.email, cleanupEmail));
  }
  await pool.end({ timeout: 5 });
});

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getMe(accessToken?: string) {
  return app.request("/api/users/me", {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

interface AuthBody {
  data: { user: { id: string; email: string }; accessToken: string; refreshToken: string };
}
interface PairBody {
  data: { accessToken: string; refreshToken: string };
}

describe("Phase 3 acceptance: full auth flow", () => {
  test("login → me → refresh → reuse rejected → logout → refresh rejected", async () => {
    googleVerifierResult = {
      sub: `phase3-e2e-sub-${crypto.randomUUID()}`,
      email,
      email_verified: true,
    };
    const signIn = async () =>
      (
        (await (
          await postJson("/api/auth/google", { idToken: "fake-but-verified" })
        ).json()) as AuthBody
      ).data;

    // 1. Login
    const login = await signIn();

    // 2. /users/me
    const meRes = await getMe(login.accessToken);
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { data: { id: string; email: string } };
    expect(meBody.data).toMatchObject({ id: login.user.id, email });
    expect((await getMe()).status).toBe(401);
    expect((await getMe("garbage.token.value")).status).toBe(401);

    // 3. Refresh rotates the pair; the old access token stays valid until exp.
    const refreshRes = await postJson("/api/auth/refresh", { refreshToken: login.refreshToken });
    expect(refreshRes.status).toBe(200);
    const rotated = ((await refreshRes.json()) as PairBody).data;
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect((await getMe(login.accessToken)).status).toBe(200);

    // 4. Replaying the pre-rotation token is reuse: 401, and the whole
    //    family dies — the legitimate successor is rejected too.
    const replayRes = await postJson("/api/auth/refresh", { refreshToken: login.refreshToken });
    expect(replayRes.status).toBe(401);
    const successorRes = await postJson("/api/auth/refresh", {
      refreshToken: rotated.refreshToken,
    });
    expect(successorRes.status).toBe(401);

    // 5. Fresh session, then logout kills its refresh token...
    const relogin = await signIn();
    const logoutRes = await postJson("/api/auth/logout", { refreshToken: relogin.refreshToken });
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ data: { success: true } });

    const postLogoutRefresh = await postJson("/api/auth/refresh", {
      refreshToken: relogin.refreshToken,
    });
    expect(postLogoutRefresh.status).toBe(401);

    // ...and logout is idempotent.
    const logoutAgain = await postJson("/api/auth/logout", { refreshToken: relogin.refreshToken });
    expect(logoutAgain.status).toBe(200);
  });
});

describe("Google sign-in flow", () => {
  test("first google login creates an account → me → refresh; returning login reuses it", async () => {
    const googleEmail = `google-e2e-${crypto.randomUUID()}@example.com`;
    cleanupEmails.push(googleEmail);
    googleVerifierResult = {
      sub: `google-e2e-sub-${crypto.randomUUID()}`,
      email: googleEmail,
      email_verified: true,
    };

    // 1. First sign-in creates a password-less account and issues tokens.
    const firstRes = await postJson("/api/auth/google", { idToken: "fake-but-verified" });
    expect(firstRes.status).toBe(200);
    const first = ((await firstRes.json()) as AuthBody).data;
    expect(first.user.email).toBe(googleEmail);
    // Google accounts are verified from birth — never gated (Phase 11c).
    expect((first.user as { emailVerified?: boolean }).emailVerified).toBe(true);
    const rawBody = JSON.stringify(first);
    expect(rawBody).not.toContain("passwordHash");
    expect(rawBody).not.toContain("googleSub");

    // 2. The issued tokens work like any other session.
    const meRes = await getMe(first.accessToken);
    expect(meRes.status).toBe(200);
    expect(((await meRes.json()) as { data: { id: string } }).data.id).toBe(first.user.id);

    const refreshRes = await postJson("/api/auth/refresh", { refreshToken: first.refreshToken });
    expect(refreshRes.status).toBe(200);

    // 3. A returning google login lands on the same account.
    const secondRes = await postJson("/api/auth/google", { idToken: "fake-but-verified" });
    expect(secondRes.status).toBe(200);
    expect(((await secondRes.json()) as AuthBody).data.user.id).toBe(first.user.id);
  });

  test("a verified google email auto-links to an existing password account", async () => {
    const linkEmail = `google-link-e2e-${crypto.randomUUID()}@example.com`;
    cleanupEmails.push(linkEmail);

    const existing = await userRepo.insert({ email: linkEmail, passwordHash: "hash" });
    // Case-different email exercises the lower(email) match.
    googleVerifierResult = {
      sub: `google-e2e-sub-${crypto.randomUUID()}`,
      email: linkEmail.toUpperCase(),
      email_verified: true,
    };
    const googleRes = await postJson("/api/auth/google", { idToken: "fake-but-verified" });
    expect(googleRes.status).toBe(200);
    expect(((await googleRes.json()) as AuthBody).data.user.id).toBe(existing.id);
  });

  test("a rejected google token maps to a generic 401", async () => {
    googleVerifierResult = new Error("signature mismatch");

    const res = await postJson("/api/auth/google", { idToken: "garbage" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Invalid Google token");
  });
});
