import "../setup";
import { describe, expect, test } from "bun:test";
import { verify } from "hono/jwt";
import { generateOpaqueToken, hashOpaqueToken, signAccessToken } from "@/modules/auth/auth.tokens";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!";

describe("generateOpaqueToken", () => {
  test("returns a 43-char base64url string (256 bits)", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("returns a different value every call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("hashOpaqueToken", () => {
  test("returns the sha256 hex digest", () => {
    // Known vector: sha256("test")
    expect(hashOpaqueToken("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  test("is deterministic and 64 hex chars", () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hash);
  });
});

describe("signAccessToken", () => {
  test("produces a JWT that verifies with sub, type and exp", async () => {
    // Anchor to the current time so `verify` doesn't reject the token as expired.
    const now = new Date();
    const token = await signAccessToken({
      sub: "user-123",
      secret: TEST_SECRET,
      ttlSeconds: 900,
      now,
    });

    const payload = await verify(token, TEST_SECRET, "HS256");
    expect(payload.sub).toBe("user-123");
    expect(payload.type).toBe("access");
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(payload.exp).toBe(Math.floor(now.getTime() / 1000) + 900);
  });

  test("verification fails with the wrong secret", async () => {
    const token = await signAccessToken({
      sub: "user-123",
      secret: TEST_SECRET,
      ttlSeconds: 900,
    });
    await expect(verify(token, "another-secret-that-is-32-chars-long!", "HS256")).rejects.toThrow();
  });
});
