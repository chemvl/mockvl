import "../setup";
import { describe, expect, mock, test } from "bun:test";
import { createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { hashSessionToken } from "@/admin/auth/admin-tokens";
import type { GoogleClaims, GoogleOAuth } from "@/admin/auth/google";
import type { AdminSession, AdminUser } from "@/db/schema";
import { UnauthorizedError } from "@/lib/errors";

const SECRET = "an-admin-secret-that-is-32-chars-long";
const ALLOWED_HD = "company.com";
const TTL_S = 7 * 24 * 3600;

const BASE_CLAIMS: GoogleClaims = {
  sub: "google-sub-1",
  email: "ada@company.com",
  email_verified: true,
  hd: ALLOWED_HD,
  name: "Ada Lovelace",
  picture: "https://example.com/ada.png",
};

function createFakeRepos() {
  const admins = new Map<string, AdminUser>();
  const sessions = new Map<string, AdminSession>();

  const adminUsersRepo = {
    findByEmail: mock(async (email: string) => {
      return [...admins.values()].find((a) => a.email.toLowerCase() === email.toLowerCase());
    }),
    insert: mock(
      async (input: {
        email: string;
        name: string;
        avatarUrl: string | null;
        role?: AdminUser["role"];
      }) => {
        const existing = [...admins.values()].find(
          (a) => a.email.toLowerCase() === input.email.toLowerCase(),
        );
        if (existing) {
          throw new Error("duplicate key", { cause: { code: "23505" } });
        }
        const admin: AdminUser = {
          id: crypto.randomUUID(),
          email: input.email,
          name: input.name,
          avatarUrl: input.avatarUrl,
          role: input.role ?? "viewer",
          createdAt: new Date(),
        };
        admins.set(admin.id, admin);
        return admin;
      },
    ),
    updateProfile: mock(async (id: string, input: { name: string; avatarUrl: string | null }) => {
      const admin = admins.get(id);
      if (!admin) return undefined;
      const updated = { ...admin, ...input };
      admins.set(id, updated);
      return updated;
    }),
    updateRole: mock(async (id: string, role: AdminUser["role"]) => {
      const admin = admins.get(id);
      if (!admin) return undefined;
      const updated = { ...admin, role };
      admins.set(id, updated);
      return updated;
    }),
    countOwners: mock(async (excludingId: string) => {
      let owners = 0;
      for (const admin of admins.values()) {
        if (admin.role === "owner" && admin.id !== excludingId) owners += 1;
      }
      return owners;
    }),
  };

  const adminSessionsRepo = {
    insert: mock(async (input: { adminUserId: string; tokenHash: string; expiresAt: Date }) => {
      const session: AdminSession = { id: crypto.randomUUID(), createdAt: new Date(), ...input };
      sessions.set(session.tokenHash, session);
      return session;
    }),
    findWithUserByTokenHash: mock(async (tokenHash: string) => {
      const session = sessions.get(tokenHash);
      if (!session) return undefined;
      const adminUser = admins.get(session.adminUserId);
      if (!adminUser) return undefined;
      return { session, adminUser };
    }),
    updateExpiry: mock(async (id: string, expiresAt: Date) => {
      for (const [hash, session] of sessions) {
        if (session.id === id) sessions.set(hash, { ...session, expiresAt });
      }
    }),
    deleteByTokenHash: mock(async (tokenHash: string) => {
      sessions.delete(tokenHash);
    }),
  };

  return { admins, sessions, adminUsersRepo, adminSessionsRepo };
}

function createFakeGoogle(claims: GoogleClaims | Error = BASE_CLAIMS): GoogleOAuth {
  return {
    createAuthorizationRequest: mock((hdHint: string) => ({
      state: "state-123",
      codeVerifier: "verifier-123",
      url: new URL(`https://accounts.google.com/o/oauth2/v2/auth?hd=${hdHint}`),
    })),
    exchangeCode: mock(async () => {
      if (claims instanceof Error) throw claims;
      return claims;
    }),
  };
}

function createService(overrides: Parameters<typeof partialService>[0] = {}) {
  return partialService(overrides);
}

function partialService(
  overrides: Partial<{
    repos: ReturnType<typeof createFakeRepos>;
    google: GoogleOAuth;
    seedOwnerEmail: string | undefined;
    now: () => Date;
  }>,
) {
  const repos = overrides.repos ?? createFakeRepos();
  const google = overrides.google ?? createFakeGoogle();
  const service = createAdminAuthService({
    adminUsersRepo: repos.adminUsersRepo,
    adminSessionsRepo: repos.adminSessionsRepo,
    google,
    allowedHd: ALLOWED_HD,
    sessionSecret: SECRET,
    sessionTtlSeconds: TTL_S,
    seedOwnerEmail: overrides.seedOwnerEmail,
    now: overrides.now,
  });
  return { service, repos, google };
}

describe("handleGoogleCallback", () => {
  test("creates a viewer admin user and a hashed session on first login", async () => {
    const now = new Date("2026-07-06T00:00:00Z");
    const { service, repos } = createService({ now: () => now });

    const result = await service.handleGoogleCallback("code", "verifier");

    expect(result.adminUser.email).toBe("ada@company.com");
    expect(result.adminUser.role).toBe("viewer");
    expect(result.expiresAt.getTime()).toBe(now.getTime() + TTL_S * 1000);
    // The raw token is never stored — only its keyed hash.
    const stored = repos.sessions.get(hashSessionToken(result.sessionToken, SECRET));
    expect(stored).toBeDefined();
    expect([...repos.sessions.keys()]).not.toContain(result.sessionToken);
  });

  test("rejects when the verified token has no hd claim", async () => {
    const { service, repos } = createService({
      google: createFakeGoogle({ ...BASE_CLAIMS, hd: undefined }),
    });

    await expect(service.handleGoogleCallback("code", "verifier")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(repos.admins.size).toBe(0);
    expect(repos.sessions.size).toBe(0);
  });

  test("rejects when the hd claim is a different domain", async () => {
    const { service, repos } = createService({
      google: createFakeGoogle({ ...BASE_CLAIMS, hd: "attacker.com" }),
    });

    await expect(service.handleGoogleCallback("code", "verifier")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(repos.sessions.size).toBe(0);
  });

  test("rejects an unverified email", async () => {
    const { service } = createService({
      google: createFakeGoogle({ ...BASE_CLAIMS, email_verified: false }),
    });

    await expect(service.handleGoogleCallback("code", "verifier")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  test("maps a failed code exchange to UnauthorizedError", async () => {
    const { service } = createService({ google: createFakeGoogle(new Error("exchange blew up")) });

    await expect(service.handleGoogleCallback("bad-code", "verifier")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  test("seeds the configured owner email as owner, case-insensitively", async () => {
    const { service } = createService({ seedOwnerEmail: "ADA@company.com" });

    const result = await service.handleGoogleCallback("code", "verifier");

    expect(result.adminUser.role).toBe("owner");
  });

  test("updates profile fields but preserves the role on repeat logins", async () => {
    const repos = createFakeRepos();
    await repos.adminUsersRepo.insert({
      email: "ada@company.com",
      name: "Old Name",
      avatarUrl: null,
      role: "editor",
    });
    const { service } = createService({ repos });

    const result = await service.handleGoogleCallback("code", "verifier");

    expect(result.adminUser.name).toBe("Ada Lovelace");
    expect(result.adminUser.avatarUrl).toBe("https://example.com/ada.png");
    expect(result.adminUser.role).toBe("editor");
    expect(repos.admins.size).toBe(1);
  });

  test("promotes an existing seed-email user to owner", async () => {
    const repos = createFakeRepos();
    await repos.adminUsersRepo.insert({
      email: "ada@company.com",
      name: "Ada",
      avatarUrl: null,
      role: "viewer",
    });
    const { service } = createService({ repos, seedOwnerEmail: "ada@company.com" });

    const result = await service.handleGoogleCallback("code", "verifier");

    expect(result.adminUser.role).toBe("owner");
  });

  test("recovers when a concurrent first login already inserted the user", async () => {
    const repos = createFakeRepos();
    const realFindByEmail = repos.adminUsersRepo.findByEmail;
    // First lookup misses; the "other request" inserts before ours does.
    let calls = 0;
    repos.adminUsersRepo.findByEmail = mock(async (email: string) => {
      calls += 1;
      if (calls === 1) {
        await repos.adminUsersRepo.insert({
          email: "ada@company.com",
          name: "Raced In",
          avatarUrl: null,
        });
        return undefined;
      }
      return realFindByEmail(email);
    });
    const { service } = createService({ repos });

    const result = await service.handleGoogleCallback("code", "verifier");

    expect(result.adminUser.email).toBe("ada@company.com");
    expect(repos.admins.size).toBe(1);
  });
});

describe("validateSession", () => {
  async function loginSession(overrides: Parameters<typeof partialService>[0] = {}) {
    const ctx = createService(overrides);
    const login = await ctx.service.handleGoogleCallback("code", "verifier");
    return { ...ctx, login };
  }

  test("returns the admin user for a valid session without renewing a fresh one", async () => {
    const now = new Date("2026-07-06T00:00:00Z");
    const { service, login, repos } = await loginSession({ now: () => now });

    const result = await service.validateSession(login.sessionToken);

    expect(result?.adminUser.email).toBe("ada@company.com");
    expect(result?.renewed).toBe(false);
    expect(repos.adminSessionsRepo.updateExpiry).not.toHaveBeenCalled();
  });

  test("returns null for an unknown token", async () => {
    const { service } = createService();
    expect(await service.validateSession("unknown-token")).toBeNull();
  });

  test("returns null for an expired session and deletes it", async () => {
    let current = new Date("2026-07-06T00:00:00Z");
    const { service, login, repos } = await loginSession({ now: () => current });

    current = new Date(current.getTime() + (TTL_S + 1) * 1000);

    expect(await service.validateSession(login.sessionToken)).toBeNull();
    expect(repos.sessions.size).toBe(0);
  });

  test("still accepts the session when the renewal write fails", async () => {
    let current = new Date("2026-07-06T00:00:00Z");
    const { service, login, repos } = await loginSession({ now: () => current });
    const originalExpiry = login.expiresAt;

    current = new Date(current.getTime() + (TTL_S / 2 + 60) * 1000);
    repos.adminSessionsRepo.updateExpiry = mock(async () => {
      throw new Error("db blip");
    });

    // A valid session must not turn into a 500 because the slide failed —
    // skip the renewal for this request instead.
    const result = await service.validateSession(login.sessionToken);

    expect(result?.adminUser.email).toBe("ada@company.com");
    expect(result?.renewed).toBe(false);
    expect(result?.expiresAt.getTime()).toBe(originalExpiry.getTime());
  });

  test("slides the expiry when less than half the lifetime remains", async () => {
    let current = new Date("2026-07-06T00:00:00Z");
    const { service, login, repos } = await loginSession({ now: () => current });

    // Past the halfway point but not expired.
    current = new Date(current.getTime() + (TTL_S / 2 + 60) * 1000);

    const result = await service.validateSession(login.sessionToken);

    expect(result?.renewed).toBe(true);
    expect(result?.expiresAt.getTime()).toBe(current.getTime() + TTL_S * 1000);
    expect(repos.adminSessionsRepo.updateExpiry).toHaveBeenCalledTimes(1);
  });
});

describe("logout", () => {
  test("deletes the session and is idempotent for unknown tokens", async () => {
    const { service, repos } = createService();
    const login = await service.handleGoogleCallback("code", "verifier");

    await service.logout(login.sessionToken);
    await service.logout(login.sessionToken);
    await service.logout("never-existed");

    expect(repos.sessions.size).toBe(0);
  });
});

describe("startGoogleLogin", () => {
  test("returns state, verifier, and the consent URL with the hd hint", async () => {
    const { service } = createService();

    const request = service.startGoogleLogin();

    expect(request.state).toBe("state-123");
    expect(request.codeVerifier).toBe("verifier-123");
    expect(request.url.searchParams.get("hd")).toBe(ALLOWED_HD);
  });
});
