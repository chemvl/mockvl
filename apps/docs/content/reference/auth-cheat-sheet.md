---
title: Auth cheat sheet
description: Every auth endpoint, token lifetime, and header for both realms — public JWT users and cookie-session admins — on one page.
order: 1
---

The API has two independent auth realms. Public app users authenticate with JWTs over the `Authorization` header; admins authenticate with Google OIDC and an `admin_session` cookie. All paths below are relative to the API base path (`API_BASE_PATH`, default `/api`).

## Public users (JWT)

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/auth/google` | POST | none | Body `{ idToken }` — a client-obtained Google ID token, verified server-side via JWKS. Matches by Google account, auto-links by verified email, or creates a password-less account (and enqueues a welcome-email job). Returns `{ user, accessToken, refreshToken }`. All verification failures return a generic 401. |
| `/auth/google/code` | POST | none + `X-Requested-With` | Body `{ code }` — a Google Identity Services popup authorization code, exchanged server-side for an ID token, then handled exactly like `/auth/google`. Same session envelope. |
| `/auth/refresh` | POST | none (body carries the refresh token) | Returns a new access + refresh pair. The old refresh token is dead after this call. |
| `/auth/logout` | POST | none (body carries the refresh token) | Revokes the whole refresh-token family. Idempotent 200. |
| `/users/me` | GET | `Authorization: Bearer <access>` | Example protected route; any route behind `authMiddleware` reads the caller via `c.var.userId`. |

### Token rules

- **Access token** — JWT, **15 minutes** (`JWT_ACCESS_TTL`). Send it on every protected request:

```http
GET /api/users/me HTTP/1.1
Authorization: Bearer <accessToken>
```

- **Refresh token** — random 256-bit value, **30 days** (`JWT_REFRESH_TTL`), returned exactly once and stored server-side only as a SHA-256 hash.
- **Rotation** — every `POST /auth/refresh` burns the presented token and issues a new pair. Presenting a rotated or revoked token is treated as reuse and revokes the entire token family.
- No cookies are involved, so mobile and server-to-server clients need no CORS setup. See /consumers/consuming-the-api/ for client-side patterns.

```typescript
// Typical client refresh flow
const res = await fetch("/api/auth/refresh", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refreshToken }),
});
const { data } = await res.json(); // { accessToken, refreshToken } — store BOTH
```

## Admins (Google OIDC + session cookie)

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/admin/auth/google` | GET | none | Browser entry point. Redirects to Google consent (PKCE + state, `hd` hint). |
| `/admin/auth/google/callback` | GET | none | Exchanges the code, verifies the ID token — the `hd` claim must equal `GOOGLE_ALLOWED_HD` — then sets the `admin_session` cookie and redirects to `ADMIN_URL`. Failures redirect with `?error=admin_login_failed`. |
| `/admin/auth/me` | GET | `admin_session` cookie | Returns the current admin (email, name, role) or 401. |
| `/admin/auth/logout` | POST | none + CSRF header | Idempotent 200. Requires `X-Requested-With` like every mutating `/admin/*` route. |

### Session rules

- Cookie: httpOnly, Secure (except `NODE_ENV=development`), SameSite=Lax, **7-day sliding expiry**. Tokens are stored hashed in Postgres.
- Roles: `viewer < editor < owner`. Routes are guarded with `requireAdmin(minRole)`; the admin is available as `c.var.adminUser`. Role changes apply on the target's next request.
- **CSRF**: every non-GET `/admin/*` request must send `X-Requested-With: XMLHttpRequest`, or it is rejected with 403.
- **First owner**: set `ADMIN_SEED_OWNER_EMAIL` in `.env` before that person's first login. Everyone else starts as `viewer`.
- Owners manage roles at `PATCH /admin/admins/:id` (role is the only editable field); the last owner cannot be demoted or deleted (409). Deleting an admin kills their sessions but a Google re-login recreates them as `viewer`.

```bash
# Mutating admin call: cookie + CSRF header
curl -X POST http://localhost:3000/api/admin/auth/logout \
  -H "X-Requested-With: XMLHttpRequest" \
  --cookie "admin_session=<token>"
```

## Rate limits that affect auth

Both `/auth/*` and `/admin/auth/*` share the strict per-IP tier: `RATE_LIMIT_AUTH_LIMIT` per `RATE_LIMIT_AUTH_WINDOW_MS` (default 10/min; `/admin/auth/me` is exempt). Hitting it returns a 429 envelope — see /reference/troubleshooting/ if this bites during development.

## Where the code lives

| Concern | Location |
|---|---|
| Public auth routes/service/token helpers | `apps/api/src/modules/auth/` |
| Google ID-token verification (public) | `apps/api/src/modules/auth/google-token.ts` |
| Admin OIDC flow, sessions, roles | `apps/api/src/admin/auth/` |
| CSRF middleware | `apps/api/src/middleware/admin-csrf.ts` |

For the full security rationale behind these rules, see /architecture/security-model/. For admin-side details, see /admin/auth/.
