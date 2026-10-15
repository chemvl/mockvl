import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { hashSessionToken } from "@/admin/auth/admin-tokens";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import type { GoogleClaims, GoogleOAuth } from "@/admin/auth/google";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { prepareTestDatabase } from "../helpers/test-db";

// Phase 9a acceptance flow: Google-mocked login → session cookie →
// /me → logout → /me rejected; wrong-hd login rejected with no session.
// Runs the real stack (routes → service → repos) against the compose Postgres;
// only the Google wire calls are faked, at the GoogleOAuth seam.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

const { adminUsers, adminSessions } = schema;

const OWNER_EMAIL = `phase9-owner-${crypto.randomUUID()}@example.com`;
const VIEWER_EMAIL = `phase9-viewer-${crypto.randomUUID()}@example.com`;

// Claims returned by the "Google" exchange — mutated per scenario.
let nextClaims: GoogleClaims = {};

const fakeGoogle: GoogleOAuth = {
  createAuthorizationRequest: (hdHint) => {
    const state = crypto.randomUUID();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("hd", hdHint);
    return { state, codeVerifier: crypto.randomUUID(), url };
  },
  exchangeCode: async () => nextClaims,
};

const adminUsersRepo = createAdminUsersRepo(db);
const app = createApp({
  adminAuthService: createAdminAuthService({
    adminUsersRepo,
    adminSessionsRepo: createAdminSessionsRepo(db),
    google: fakeGoogle,
    allowedHd: env.GOOGLE_ALLOWED_HD,
    sessionSecret: env.ADMIN_SESSION_SECRET,
    seedOwnerEmail: OWNER_EMAIL,
  }),
  // The flow makes more requests than the strict production limits allow;
  // rate limiting has its own coverage in hardening.test.ts.
  rateLimit: {
    auth: { windowMs: 60_000, limit: 1_000 },
    global: { windowMs: 60_000, limit: 10_000 },
  },
});

afterAll(async () => {
  // Deleting admin users cascades to their sessions.
  await db.delete(adminUsers).where(inArray(adminUsers.email, [OWNER_EMAIL, VIEWER_EMAIL]));
  await pool.end({ timeout: 5 });
});

function cookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1) || undefined;
}

// Drives the browser's part of the OAuth dance: start, then callback with the
// state Google would echo back.
async function login(claims: GoogleClaims) {
  nextClaims = claims;

  const start = await app.request("/api/admin/auth/google");
  expect(start.status).toBe(302);
  const state = cookieValue(start, "admin_oauth_state");
  const verifier = cookieValue(start, "admin_oauth_verifier");
  if (!state || !verifier) throw new Error("start did not set the oauth cookies");

  const callback = await app.request(
    `/api/admin/auth/google/callback?code=fake-code&state=${state}`,
    {
      headers: { cookie: `admin_oauth_state=${state}; admin_oauth_verifier=${verifier}` },
    },
  );
  return callback;
}

function claimsFor(email: string): GoogleClaims {
  return {
    sub: "google-sub",
    email,
    email_verified: true,
    hd: env.GOOGLE_ALLOWED_HD,
    name: "E2E Admin",
  };
}

describe("admin auth e2e", () => {
  test("full flow: login → me → logout → me rejected", async () => {
    const callback = await login(claimsFor(VIEWER_EMAIL));

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(env.ADMIN_URL);
    const sessionToken = cookieValue(callback, "admin_session");
    expect(sessionToken).toBeDefined();

    // The DB row stores only the keyed hash of the cookie value.
    const [storedSession] = await db
      .select()
      .from(adminSessions)
      .where(
        eq(
          adminSessions.tokenHash,
          hashSessionToken(sessionToken as string, env.ADMIN_SESSION_SECRET),
        ),
      );
    expect(storedSession).toBeDefined();

    const me = await app.request("/api/admin/auth/me", {
      headers: { cookie: `admin_session=${sessionToken}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { data: { email: string; role: string } };
    expect(meBody.data.email).toBe(VIEWER_EMAIL);
    expect(meBody.data.role).toBe("viewer");

    const logout = await app.request("/api/admin/auth/logout", {
      method: "POST",
      headers: {
        cookie: `admin_session=${sessionToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    expect(logout.status).toBe(200);

    const meAfter = await app.request("/api/admin/auth/me", {
      headers: { cookie: `admin_session=${sessionToken}` },
    });
    expect(meAfter.status).toBe(401);
  });

  test("seed owner email lands as owner", async () => {
    const callback = await login(claimsFor(OWNER_EMAIL));
    const sessionToken = cookieValue(callback, "admin_session");

    const me = await app.request("/api/admin/auth/me", {
      headers: { cookie: `admin_session=${sessionToken}` },
    });
    const body = (await me.json()) as { data: { role: string } };
    expect(body.data.role).toBe("owner");
  });

  test("wrong hd claim is rejected: no session cookie, no admin user row", async () => {
    const email = `phase9-intruder-${crypto.randomUUID()}@attacker.com`;
    const callback = await login({ ...claimsFor(email), hd: "attacker.com" });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${env.ADMIN_URL}?error=admin_login_failed`);
    expect(cookieValue(callback, "admin_session")).toBeUndefined();
    expect(await adminUsersRepo.findByEmail(email)).toBeUndefined();
  });

  test("a forged session token is rejected", async () => {
    const res = await app.request("/api/admin/auth/me", {
      headers: { cookie: "admin_session=forged-token-value" },
    });
    expect(res.status).toBe(401);
  });
});
