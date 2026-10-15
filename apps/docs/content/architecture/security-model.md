---
title: Security Model
description: How public JWT auth, admin OIDC, sessions, CORS, rate limiting, and log redaction protect the API — and which rules must never be weakened.
order: 4
---

Two auth realms protect two route families: public app users authenticate with JWTs under `/auth/*`, admins authenticate with Google OIDC + a session cookie under `/admin/*`. Everything below is implemented; the rules marked "do not weaken" are load-bearing.

## Public user auth (JWT + rotating refresh tokens)

App users sign in with Google only — there is no email/password login. `POST /auth/google` and `POST /auth/google/code` both return the same shape: `{ user, accessToken, refreshToken }`.

- **Access token** — a JWT signed with `JWT_SECRET`, short-lived (`JWT_ACCESS_TTL`, default 15m). Sent as `Authorization: Bearer <token>`; verified by `middleware/auth.ts`.
- **Refresh token** — returned to the client **once** and stored server-side only as a **SHA-256 hash**, so a leaked `refresh_tokens` table cannot be replayed.
- **Rotation** — `POST /auth/refresh` rotates on every use: the old token is retired and a new pair is issued.
- **Reuse detection** — replaying an already-rotated refresh token revokes its entire token **family**. A stolen token can be used at most once before the theft burns the whole chain; `POST /auth/logout` revokes the family explicitly and is idempotent.
- **Google sign-in** (`POST /auth/google`) — the client sends a Google ID token, which the server verifies against Google's **JWKS** with `aud` = `GOOGLE_CLIENT_ID`. It matches by Google identity, auto-links by *verified* email, or creates a password-less account; any verification failure is a uniform 401. `POST /auth/google/code` takes a GIS popup authorization code instead, exchanges it server-side for an ID token, then runs the same checks.

Endpoint-by-endpoint details: [Auth Cheat Sheet](/reference/auth-cheat-sheet/).

## Admin auth (Google OIDC)

Admins sign in with Google, restricted to one Workspace domain (flow in `apps/api/src/admin/auth/`, see [Admin Auth](/admin/auth/)).

**The org restriction — do not weaken:** the `hd` claim **inside the ID token returned by Google's token endpoint** must equal `GOOGLE_ALLOWED_HD`, enforced in `admin-auth.service.ts`. The `hd` URL parameter on the consent screen is only a UX hint and proves nothing. The ID token arrives directly from Google over TLS during the code exchange, so its claims are trusted without a separate JWKS check (OIDC §3.1.3.7); `hd`, `email`, and `email_verified` are all validated.

The OAuth round-trip uses state + PKCE, carried in 10-minute httpOnly cookies scoped to `/admin/auth`.

## Admin sessions

- Random 256-bit token in an `httpOnly`, `Secure` (relaxed only when `NODE_ENV=development`), `SameSite=Lax` cookie.
- The DB stores only an **HMAC-SHA256** of the token, keyed by `ADMIN_SESSION_SECRET` — a leaked `admin_sessions` table cannot be replayed.
- 7-day sliding expiry, renewed (DB + cookie) once less than half the lifetime remains.
- **CSRF** — `SameSite=Lax` plus a required `X-Requested-With` header on every mutating `/admin/*` request (`middleware/admin-csrf.ts`). Cross-origin JavaScript cannot set custom headers without passing CORS preflight, and CORS only admits `ADMIN_URL` — so no token plumbing is needed in the SPA.

## Admin authorization (RBAC)

Roles: `viewer < editor < owner`. **Every** generic admin CRUD route is guarded by `requireAdmin(<action permission>)` — no exceptions; an action absent from a resource's `permissions` map is never even mounted. New sign-ins default to `viewer`; `ADMIN_SEED_OWNER_EMAIL` bootstraps the first `owner`. The generic engine serializes rows through each resource's output schema, so undeclared columns (e.g. `users.passwordHash`) cannot leak. See [Resource Registry](/admin/resource-registry/).

## CORS

Explicit allow-list: **only** the `ADMIN_URL` origin, with `credentials: true`. Never a wildcard with credentials — the two are mutually exclusive by design here, not just by spec. `X-Request-Id` is exposed to browser clients for bug reports.

## Rate limiting

Two tiers (`middleware/rate-limit.ts`), env-tunable, both answering with the standard 429 `RATE_LIMITED` envelope plus `RateLimit-*` and `Retry-After` headers:

| Tier | Default | Scope |
|---|---|---|
| Global | 100 req/min/IP | Everything except `/health` and `/ready` |
| Auth | 10 req/min/IP | `/auth/*` and `/admin/auth/*` |

- **Shared budget** — production wiring passes the Redis store (`middleware/rate-limit-redis-store.ts`), so all instances enforce one budget. Requires Redis ≥ 7.0 (`PEXPIRE … NX`).
- **`TRUST_PROXY`** — with `true`, the client IP comes from `x-real-ip` / the rightmost `x-forwarded-for` hop (correct behind nginx ingress or a LB). With `false` (the default), forwarded headers are ignored as client-forgeable — otherwise spoofing a header is a trivial rate-limit bypass.
- **`RATE_LIMIT_FAIL_OPEN`** — on a Redis outage the limiter fails **open** by default (serve and log `RATE_LIMIT_STORE_DOWN`); set `false` to fail closed with 429s. Locks and idempotency primitives always fail **closed** regardless — if Redis cannot confirm the state, the operation is rejected. More in [Redis](/guides/redis/).

Tune the limits with the `RATE_LIMIT_*` keys in the [Env Reference](/architecture/env-reference/).

## Transport-level hardening

Global middleware order in `app.ts`: request-id → request logger → `secureHeaders()` → CORS → rate limits → JSON-only → body limit. All rejections use the standard error envelope.

- `secureHeaders()` — hono defaults: nosniff, frame options, HSTS, and friends.
- **Body limit** — 1 MiB; larger bodies get a 413 `PAYLOAD_TOO_LARGE`.
- **JSON-only** — mutating requests carrying a body must send `Content-Type: application/json`, otherwise 415 `UNSUPPORTED_MEDIA_TYPE`.
- `/docs` and `/openapi.json` disappear when `DOCS_ENABLED=false` — disable or admin-gate them in production.

## Secrets in logs

The logger (`lib/logger.ts`) redacts before anything reaches the stream: `authorization`, `cookie`, `set-cookie`, `password`, and any key ending in `key`/`secret`/`token` in snake_case, kebab-case, or camelCase become `[Redacted]` — including properties on serialized errors. The outbound HTTP client never puts provider headers or bodies into error messages, details, or logs. Env secrets live only in `.env` / your secret manager, never in code.

## Do-not-weaken checklist

| Rule | Why |
|---|---|
| Refresh tokens: returned once, stored as SHA-256, rotated each use, family revoked on reuse | Limits any stolen token to a single use |
| Admin `hd` check on the **verified ID token**, never the URL param | The URL param is attacker-choosable UX sugar |
| Admin cookies: httpOnly + Secure + SameSite=Lax; hashed session tokens in DB | XSS cannot read the cookie; a DB leak cannot mint sessions |
| `requireAdmin(<permission>)` on every generic admin CRUD route | One unguarded route defeats the whole RBAC model |
| CORS: explicit origins with `credentials: true`, never `*` | Wildcard + credentials hands the session to any origin |
| Redaction list stays intact | One logged `Authorization` header is a leaked credential |

If you change any of these paths, run the auth test suites (see [Testing](/guides/testing/)) before shipping.
