// Thin wrapper over arctic so the admin-auth service (and its tests) depend on
// this interface, never on arctic itself (injectable seam, swapped for a fake in tests).
import { decodeIdToken, Google, generateCodeVerifier, generateState } from "arctic";
import { z } from "zod";

const GOOGLE_SCOPES = ["openid", "email", "profile"];

export interface GoogleAuthRequest {
  state: string;
  codeVerifier: string;
  url: URL;
}

// The subset of Google ID-token claims the service validates. Everything is
// optional at this layer: the *service* decides what missing claims mean.
export const GoogleClaimsSchema = z.looseObject({
  sub: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  // Google only sets `hd` for Workspace accounts; its presence and value are
  // the org-membership check (done in the service, on this verified token —
  // the `hd` URL parameter is a UX hint, not security).
  hd: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type GoogleClaims = z.infer<typeof GoogleClaimsSchema>;

export interface GoogleOAuth {
  createAuthorizationRequest(hdHint: string): GoogleAuthRequest;
  // Exchanges the callback code and returns the decoded ID-token claims. The
  // token arrives straight from Google's token endpoint over TLS, so per OIDC
  // §3.1.3.7 signature re-verification is not required — claim validation is.
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleClaims>;
}

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createGoogleOAuth(options: GoogleOAuthOptions): GoogleOAuth {
  const google = new Google(options.clientId, options.clientSecret, options.redirectUri);

  return {
    createAuthorizationRequest(hdHint: string): GoogleAuthRequest {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
      // Pre-selects the org domain on the consent screen. UX only — the real
      // check is the hd claim inside the returned ID token.
      url.searchParams.set("hd", hdHint);
      return { state, codeVerifier, url };
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<GoogleClaims> {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      return GoogleClaimsSchema.parse(decodeIdToken(tokens.idToken()));
    },
  };
}
