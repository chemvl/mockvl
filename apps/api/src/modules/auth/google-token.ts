// Verifies client-supplied Google ID tokens against Google's JWKS. Unlike the
// admin flow (apps/api/src/admin/auth/google.ts), the token arrives from the
// *client*, not Google's token endpoint, so full signature verification is
// mandatory. Same seam pattern: the auth service (and its tests) depend on the
// GoogleTokenVerifier interface, never on hono/jwt.
import { verifyWithJwks } from "hono/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { z } from "zod";

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
// Google issues both issuer forms (per its OIDC discovery document).
const GOOGLE_ISS = /^(https:\/\/)?accounts\.google\.com$/;
// Fallback when the JWKS response carries no usable Cache-Control max-age;
// deliberately shorter than the ~5h Google typically serves.
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;

// The claim subset the auth service consumes. Only `sub` is structurally
// required here; what missing email/email_verified mean is the service's call.
export const GoogleIdClaimsSchema = z.looseObject({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  // Google Workspace domain; absent for consumer accounts. Only trustworthy
  // because the token signature was verified (APP_GOOGLE_ALLOWED_HD check).
  hd: z.string().optional(),
});

export type GoogleIdClaims = z.infer<typeof GoogleIdClaimsSchema>;

export interface GoogleTokenVerifier {
  // Resolves to validated claims; rejects on any signature/iss/aud/exp/shape
  // failure. Callers map rejections to their own error type.
  verify(idToken: string): Promise<GoogleIdClaims>;
}

export interface FetchedJwks {
  keys: HonoJsonWebKey[];
  ttlMs?: number;
}

export interface GoogleTokenVerifierOptions {
  clientId: string;
  // Test seam; the default fetches Google's JWKS endpoint.
  fetchJwks?: () => Promise<FetchedJwks>;
  // Injectable clock so cache expiry is testable without waiting.
  now?: () => Date;
}

function parseMaxAgeMs(cacheControl: string | null): number | undefined {
  const match = cacheControl?.match(/max-age=(\d+)/i);
  return match?.[1] ? Number(match[1]) * 1000 : undefined;
}

async function fetchGoogleJwks(): Promise<FetchedJwks> {
  const response = await fetch(GOOGLE_JWKS_URI);
  if (!response.ok) {
    throw new Error(`Google JWKS fetch failed with status ${response.status}`);
  }
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) {
    throw new Error("Google JWKS response has no keys array");
  }
  return {
    keys: body.keys as HonoJsonWebKey[],
    ttlMs: parseMaxAgeMs(response.headers.get("cache-control")),
  };
}

// Best-effort kid extraction for the rotation-refetch decision; verification
// itself re-decodes and fully validates the header.
function decodeKid(idToken: string): string | undefined {
  const [headerPart] = idToken.split(".");
  if (!headerPart) return undefined;
  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    return typeof header?.kid === "string" ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

export function createGoogleTokenVerifier(
  options: GoogleTokenVerifierOptions,
): GoogleTokenVerifier {
  const { clientId } = options;
  const fetchJwks = options.fetchJwks ?? fetchGoogleJwks;
  const now = options.now ?? (() => new Date());

  let cache: { keys: HonoJsonWebKey[]; expiresAt: number } | null = null;
  // Concurrent refreshes share one in-flight fetch.
  let inflight: Promise<HonoJsonWebKey[]> | null = null;

  function refreshKeys(): Promise<HonoJsonWebKey[]> {
    inflight ??= fetchJwks()
      .then(({ keys, ttlMs }) => {
        cache = { keys, expiresAt: now().getTime() + (ttlMs ?? DEFAULT_KEYS_TTL_MS) };
        return keys;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function getKeys(): Promise<HonoJsonWebKey[]> {
    if (cache && cache.expiresAt > now().getTime()) return cache.keys;
    return refreshKeys();
  }

  async function verifyAgainst(idToken: string, keys: HonoJsonWebKey[]): Promise<GoogleIdClaims> {
    const payload = await verifyWithJwks(idToken, {
      keys,
      // iat is skipped to tolerate small clock skew on freshly-minted tokens;
      // exp (default-on) still bounds the token's lifetime.
      verification: { iss: GOOGLE_ISS, aud: clientId, iat: false },
      allowedAlgorithms: ["RS256"],
    });
    return GoogleIdClaimsSchema.parse(payload);
  }

  return {
    async verify(idToken: string): Promise<GoogleIdClaims> {
      const keys = await getKeys();
      try {
        return await verifyAgainst(idToken, keys);
      } catch (error) {
        // Only a kid absent from the cached set suggests a Google key rotation
        // worth one forced refetch; every other failure is the token's fault.
        const kid = decodeKid(idToken);
        if (!kid || keys.some((key) => key.kid === kid)) throw error;
        return verifyAgainst(idToken, await refreshKeys());
      }
    },
  };
}
