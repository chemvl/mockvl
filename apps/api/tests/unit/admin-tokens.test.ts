import "../setup";
import { describe, expect, test } from "bun:test";
import { generateSessionToken, hashSessionToken } from "@/admin/auth/admin-tokens";

const SECRET = "an-admin-secret-that-is-32-chars-long";

describe("generateSessionToken", () => {
  test("returns a 256-bit base64url token, unique per call", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();

    // 32 bytes → 43 base64url chars, no padding.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("hashSessionToken", () => {
  test("is deterministic hex output for the same token and secret", () => {
    const token = generateSessionToken();

    const first = hashSessionToken(token, SECRET);
    const second = hashSessionToken(token, SECRET);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs across tokens and across secrets (keyed hash, not plain SHA-256)", () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token, SECRET)).not.toBe(
      hashSessionToken(generateSessionToken(), SECRET),
    );
    // A leaked DB of hashes is useless without the server-side secret.
    expect(hashSessionToken(token, SECRET)).not.toBe(hashSessionToken(token, `${SECRET}-other`));
  });
});
