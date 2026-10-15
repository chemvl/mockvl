// OAuth2 access-token provider for FCM HTTP v1, using the service-account
// JWT-bearer grant (RFC 7523) — hand-rolled with WebCrypto so no Google SDK
// dependency is needed. The signed JWT is exchanged at Google's token
// endpoint; the resulting short-lived token is cached via the shared
// token-cache (single-flight + expiry skew).

import { createTokenCache, type FetchedToken } from "@/clients/token-cache";
import { UpstreamError } from "@/lib/errors";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSERTION_TTL_S = 3600;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

// PEM "PRIVATE KEY" (PKCS#8) → DER bytes for crypto.subtle.importKey.
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface FcmTokenProviderOptions {
  clientEmail: string;
  /** Service-account private key, PEM (PKCS#8). */
  privateKey: string;
  fetchFn?: typeof fetch;
  /** Injectable clock for tests. */
  nowFn?: () => Date;
}

export function createFcmTokenProvider(options: FcmTokenProviderOptions) {
  const { clientEmail, privateKey, fetchFn = fetch, nowFn = () => new Date() } = options;

  // Imported lazily on first use and reused; import failure (malformed key)
  // surfaces on the first send, not at boot.
  let keyPromise: Promise<CryptoKey> | undefined;
  function getKey(): Promise<CryptoKey> {
    keyPromise ??= crypto.subtle.importKey(
      "pkcs8",
      pemToDer(privateKey).buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return keyPromise;
  }

  async function buildAssertion(): Promise<string> {
    const issuedAtS = Math.floor(nowFn().getTime() / 1000);
    const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
    const claims = base64UrlEncodeJson({
      iss: clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAtS,
      exp: issuedAtS + ASSERTION_TTL_S,
    });
    const signingInput = `${header}.${claims}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      await getKey(),
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }

  async function fetchToken(): Promise<FetchedToken> {
    const assertion = await buildAssertion();
    const response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
    });
    if (!response.ok) {
      // Never include the response body verbatim beyond status — it can echo
      // request details; status + provider name is enough to diagnose.
      throw new UpstreamError("fcm: token endpoint request failed", {
        provider: "fcm",
        status: response.status,
      });
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token || typeof payload.expires_in !== "number") {
      throw new UpstreamError("fcm: unexpected token endpoint response shape", {
        provider: "fcm",
      });
    }
    return { accessToken: payload.access_token, expiresInSeconds: payload.expires_in };
  }

  return createTokenCache({ fetchToken, ...(options.nowFn ? { nowFn: options.nowFn } : {}) });
}

export type FcmTokenProvider = ReturnType<typeof createFcmTokenProvider>;
