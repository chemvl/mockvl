import "../setup";
import { describe, expect, test } from "bun:test";
import { sign } from "hono/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { createGoogleTokenVerifier } from "@/modules/auth/google-token";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const KID = "test-kid-1";

interface TestKeypair {
  publicJwk: HonoJsonWebKey;
  privateJwk: HonoJsonWebKey;
}

async function createKeypair(kid: string): Promise<TestKeypair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid,
    alg: "RS256",
    use: "sig",
  };
  // hono's sign() reads alg and kid from the JWK to build the token header.
  const privateJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    kid,
    alg: "RS256",
  };
  return { publicJwk, privateJwk };
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-123",
    email: "user@example.com",
    email_verified: true,
    iat: nowSeconds - 30,
    exp: nowSeconds + 3600,
    ...overrides,
  };
}

// Sequential fake fetcher: call N returns sets[N] (clamped to the last set).
function createFakeJwks(sets: HonoJsonWebKey[][]) {
  let calls = 0;
  return {
    fetchJwks: async () => {
      const keys = sets[Math.min(calls, sets.length - 1)] ?? [];
      calls += 1;
      return { keys };
    },
    callCount: () => calls,
  };
}

const keypair = await createKeypair(KID);

function createVerifier(sets: HonoJsonWebKey[][] = [[keypair.publicJwk]]) {
  const jwks = createFakeJwks(sets);
  const verifier = createGoogleTokenVerifier({ clientId: CLIENT_ID, fetchJwks: jwks.fetchJwks });
  return { verifier, jwks };
}

describe("createGoogleTokenVerifier", () => {
  test("returns the claims for a valid Google ID token", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims(), keypair.privateJwk);

    const claims = await verifier.verify(token);
    expect(claims.sub).toBe("google-sub-123");
    expect(claims.email).toBe("user@example.com");
    expect(claims.email_verified).toBe(true);
  });

  test("accepts the issuer form without the https prefix", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims({ iss: "accounts.google.com" }), keypair.privateJwk);

    const claims = await verifier.verify(token);
    expect(claims.sub).toBe("google-sub-123");
  });

  test("rejects a token for a different audience", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims({ aud: "someone-else" }), keypair.privateJwk);

    expect(verifier.verify(token)).rejects.toThrow();
  });

  test("rejects a token from a different issuer", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims({ iss: "https://evil.example.com" }), keypair.privateJwk);

    expect(verifier.verify(token)).rejects.toThrow();
  });

  test("rejects an expired token", async () => {
    const { verifier } = createVerifier();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await sign(
      googleClaims({ iat: nowSeconds - 7200, exp: nowSeconds - 3600 }),
      keypair.privateJwk,
    );

    expect(verifier.verify(token)).rejects.toThrow();
  });

  test("tolerates a slightly-future iat (clock skew)", async () => {
    const { verifier } = createVerifier();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await sign(googleClaims({ iat: nowSeconds + 60 }), keypair.privateJwk);

    const claims = await verifier.verify(token);
    expect(claims.sub).toBe("google-sub-123");
  });

  test("rejects a token with a tampered payload", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims(), keypair.privateJwk);

    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify(googleClaims({ sub: "attacker" })))
      .toString("base64url")
      .replace(/=/g, "");
    const forged = `${header}.${forgedPayload}.${signature}`;

    expect(verifier.verify(forged)).rejects.toThrow();
  });

  test("rejects symmetric (HS256) tokens", async () => {
    const { verifier } = createVerifier();
    const token = await sign(googleClaims(), "some-shared-secret", "HS256");

    expect(verifier.verify(token)).rejects.toThrow();
  });

  test("rejects a valid signature whose claims are missing sub", async () => {
    const { verifier } = createVerifier();
    const claims = googleClaims();
    const { sub: _sub, ...withoutSub } = claims;
    const token = await sign(withoutSub, keypair.privateJwk);

    expect(verifier.verify(token)).rejects.toThrow();
  });

  test("caches JWKS across verifications", async () => {
    const { verifier, jwks } = createVerifier();
    const token = await sign(googleClaims(), keypair.privateJwk);

    await verifier.verify(token);
    await verifier.verify(token);
    expect(jwks.callCount()).toBe(1);
  });

  test("refetches once when the token kid is missing from cached keys (rotation)", async () => {
    const rotated = await createKeypair("rotated-kid");
    // First fetch returns only the old key; the refetch returns both.
    const { verifier, jwks } = createVerifier([
      [keypair.publicJwk],
      [keypair.publicJwk, rotated.publicJwk],
    ]);

    // Prime the cache with the old key set.
    await verifier.verify(await sign(googleClaims(), keypair.privateJwk));
    expect(jwks.callCount()).toBe(1);

    const claims = await verifier.verify(await sign(googleClaims(), rotated.privateJwk));
    expect(claims.sub).toBe("google-sub-123");
    expect(jwks.callCount()).toBe(2);
  });

  test("does not refetch when the kid is known and verification still fails", async () => {
    const impostor = await createKeypair(KID); // same kid, different key material
    const { verifier, jwks } = createVerifier();

    // Prime the cache.
    await verifier.verify(await sign(googleClaims(), keypair.privateJwk));

    expect(verifier.verify(await sign(googleClaims(), impostor.privateJwk))).rejects.toThrow();
    expect(jwks.callCount()).toBe(1);
  });

  test("still fails when the refetched keys do not contain the kid either", async () => {
    const unknown = await createKeypair("never-published");
    const { verifier } = createVerifier([[keypair.publicJwk]]);

    await verifier.verify(await sign(googleClaims(), keypair.privateJwk));

    expect(verifier.verify(await sign(googleClaims(), unknown.privateJwk))).rejects.toThrow();
  });
});
