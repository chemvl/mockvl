// Token primitives for app-user auth. hono/jwt stays confined to this file
// (and middleware/auth.ts) so the auth service never imports Hono.
import { sign } from "hono/jwt";

const OPAQUE_TOKEN_BYTES = 32; // 256 bits, returned once and stored only as a hash

// Opaque bearer secret (refresh tokens): random bytes, base64url.
export function generateOpaqueToken(): string {
  const bytes = new Uint8Array(OPAQUE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export interface SignAccessTokenOptions {
  sub: string;
  secret: string;
  ttlSeconds: number;
  now?: Date;
}

export function signAccessToken(options: SignAccessTokenOptions): Promise<string> {
  const { sub, secret, ttlSeconds, now = new Date() } = options;
  const issuedAt = Math.floor(now.getTime() / 1000);
  return sign({ sub, type: "access", iat: issuedAt, exp: issuedAt + ttlSeconds }, secret, "HS256");
}
