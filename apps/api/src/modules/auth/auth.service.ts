import type { User } from "@/db/schema";
import type { Enqueue } from "@/jobs/types";
import { isUniqueViolation } from "@/lib/db-errors";
import { AppError, DomainNotAllowedError, UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { UserRepo } from "@/modules/users/users.repo";
import { generateOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth.tokens";
import type { GoogleCodeExchanger } from "./google-code";
import type { GoogleIdClaims, GoogleTokenVerifier } from "./google-token";
import type { RefreshTokenRepo } from "./refresh-token.repo";

export interface AuthServiceDeps {
  userRepo: UserRepo;
  refreshTokenRepo: RefreshTokenRepo;
  enqueue: Enqueue;
  googleTokenVerifier: GoogleTokenVerifier;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  // Popup-code sign-in (POST /auth/google/code). Optional so suites that never
  // call loginWithGoogleCode can omit it; production wiring (app.defaults.ts)
  // always passes it. Calling loginWithGoogleCode without it is a wiring bug
  // and fails loudly (500), never silently.
  googleCodeExchanger?: GoogleCodeExchanger;
  // APP_GOOGLE_ALLOWED_HD: when set, every Google sign-in must carry this
  // verified `hd` claim — returning users included.
  allowedHd?: string;
  // Runs after every Google sign-in, before the session is issued: personal
  // workspace provisioning and domain join (app.defaults.ts). Failures are
  // logged, never surfaced.
  afterGoogleSignIn?: (input: { userId: string; hd: string | undefined }) => Promise<void>;
  // Injectable clock so expiry is testable without waiting.
  now?: () => Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: AuthUser;
}

const BAD_REFRESH = "Invalid or expired refresh token";
// One generic message for every verifier failure (signature, iss, aud, exp,
// malformed): the endpoint must not become a token-probing oracle.
const BAD_GOOGLE_TOKEN = "Invalid Google token";
const BAD_GOOGLE_CODE = "Google sign-in failed. Try again.";

function toAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

export function createAuthService(deps: AuthServiceDeps) {
  const {
    userRepo,
    refreshTokenRepo,
    enqueue,
    googleTokenVerifier,
    jwtSecret,
    accessTtlSeconds,
    refreshTtlSeconds,
    googleCodeExchanger,
    allowedHd,
    afterGoogleSignIn,
  } = deps;
  const now = deps.now ?? (() => new Date());

  // Best-effort: the account exists either way, and failing the sign-in over
  // a mail enqueue would punish the user for an infrastructure hiccup.
  async function enqueueWelcomeEmail(user: AuthUser): Promise<void> {
    try {
      await enqueue("welcome-email", { userId: user.id, email: user.email });
    } catch (err) {
      logger.error({ err, userId: user.id }, "failed to enqueue welcome-email job");
    }
  }

  // A fresh session: new refresh-token family plus the public user shape.
  async function startSession(user: AuthUser): Promise<AuthResult> {
    const tokens = await issueTokens(user.id, crypto.randomUUID());
    return { user: toAuthUser(user), ...tokens };
  }

  // One refresh-token family per login; rotations inherit the family.
  async function issueTokens(userId: string, familyId: string): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    await refreshTokenRepo.insert({
      userId,
      familyId,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(now().getTime() + refreshTtlSeconds * 1000),
    });
    const accessToken = await signAccessToken({
      sub: userId,
      secret: jwtSecret,
      ttlSeconds: accessTtlSeconds,
      now: now(),
    });
    return { accessToken, refreshToken };
  }

  async function loginWithGoogle(idToken: string): Promise<AuthResult> {
    let claims: GoogleIdClaims;
    try {
      claims = await googleTokenVerifier.verify(idToken);
    } catch (err) {
      logger.info({ err }, "google id token rejected");
      throw new UnauthorizedError(BAD_GOOGLE_TOKEN);
    }

    // Before any account lookup: an off-domain identity must not sign in even
    // if it was linked while the restriction was off.
    if (allowedHd !== undefined && claims.hd !== allowedHd) {
      throw new DomainNotAllowedError(allowedHd);
    }

    const resolved = await resolveGoogleUser(claims);
    // Every sign-in refreshes the Google profile (no-op when unchanged).
    const profile = { name: claims.name ?? null, avatarUrl: claims.picture ?? null };
    await userRepo.updateProfile(resolved.user.id, profile);
    const user = { ...resolved.user, ...profile };
    // Best-effort (personal workspace, domain join): a failure here must not
    // block sign-in; GET /workspaces provisions the personal workspace anyway.
    try {
      await afterGoogleSignIn?.({ userId: user.id, hd: claims.hd });
    } catch (err) {
      logger.error({ err, userId: user.id }, "after google sign-in hook failed");
    }
    const result = await startSession(user);
    // A genuinely new account gets the welcome email.
    if (resolved.created) await enqueueWelcomeEmail(result.user);
    return result;
  }

  // Finds, links or creates the account for verified claims. `created` is
  // true only when this request inserted the row; every lost race resolves to
  // the account that won it.
  async function resolveGoogleUser(
    claims: GoogleIdClaims,
  ): Promise<{ user: User; created: boolean }> {
    // Returning Google user: the sub is the stable identity key. The email
    // on file is deliberately not synced — keep this path simple.
    const bySub = await userRepo.findByGoogleSub(claims.sub);
    if (bySub) return { user: bySub, created: false };

    // Both remaining paths trust the email, so Google must have verified it.
    if (!claims.email || claims.email_verified !== true) {
      throw new UnauthorizedError("Google account email is not verified");
    }

    // Auto-link: a verified email matching an existing account gives that
    // account Google login.
    const byEmail = await userRepo.findByEmail(claims.email);
    if (byEmail) {
      // Google just asserted email_verified for this exact address, so an
      // unverified legacy account becomes verified by linking.
      if (byEmail.emailVerifiedAt === null) {
        await userRepo.setEmailVerifiedAt(byEmail.id, now());
      }
      try {
        const linked = await userRepo.setGoogleSub(byEmail.id, claims.sub);
        return { user: linked ?? byEmail, created: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Lost the race to claim this sub — log in as whoever won it.
        const winner = await userRepo.findByGoogleSub(claims.sub);
        if (!winner) throw error;
        return { user: winner, created: false };
      }
    }

    // First sign-in: create a password-less account.
    try {
      const user = await userRepo.insert({
        email: claims.email,
        passwordHash: null,
        googleSub: claims.sub,
        // Verified from birth: Google asserted email_verified above.
        emailVerifiedAt: now(),
        name: claims.name ?? null,
        avatarUrl: claims.picture ?? null,
      });
      return { user, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent request created the account (same sub or email) first.
      const winner =
        (await userRepo.findByGoogleSub(claims.sub)) ?? (await userRepo.findByEmail(claims.email));
      if (!winner) throw error;
      return { user: winner, created: false };
    }
  }

  return {
    loginWithGoogle,

    async loginWithGoogleCode(code: string): Promise<AuthResult> {
      if (!googleCodeExchanger) {
        throw new Error("googleCodeExchanger is not wired (app.defaults.ts)");
      }
      let idToken: string;
      try {
        idToken = await googleCodeExchanger.exchange(code);
      } catch (err) {
        logger.info({ err }, "google code exchange failed");
        throw new AppError("GOOGLE_CODE_INVALID", 401, BAD_GOOGLE_CODE);
      }
      return loginWithGoogle(idToken);
    },

    async refresh(refreshToken: string): Promise<TokenPair> {
      const stored = await refreshTokenRepo.findByTokenHash(hashOpaqueToken(refreshToken));
      if (!stored) {
        throw new UnauthorizedError(BAD_REFRESH);
      }
      if (stored.revokedAt !== null) {
        // Reuse of a rotated/revoked token: assume the family is compromised.
        await refreshTokenRepo.revokeFamily(stored.familyId);
        throw new UnauthorizedError(BAD_REFRESH);
      }
      if (stored.expiresAt.getTime() <= now().getTime()) {
        throw new UnauthorizedError(BAD_REFRESH);
      }
      const rotated = await refreshTokenRepo.revoke(stored.id);
      if (!rotated) {
        // Lost a race with another rotation of the same token — treat as reuse.
        await refreshTokenRepo.revokeFamily(stored.familyId);
        throw new UnauthorizedError(BAD_REFRESH);
      }
      return issueTokens(stored.userId, stored.familyId);
    },

    async logout(refreshToken: string): Promise<void> {
      const stored = await refreshTokenRepo.findByTokenHash(hashOpaqueToken(refreshToken));
      // Idempotent and silent on unknown/revoked tokens: nothing to learn here.
      if (stored) {
        await refreshTokenRepo.revokeFamily(stored.familyId);
      }
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
