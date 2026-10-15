// Server-side half of the Google Identity Services popup code flow
// (initCodeClient, ux_mode "popup"): the browser posts the one-time code to
// POST /auth/google/code and we redeem it here. redirect_uri is the literal
// "postmessage" Google requires for popup codes. The returned id_token is then
// fully JWKS-verified by the existing GoogleTokenVerifier — this module never
// trusts it on its own.
import { z } from "zod";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_TIMEOUT_MS = 10_000;

const TokenResponseSchema = z.looseObject({ id_token: z.string().min(1) });

export interface GoogleCodeExchanger {
  // Resolves to the ID token Google issued for the code; rejects on any
  // transport, status, or shape failure. Callers map rejections to their own
  // error type and must not log the response (it carries tokens).
  exchange(code: string): Promise<string>;
}

export interface GoogleCodeExchangerOptions {
  clientId: string;
  clientSecret: string;
  // Test seam; defaults to the global fetch.
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export function createGoogleCodeExchanger(
  options: GoogleCodeExchangerOptions,
): GoogleCodeExchanger {
  const { clientId, clientSecret, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const doFetch = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));

  return {
    async exchange(code: string): Promise<string> {
      const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: "postmessage",
          grant_type: "authorization_code",
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Google token endpoint returned ${response.status}`);
      }
      return TokenResponseSchema.parse(await response.json()).id_token;
    },
  };
}
