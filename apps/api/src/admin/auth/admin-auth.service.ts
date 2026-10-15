import type { AdminUser } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AdminSessionsRepo } from "./admin-sessions.repo";
import { generateSessionToken, hashSessionToken } from "./admin-tokens";
import type { AdminUsersRepo } from "./admin-users.repo";
import type { GoogleAuthRequest, GoogleClaims, GoogleOAuth } from "./google";

export const ADMIN_SESSION_TTL_S = 7 * 24 * 3600; // 7 days, sliding

export interface AdminAuthServiceDeps {
  adminUsersRepo: AdminUsersRepo;
  adminSessionsRepo: AdminSessionsRepo;
  google: GoogleOAuth;
  allowedHd: string;
  sessionSecret: string;
  sessionTtlSeconds?: number;
  // Login with this email is created as (or promoted to) owner.
  seedOwnerEmail?: string;
  // Injectable clock so expiry is testable without waiting.
  now?: () => Date;
}

export interface AdminLoginResult {
  sessionToken: string;
  expiresAt: Date;
  adminUser: AdminUser;
}

export interface AdminSessionResult {
  adminUser: AdminUser;
  expiresAt: Date;
  // True when the sliding expiry was extended — the caller refreshes the cookie.
  renewed: boolean;
}

// One generic message for every failure mode: callers learn nothing about
// which check failed. The specifics are logged server-side.
const ADMIN_LOGIN_FAILED = "Admin sign-in failed";

export function createAdminAuthService(deps: AdminAuthServiceDeps) {
  const { adminUsersRepo, adminSessionsRepo, google, allowedHd, sessionSecret, seedOwnerEmail } =
    deps;
  const sessionTtlSeconds = deps.sessionTtlSeconds ?? ADMIN_SESSION_TTL_S;
  const now = deps.now ?? (() => new Date());

  function isSeedOwner(email: string): boolean {
    return seedOwnerEmail !== undefined && email.toLowerCase() === seedOwnerEmail.toLowerCase();
  }

  // SECURITY (do not weaken): the hd claim inside the verified ID token must
  // equal GOOGLE_ALLOWED_HD. The `hd` URL parameter on the consent screen is a
  // hint anyone can edit; this claim is asserted by Google for the signed-in
  // account and is the actual org-membership check.
  function validateClaims(claims: GoogleClaims): {
    email: string;
    name: string;
    picture: string | null;
  } {
    if (claims.hd !== allowedHd || !claims.email || claims.email_verified !== true) {
      logger.warn(
        { hd: claims.hd, emailVerified: claims.email_verified, hasEmail: Boolean(claims.email) },
        "admin login rejected: ID token claims failed validation",
      );
      throw new UnauthorizedError(ADMIN_LOGIN_FAILED);
    }
    return {
      email: claims.email,
      name: claims.name ?? claims.email,
      picture: claims.picture ?? null,
    };
  }

  async function upsertAdminUser(profile: {
    email: string;
    name: string;
    picture: string | null;
  }): Promise<AdminUser> {
    const existing = await adminUsersRepo.findByEmail(profile.email);
    if (existing) {
      const updated =
        (await adminUsersRepo.updateProfile(existing.id, {
          name: profile.name,
          avatarUrl: profile.picture,
        })) ?? existing;
      if (isSeedOwner(updated.email) && updated.role !== "owner") {
        return (await adminUsersRepo.updateRole(updated.id, "owner")) ?? updated;
      }
      return updated;
    }

    try {
      return await adminUsersRepo.insert({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        ...(isSeedOwner(profile.email) && { role: "owner" as const }),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a first-login race: the row exists now, use it.
      const raced = await adminUsersRepo.findByEmail(profile.email);
      if (!raced) throw error;
      return raced;
    }
  }

  async function createSession(adminUser: AdminUser): Promise<AdminLoginResult> {
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(now().getTime() + sessionTtlSeconds * 1000);
    await adminSessionsRepo.insert({
      adminUserId: adminUser.id,
      tokenHash: hashSessionToken(sessionToken, sessionSecret),
      expiresAt,
    });
    return { sessionToken, expiresAt, adminUser };
  }

  return {
    startGoogleLogin(): GoogleAuthRequest {
      return google.createAuthorizationRequest(allowedHd);
    },

    async handleGoogleCallback(code: string, codeVerifier: string): Promise<AdminLoginResult> {
      let claims: GoogleClaims;
      try {
        claims = await google.exchangeCode(code, codeVerifier);
      } catch (err) {
        // Bad/expired/replayed codes are a caller problem, not a 500.
        logger.warn({ err }, "admin login rejected: code exchange failed");
        throw new UnauthorizedError(ADMIN_LOGIN_FAILED);
      }
      const profile = validateClaims(claims);
      const adminUser = await upsertAdminUser(profile);
      return createSession(adminUser);
    },

    async validateSession(sessionToken: string): Promise<AdminSessionResult | null> {
      const found = await adminSessionsRepo.findWithUserByTokenHash(
        hashSessionToken(sessionToken, sessionSecret),
      );
      if (!found) return null;

      const nowMs = now().getTime();
      if (found.session.expiresAt.getTime() <= nowMs) {
        // Expired rows are dead weight — clean up on the way out.
        await adminSessionsRepo.deleteByTokenHash(found.session.tokenHash);
        return null;
      }

      // Sliding expiry: renew once less than half the lifetime remains, so
      // active admins stay signed in without a DB write on every request.
      const remainingMs = found.session.expiresAt.getTime() - nowMs;
      if (remainingMs < (sessionTtlSeconds * 1000) / 2) {
        const expiresAt = new Date(nowMs + sessionTtlSeconds * 1000);
        try {
          await adminSessionsRepo.updateExpiry(found.session.id, expiresAt);
        } catch (err) {
          // The session we already loaded is valid — a failed slide must not
          // turn this request into a 500. Skip the renewal; a later request
          // (or the still-unexpired session) retries it.
          logger.warn(
            { err, code: "SESSION_RENEWAL_FAILED", adminUserId: found.adminUser.id },
            "admin session renewal failed; serving request without sliding",
          );
          return { adminUser: found.adminUser, expiresAt: found.session.expiresAt, renewed: false };
        }
        return { adminUser: found.adminUser, expiresAt, renewed: true };
      }

      return { adminUser: found.adminUser, expiresAt: found.session.expiresAt, renewed: false };
    },

    // Idempotent and silent on unknown tokens: nothing to learn here.
    async logout(sessionToken: string): Promise<void> {
      await adminSessionsRepo.deleteByTokenHash(hashSessionToken(sessionToken, sessionSecret));
    },
  };
}

export type AdminAuthService = ReturnType<typeof createAdminAuthService>;
