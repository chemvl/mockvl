/**
 * OAuth2 Authorization Code + PKCE — constants, redirect-URI resolution, and
 * authorize-URL construction. The transient PKCE verifier, CSRF state, and the
 * post-login redirect path are persisted across the full-page redirect.
 */
import storage from '@/lib/storage';

export const OAUTH_REDIRECT_PATH = '/user/auth/callback';
export const OAUTH_SCOPE = 'email profile';
export const OAUTH_CODE_CHALLENGE_METHOD = 'S256';

const AUTHORIZATION_ENDPOINT = `/api/app/auth`;

const PKCE_VERIFIER_KEY = 'pkceVerifier';
const OAUTH_STATE_KEY = 'oauthState';
const POST_LOGIN_REDIRECT_KEY = 'postLoginRedirect';

export function getRedirectUri(): string {
  return `${window.location.origin}${OAUTH_REDIRECT_PATH}`;
}

type AuthorizeParams = {
  state: string;
  codeChallenge: string;
  redirect: string;
};

export function buildAuthorizeUrl({
  state,
  codeChallenge,
  redirect,
}: AuthorizeParams): string {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirect,
    state,
    scope: OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: OAUTH_CODE_CHALLENGE_METHOD,
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export function savePendingAuth(params: {
  verifier: string;
  state: string;
  postLoginRedirect: string;
}): void {
  storage.setItem(PKCE_VERIFIER_KEY, params.verifier);
  storage.setItem(OAUTH_STATE_KEY, params.state);
  storage.setItem(POST_LOGIN_REDIRECT_KEY, params.postLoginRedirect);
}

export function readPendingAuth(): {
  verifier: string | undefined;
  state: string | undefined;
  postLoginRedirect: string | undefined;
} {
  return {
    verifier: storage.getItem(PKCE_VERIFIER_KEY),
    state: storage.getItem(OAUTH_STATE_KEY),
    postLoginRedirect: storage.getItem(POST_LOGIN_REDIRECT_KEY),
  };
}

export function clearPendingAuth(): void {
  storage.removeItem(PKCE_VERIFIER_KEY);
  storage.removeItem(OAUTH_STATE_KEY);
  storage.removeItem(POST_LOGIN_REDIRECT_KEY);
}
