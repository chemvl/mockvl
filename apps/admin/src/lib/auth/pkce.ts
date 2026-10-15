/**
 * PKCE (Proof Key for Code Exchange) helpers for the OAuth2 Authorization Code flow.
 * Uses the Web Crypto API only — no external dependencies.
 */

const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Random high-entropy `code_verifier`. */
export function createVerifier(): string {
  return randomBase64Url(VERIFIER_BYTES);
}

/** S256 `code_challenge` derived from a verifier. */
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Random `state` value for CSRF protection. */
export function createState(): string {
  return randomBase64Url(STATE_BYTES);
}
