// Session token primitives for admin auth. Mirrors modules/auth/auth.tokens.ts
// but hashes with HMAC keyed by ADMIN_SESSION_SECRET: a leaked admin_sessions
// table cannot be replayed (or brute-forced offline) without the server secret.

const SESSION_TOKEN_BYTES = 32; // 256 bits, returned once inside the cookie

export function generateSessionToken(): string {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(token).digest("hex");
}
