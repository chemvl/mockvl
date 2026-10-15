import "../setup";
import { describe, expect, test } from "bun:test";
import { verify } from "hono/jwt";
import type { User } from "@/db/schema";
import type { Enqueue, JobName } from "@/jobs/types";
import { AppError, DomainNotAllowedError, UnauthorizedError } from "@/lib/errors";
import { createAuthService } from "@/modules/auth/auth.service";
import type { GoogleCodeExchanger } from "@/modules/auth/google-code";
import type { GoogleIdClaims, GoogleTokenVerifier } from "@/modules/auth/google-token";
import type { NewRefreshTokenInput } from "@/modules/auth/refresh-token.repo";
import type { NewUserInput } from "@/modules/users/users.repo";

const JWT_SECRET = "unit-test-jwt-secret-32-chars-long!!";
const ACCESS_TTL = 900;
const REFRESH_TTL = 3_600;

interface FakeToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
// In-memory fakes implementing the repo surfaces the service depends on.
function createFakes() {
  const userRows: User[] = [];
  const tokenRows: FakeToken[] = [];

  const userRepo = {
    async findByEmail(email: string) {
      return userRows.find((u) => u.email.toLowerCase() === email.toLowerCase());
    },
    async findById(id: string) {
      return userRows.find((u) => u.id === id);
    },
    async findByGoogleSub(googleSub: string) {
      return userRows.find((u) => u.googleSub === googleSub);
    },
    async setGoogleSub(id: string, googleSub: string) {
      if (userRows.some((u) => u.id !== id && u.googleSub === googleSub)) {
        throw new Error("duplicate key", { cause: { code: "23505" } });
      }
      const user = userRows.find((u) => u.id === id);
      if (user) user.googleSub = googleSub;
      return user;
    },
    async setEmailVerifiedAt(id: string, when: Date) {
      const user = userRows.find((u) => u.id === id);
      if (user && user.emailVerifiedAt === null) user.emailVerifiedAt = when;
    },
    async updateProfile(id: string, profile: { name: string | null; avatarUrl: string | null }) {
      const user = userRows.find((u) => u.id === id);
      if (user) Object.assign(user, profile);
    },
    async setLastWorkspace(id: string, workspaceId: string) {
      const user = userRows.find((u) => u.id === id);
      if (user) user.lastWorkspaceId = workspaceId;
    },
    async listExistingIds(ids: string[]) {
      return userRows.filter((u) => ids.includes(u.id)).map((u) => u.id);
    },
    async insert(input: NewUserInput) {
      if (userRows.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
        throw new Error("duplicate key", { cause: { code: "23505" } });
      }
      if (input.googleSub && userRows.some((u) => u.googleSub === input.googleSub)) {
        throw new Error("duplicate key", { cause: { code: "23505" } });
      }
      const user: User = {
        id: crypto.randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        googleSub: input.googleSub ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        lastWorkspaceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      userRows.push(user);
      return user;
    },
  };
  const refreshTokenRepo = {
    async insert(input: NewRefreshTokenInput) {
      const token: FakeToken = { id: crypto.randomUUID(), revokedAt: null, ...input };
      tokenRows.push(token);
      return token;
    },
    async findByTokenHash(tokenHash: string) {
      return tokenRows.find((t) => t.tokenHash === tokenHash);
    },
    async revoke(id: string) {
      const token = tokenRows.find((t) => t.id === id);
      if (!token || token.revokedAt) return false;
      token.revokedAt = new Date();
      return true;
    },
    async revokeFamily(familyId: string) {
      for (const token of tokenRows) {
        if (token.familyId === familyId && !token.revokedAt) token.revokedAt = new Date();
      }
    },
  };

  const enqueuedJobs: { name: JobName; data: unknown }[] = [];
  const enqueue: Enqueue = async (name, data) => {
    enqueuedJobs.push({ name, data });
    return "job-1";
  };

  return {
    userRepo,
    refreshTokenRepo,
    userRows,
    tokenRows,
    enqueue,
    enqueuedJobs,
  };
}

// Fake verifier: resolves with the given claims, or rejects when given an Error —
// same seam-injection pattern as createFakeGoogle in admin-auth-service.test.ts.
function createFakeVerifier(result: GoogleIdClaims | Error): GoogleTokenVerifier {
  return {
    async verify() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function createService(
  overrides: {
    now?: () => Date;
    enqueue?: Enqueue;
    googleTokenVerifier?: GoogleTokenVerifier;
    googleCodeExchanger?: GoogleCodeExchanger;
    allowedHd?: string;
    afterGoogleSignIn?: (input: { userId: string; hd: string | undefined }) => Promise<void>;
  } = {},
) {
  const fakes = createFakes();
  const service = createAuthService({
    userRepo: fakes.userRepo,
    refreshTokenRepo: fakes.refreshTokenRepo,
    enqueue: fakes.enqueue,
    jwtSecret: JWT_SECRET,
    accessTtlSeconds: ACCESS_TTL,
    refreshTtlSeconds: REFRESH_TTL,
    googleTokenVerifier: createFakeVerifier(new Error("verifier not stubbed for this test")),
    ...overrides,
  });
  return { service, ...fakes };
}

const CREDS = { email: "user@example.com" };

const GOOGLE_CLAIMS: GoogleIdClaims = {
  sub: "google-sub-123",
  email: CREDS.email,
  email_verified: true,
};

describe("loginWithGoogle", () => {
  test("creates a password-less user and returns a session on first sign-in", async () => {
    const { service, userRows, enqueuedJobs } = createService({
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    });

    const result = await service.loginWithGoogle("a-google-id-token");

    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.passwordHash).toBeNull();
    expect(userRows[0]?.googleSub).toBe(GOOGLE_CLAIMS.sub);
    // Verified from birth: Google asserts email_verified, so Google accounts
    // must never be gated or purged (Phase 11c).
    expect(userRows[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.user.email).toBe(CREDS.email);
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const payload = await verify(result.accessToken, JWT_SECRET, "HS256");
    expect(payload.sub).toBe(result.user.id);
    expect(payload.type).toBe("access");

    // First-ever account creation gets the welcome email, like register.
    expect(enqueuedJobs).toEqual([
      { name: "welcome-email", data: { userId: result.user.id, email: CREDS.email } },
    ]);
  });

  test("a returning Google user logs into the same account with no new row or email", async () => {
    const { service, userRows, enqueuedJobs } = createService({
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    });

    const first = await service.loginWithGoogle("token-1");
    const second = await service.loginWithGoogle("token-2");

    expect(second.user.id).toBe(first.user.id);
    expect(userRows).toHaveLength(1);
    expect(enqueuedJobs).toHaveLength(1);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  test("auto-links a verified Google email to an existing password account (case-insensitive)", async () => {
    const { service, userRepo, userRows, enqueuedJobs } = createService({
      googleTokenVerifier: createFakeVerifier({
        ...GOOGLE_CLAIMS,
        email: CREDS.email.toUpperCase(),
      }),
    });
    const existing = await userRepo.insert({ email: CREDS.email, passwordHash: "hash" });

    const result = await service.loginWithGoogle("a-google-id-token");

    expect(result.user.id).toBe(existing.id);
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.googleSub).toBe(GOOGLE_CLAIMS.sub);
    // The password stays: the account now supports both login methods.
    expect(userRows[0]?.passwordHash).not.toBeNull();
    // Google asserted email_verified for this address, so the linked account
    // is marked verified.
    expect(userRows[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    // Linking is not a new account: no welcome email.
    expect(enqueuedJobs).toHaveLength(0);
  });

  test("rejects an unverified Google email without creating an account", async () => {
    const { service, userRows } = createService({
      googleTokenVerifier: createFakeVerifier({ ...GOOGLE_CLAIMS, email_verified: false }),
    });

    const error = await service.loginWithGoogle("a-google-id-token").catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(userRows).toHaveLength(0);
  });

  test("rejects claims without an email without creating an account", async () => {
    const { service, userRows } = createService({
      googleTokenVerifier: createFakeVerifier({ sub: GOOGLE_CLAIMS.sub, email_verified: true }),
    });

    const error = await service.loginWithGoogle("a-google-id-token").catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(userRows).toHaveLength(0);
  });

  test("maps any verifier failure to a generic 401", async () => {
    const { service } = createService({
      googleTokenVerifier: createFakeVerifier(new Error("signature mismatch")),
    });

    const error = await service.loginWithGoogle("tampered-token").catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect((error as Error).message).toBe("Invalid Google token");
  });

  test("a lost insert race resolves to the winning account instead of failing", async () => {
    const fakes = createFakes();
    // Simulate a concurrent first-login: the sub lookup misses, the insert hits
    // the unique index, and the re-resolve finds the winner.
    const winner = await fakes.userRepo.insert({
      email: CREDS.email,
      passwordHash: null,
      googleSub: GOOGLE_CLAIMS.sub,
    });
    let subLookups = 0;
    const racingUserRepo = {
      ...fakes.userRepo,
      async findByGoogleSub(googleSub: string) {
        subLookups += 1;
        if (subLookups === 1) return undefined; // the winner hasn't committed yet
        return fakes.userRepo.findByGoogleSub(googleSub);
      },
      async findByEmail() {
        return undefined; // ditto
      },
    };
    const service = createAuthService({
      userRepo: racingUserRepo,
      refreshTokenRepo: fakes.refreshTokenRepo,
      enqueue: fakes.enqueue,
      jwtSecret: JWT_SECRET,
      accessTtlSeconds: ACCESS_TTL,
      refreshTtlSeconds: REFRESH_TTL,
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    });

    const result = await service.loginWithGoogle("a-google-id-token");
    expect(result.user.id).toBe(winner.id);
    // The loser must not send a duplicate welcome email.
    expect(fakes.enqueuedJobs).toHaveLength(0);
  });

  test("a lost link race logs in as the account that won the sub", async () => {
    const { service, userRepo, userRows } = createService({
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    });
    // Another account already holds the sub (it wins the race)…
    const winner = await userRepo.insert({
      email: "winner@example.com",
      passwordHash: null,
      googleSub: GOOGLE_CLAIMS.sub,
    });
    // …and a password account matches the claim's email, so the service will
    // try to link it once the initial sub lookup misses.
    await userRepo.insert({ email: CREDS.email, passwordHash: "hash", googleSub: null });
    let subLookups = 0;
    const originalFindByGoogleSub = userRepo.findByGoogleSub.bind(userRepo);
    userRepo.findByGoogleSub = async (googleSub: string) => {
      subLookups += 1;
      if (subLookups === 1) return undefined;
      return originalFindByGoogleSub(googleSub);
    };

    const result = await service.loginWithGoogle("a-google-id-token");
    expect(result.user.id).toBe(winner.id);
    expect(userRows.find((u) => u.email === CREDS.email)?.googleSub).toBeNull();
  });

  test("syncs the Google profile and runs the sign-in hook; a failing hook doesn't block", async () => {
    const hookCalls: { userId: string; hd: string | undefined }[] = [];
    const { service, userRows } = createService({
      googleTokenVerifier: createFakeVerifier({
        ...GOOGLE_CLAIMS,
        name: "Jane Doe",
        picture: "https://example.com/a.png",
        hd: "example.com",
      }),
      afterGoogleSignIn: async (input) => {
        hookCalls.push(input);
        throw new Error("hook down");
      },
    });
    await service.loginWithGoogle("token-1");
    // A profile change on Google's side since the last sign-in.
    for (const row of userRows) row.name = "Old Name";

    const result = await service.loginWithGoogle("token-2");

    expect(result.user).toMatchObject({ name: "Jane Doe", avatarUrl: "https://example.com/a.png" });
    expect(userRows[0]?.name).toBe("Jane Doe");
    expect(hookCalls).toEqual([
      { userId: result.user.id, hd: "example.com" },
      { userId: result.user.id, hd: "example.com" },
    ]);
  });
});

describe("refresh", () => {
  test("rotates the token within the same family", async () => {
    const { service, tokenRows } = createService({
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    });
    const { refreshToken } = await service.loginWithGoogle("a-google-id-token");

    const rotated = await service.refresh(refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    expect(tokenRows).toHaveLength(2);
    const [original, successor] = tokenRows;
    expect(successor?.familyId).toBe(original?.familyId as string);
    expect(original?.revokedAt).toBeInstanceOf(Date);
    expect(successor?.revokedAt).toBeNull();
  });

  test("an unknown token is rejected", async () => {
    const { service } = createService();
    await expect(service.refresh("definitely-not-a-token")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  test("reusing a rotated token kills the whole family", async () => {
    const { service } = createService({ googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS) });
    const { refreshToken } = await service.loginWithGoogle("a-google-id-token");
    const rotated = await service.refresh(refreshToken);

    // Replay the pre-rotation token → reuse detected.
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    // The legitimate successor is collateral damage: whole family revoked.
    await expect(service.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("an expired token is rejected", async () => {
    const fakes = createFakes();
    const baseDeps = {
      userRepo: fakes.userRepo,
      refreshTokenRepo: fakes.refreshTokenRepo,
      enqueue: fakes.enqueue,
      jwtSecret: JWT_SECRET,
      accessTtlSeconds: ACCESS_TTL,
      refreshTtlSeconds: REFRESH_TTL,
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
    };
    const service = createAuthService(baseDeps);
    const { refreshToken } = await service.loginWithGoogle("a-google-id-token");

    // Same stored tokens, clock advanced past the refresh TTL.
    const later = createAuthService({
      ...baseDeps,
      now: () => new Date(Date.now() + (REFRESH_TTL + 60) * 1000),
    });
    await expect(later.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("logout revokes the family and is idempotent", async () => {
    const { service } = createService({ googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS) });
    const { refreshToken } = await service.loginWithGoogle("a-google-id-token");

    await service.logout(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);

    // Unknown/already-revoked tokens still resolve — logout leaks nothing.
    await expect(service.logout(refreshToken)).resolves.toBeUndefined();
    await expect(service.logout("never-existed")).resolves.toBeUndefined();
  });
});

describe("Google domain restriction (APP_GOOGLE_ALLOWED_HD)", () => {
  test("rejects a token whose hd claim is missing or different", async () => {
    const { service, userRows } = createService({
      googleTokenVerifier: createFakeVerifier(GOOGLE_CLAIMS),
      allowedHd: "company.com",
    });
    const error = await service.loginWithGoogle("t").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainNotAllowedError);
    expect((error as AppError).code).toBe("DOMAIN_NOT_ALLOWED");
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).message).toBe("Use your company.com Google account.");
    expect(userRows).toHaveLength(0);
  });

  test("also gates a returning user matched by sub", async () => {
    const { service, userRepo } = createService({
      googleTokenVerifier: createFakeVerifier({ ...GOOGLE_CLAIMS, hd: "other.com" }),
      allowedHd: "company.com",
    });
    await userRepo.insert({ email: CREDS.email, passwordHash: null, googleSub: GOOGLE_CLAIMS.sub });
    const error = await service.loginWithGoogle("t").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainNotAllowedError);
  });

  test("admits a matching hd claim", async () => {
    const { service } = createService({
      googleTokenVerifier: createFakeVerifier({ ...GOOGLE_CLAIMS, hd: "company.com" }),
      allowedHd: "company.com",
    });
    const result = await service.loginWithGoogle("t");
    expect(result.user.email).toBe(CREDS.email);
  });
});

describe("loginWithGoogleCode", () => {
  test("exchanges the code and signs in with the resulting ID token", async () => {
    const exchanged: string[] = [];
    const verified: string[] = [];
    const { service } = createService({
      googleCodeExchanger: {
        async exchange(code) {
          exchanged.push(code);
          return "id-token-from-google";
        },
      },
      googleTokenVerifier: {
        async verify(idToken) {
          verified.push(idToken);
          return GOOGLE_CLAIMS;
        },
      },
    });
    const result = await service.loginWithGoogleCode("4/popup-code");
    expect(exchanged).toEqual(["4/popup-code"]);
    expect(verified).toEqual(["id-token-from-google"]);
    expect(result.user.email).toBe(CREDS.email);
  });

  test("maps any exchange failure to 401 GOOGLE_CODE_INVALID", async () => {
    const { service } = createService({
      googleCodeExchanger: {
        async exchange() {
          throw new Error("invalid_grant");
        },
      },
    });
    const error = await service.loginWithGoogleCode("bad").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("GOOGLE_CODE_INVALID");
    expect((error as AppError).status).toBe(401);
  });
});
