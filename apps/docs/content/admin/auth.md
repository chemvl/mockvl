---
title: Admin Authentication
description: How admins sign in with Google OIDC, how sessions work, and how to guard admin routes with roles.
order: 1
---

Admins sign in with Google (OIDC via `arctic`), restricted to a single Google Workspace domain. There are no admin passwords: if your Google account belongs to the allowed domain, you can sign in; your role decides what you can do. The whole flow lives in `apps/api/src/admin/auth/`.

This is a separate auth realm from app users. App users get JWTs via `/auth/*`; admins get a session cookie via `/admin/auth/*`. See the [auth cheat sheet](/reference/auth-cheat-sheet/) for the side-by-side.

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /admin/auth/google` | Redirects to the Google consent screen (state + PKCE cookies set) |
| `GET /admin/auth/google/callback` | Exchanges the code, validates claims, sets the session cookie, redirects to `ADMIN_URL` |
| `GET /admin/auth/me` | Returns the signed-in admin (401 without a valid session) |
| `POST /admin/auth/logout` | Deletes the session — idempotent, a dead cookie is a harmless 200 |

Any failure in the callback redirects to `ADMIN_URL?error=admin_login_failed` — never a JSON error mid browser flow, and never a hint about which check failed. The specifics are logged server-side only.

## The org restriction (do not weaken)

The security-critical check: the `hd` claim **inside the ID token returned by Google's token endpoint** must equal `GOOGLE_ALLOWED_HD`. The `hd` URL parameter on the consent screen is only a UX hint that pre-selects the account — anyone can edit it, so it proves nothing.

The check lives in `apps/api/src/admin/auth/admin-auth.service.ts`:

```typescript
// SECURITY (do not weaken): the hd claim inside the verified ID token must
// equal GOOGLE_ALLOWED_HD. The `hd` URL parameter on the consent screen is a
// hint anyone can edit; this claim is asserted by Google for the signed-in
// account and is the actual org-membership check.
function validateClaims(claims: GoogleClaims) {
  if (claims.hd !== allowedHd || !claims.email || claims.email_verified !== true) {
    logger.warn(/* ... */);
    throw new UnauthorizedError(ADMIN_LOGIN_FAILED);
  }
  // ...
}
```

The ID token arrives directly from Google over TLS during the code exchange, so its claims are trusted without a separate JWKS signature check (OIDC §3.1.3.7). Everything else about it is validated: `hd`, `email`, and `email_verified === true`.

The Google wire calls sit behind the `GoogleOAuth` interface (`admin/auth/google.ts`), so tests inject a fake instead of talking to Google — the e2e acceptance flow is `tests/e2e/admin-auth-e2e.test.ts`.

## Sessions

A successful login creates a session:

- A random 256-bit token goes into the `admin_session` cookie: `httpOnly`, `Secure` (skipped when `NODE_ENV=development`), `SameSite=Lax`.
- The database stores only an HMAC-SHA256 of the token, keyed by `ADMIN_SESSION_SECRET` — a leaked `admin_sessions` table cannot be replayed.
- Expiry is 7 days, sliding: when less than half the lifetime remains, the session is renewed in both the DB and the cookie.
- State and the PKCE verifier for the OAuth round-trip ride in 10-minute httpOnly cookies scoped to `/admin/auth`.

A dead cookie (expired or deleted session) is cleared by the middleware so the browser stops resending it.

## Roles and requireAdmin

Roles are an ordered enum: `viewer < editor < owner` (`admin_role` in Postgres). Guard any admin route with `requireAdmin(minRole)` from `apps/api/src/middleware/admin-auth.ts`. It is built once per app via the factory pattern:

```typescript
// At assembly time:
const requireAdmin = createRequireAdmin(adminAuthService);

// Per route:
app.get("/admin/reports", requireAdmin("editor"), (c) => {
  const admin = c.get("adminUser"); // the validated AdminUser row
  // ...
});
```

The middleware validates the session, enforces the minimum role (403 with `Requires <role> role` otherwise), refreshes the sliding cookie when needed, and puts the admin on the context as `adminUser`. Every generic CRUD route from the [resource registry](/admin/resource-registry/) is guarded this way — one `requireAdmin(<permission>)` per action, no exceptions.

Role changes happen through the **Admins** resource in the dashboard (`PATCH /admin/admins/:id`, owner-only, role is the only editable field). Changes apply on the target's next request — sessions read the role fresh from the DB. The last owner can never be demoted or deleted (409).

## Seed owner

New sign-ins default to `viewer`. To bootstrap the first `owner`, set the seed email **before** that person's first login:

```bash
ADMIN_SEED_OWNER_EMAIL=you@company.com
```

On login, that account is created as (or promoted to) `owner`. Deleting an admin kills their sessions but is a reset, not a ban — a Google re-login recreates them as `viewer`.

## CSRF protection

Mutating `/admin/*` requests must carry an `X-Requested-With` header (`apps/api/src/middleware/admin-csrf.ts`), on top of `SameSite=Lax`. Cross-origin JavaScript cannot set custom headers without passing CORS preflight, and CORS only admits `ADMIN_URL` — so no token plumbing is needed in the SPA. The dashboard just sends:

```http
X-Requested-With: XMLHttpRequest
```

on every write. `/admin/auth/*` also shares the strict auth rate-limit tier with `/auth/*`.

## Login from the dashboard's perspective

The [admin frontend](/admin/frontend/) has two auth realms; the admin session gates the resource data. The flow you see as a user:

1. Open a `/resources/*` page without an admin session — you get a "Sign in with Google" card instead of data. The shell keeps working.
2. Clicking it sends the browser to `GET /admin/auth/google`, which redirects to Google with your Workspace domain pre-selected.
3. After consent, Google calls `/admin/auth/google/callback`; the API validates the ID token claims, upserts your admin user, sets the `admin_session` cookie, and redirects back to `ADMIN_URL`.
4. The dashboard re-fetches `GET /admin/auth/me` and `GET /admin/meta/resources` and renders what your role allows.

On any failure you land back on `ADMIN_URL?error=admin_login_failed` — usually a wrong-domain Google account.

## Local development

```bash
# .env (see .env.example)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_ALLOWED_HD=company.com          # Workspace domain admins must belong to
ADMIN_SEED_OWNER_EMAIL=you@company.com # first owner, applied on their first login
ADMIN_SESSION_SECRET=...               # >= 32 chars, e.g. openssl rand -hex 32
ADMIN_URL=http://localhost:8000        # the admin dev server port
```

Notes for local runs:

- The admin app runs on **port 8000**, so `ADMIN_URL` must be `http://localhost:8000` — it is both the CORS origin and the post-login redirect target.
- The session cookie drops the `Secure` flag when `NODE_ENV=development`, so it works over plain `http://localhost`. In every other environment it is Secure.
- If login loops, your Google account's domain does not match `GOOGLE_ALLOWED_HD`, or the cookie is blocked — check the CORS `credentials` config when running Vite on a separate port. More in [troubleshooting](/reference/troubleshooting/).
- Repeated login attempts can hit the auth rate-limit tier (429); raise `RATE_LIMIT_AUTH_LIMIT` locally if needed.

All keys are validated at boot by `config/env.ts` — a missing value crashes startup with the variable named. See the [env reference](/architecture/env-reference/) for the full list and the [security model](/architecture/security-model/) for how the admin realm fits the bigger picture.
