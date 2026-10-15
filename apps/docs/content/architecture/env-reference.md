---
title: Env Reference
description: Every environment variable the API reads, grouped, with types, defaults, and purpose.
order: 3
---

The single source of truth is `apps/api/src/config/env.ts`: a Zod schema parsed once at import time. A misconfigured process fails **at boot** with a readable list of the offending keys — never on the first request that touches a missing value. No other file reads `process.env`.

```bash
# generate a secret of the required strength
openssl rand -hex 32
```

Rules that apply across the board:

- Secrets (`JWT_SECRET`, `ADMIN_SESSION_SECRET`) must be **at least 32 characters**; boot fails otherwise.
- `.env.example` must be updated with every new key — it is the checked-in catalog of what the API needs.
- Values below are placeholders; never commit real credentials.

## Core

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` | `development` | Runtime mode; also relaxes the `Secure` cookie flag in development |
| `PORT` | integer 1–65535 | `3000` | HTTP listen port |
| `API_BASE_PATH` | URL path, e.g. `/api` | `/api` | Prefix for every route (`/api/health`). Normalized: leading slash added, trailing slashes stripped; `/` means serve at the root. The OpenAPI doc, Scalar UI, OAuth cookie scope, and Google redirect URI all follow it |

## Database and Redis

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | URL, `postgres://user:pass@localhost:5433/app` | — (required) | Postgres connection for Drizzle and pg-boss |
| `REDIS_URL` | URL, `redis://localhost:6380` | — (required) | Redis for rate-limit store, cache-aside, locks/idempotency. Cache only — never a source of truth |
| `CACHE_DEFAULT_TTL_S` | integer ≥ 1 (seconds) | `300` | Default TTL for `cached()` entries |

## JWT auth (public users)

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | string, min 32 chars | — (required) | Signs access tokens |
| `JWT_ACCESS_TTL` | duration string | `15m` | Access-token lifetime |
| `JWT_REFRESH_TTL` | duration string | `30d` | Refresh-token lifetime |

## Admin OIDC and session

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | string | — (required) | Google OAuth client id (also the `aud` for public `POST /auth/google` ID-token verification) |
| `GOOGLE_CLIENT_SECRET` | string | — (required) | Google OAuth client secret |
| `GOOGLE_ALLOWED_HD` | string, e.g. `company.com` | — (required) | Workspace domain the verified ID token's `hd` claim must equal — the org restriction |
| `ADMIN_SESSION_SECRET` | string, min 32 chars | — (required) | HMAC key for hashing admin session tokens in the DB |
| `ADMIN_URL` | URL, e.g. `http://localhost:8000` | — (required) | Admin app origin: the only CORS origin, and the post-login redirect target |
| `API_URL` | URL, e.g. `http://localhost:3000` | — (required) | Public URL of this API (builds the Google redirect URI) |
| `APP_URL` | URL, e.g. `http://localhost:8080` | — (required) | Public app origin (the Mockvl SPA). Neither `ADMIN_URL` (dashboard) nor `API_URL` (this API) is the user-facing app; `MOCK_PUBLIC_BASE_URL` defaults to `${APP_URL}/m` |
| `ADMIN_SEED_OWNER_EMAIL` | email (optional) | — | First-owner seeding: an admin logging in with this email is created as (or promoted to) `owner`; everyone else defaults to `viewer` |

## FCM push (all-or-none)

The three FCM keys are enforced as a group in a `superRefine`: set **all three or none**. With none set, the API boots with the log-only push sender — no Firebase project needed.

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `FCM_PROJECT_ID` | string (optional) | — | Firebase project id |
| `FCM_CLIENT_EMAIL` | email (optional) | — | Service-account client email |
| `FCM_PRIVATE_KEY` | PEM string (optional) | — | Service-account private key; `\n` escapes are unfolded, so the key can live on one line in `.env` or a secret store |

## Rate limiting and proxy trust

Limits are **per IP**. Behind carrier-grade NAT one address can carry hundreds of real users, so size the global tier as `max users per IP × requests per user per minute × 2` and treat it as a flood backstop, not a fairness control.

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `RATE_LIMIT_FAIL_OPEN` | `true` \| `false` | `true` | Redis-outage stance for rate limiting: `true` serves traffic and logs; `false` rejects with 429. Locks/idempotency always fail closed regardless |
| `RATE_LIMIT_GLOBAL_LIMIT` | integer ≥ 1 | `100` | Global requests per window per IP (`/health` and `/ready` exempt) |
| `RATE_LIMIT_GLOBAL_WINDOW_MS` | integer ≥ 1 (ms) | `60000` | Global window length |
| `RATE_LIMIT_AUTH_LIMIT` | integer ≥ 1 | `10` | Strict limit on `/auth/*` and `/admin/auth/*` |
| `RATE_LIMIT_AUTH_WINDOW_MS` | integer ≥ 1 (ms) | `60000` | Auth window length |
| `TRUST_PROXY` | `true` \| `false` | `false` | `true` when a trusted reverse proxy fronts the API — the client IP is read from `x-real-ip` / the rightmost `x-forwarded-for` hop. `false` when exposed directly: forwarded headers are client-forgeable (trivial rate-limit bypass) and are ignored in favor of the socket address |

## Email (Resend)

The two Resend keys are enforced as a group in a `superRefine`: set **both or neither**. With neither set, the API boots with the log-only email sender — the welcome-email worker logs instead of sending.

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | string (optional) | — | Resend API key. Never logged — redaction catches `*_KEY` |
| `RESEND_FROM_ADDRESS` | email (optional) | — | From address for outgoing email (the welcome email) |

## Misc

| Name | Type / format | Default | Purpose |
|---|---|---|---|
| `DOCS_ENABLED` | `true` \| `false` | `true` | Serves `/docs` (Scalar) and `/openapi.json`; disable or gate in production |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` | `info` | pino log level |

## Adding a new variable

1. Add it to the Zod schema in `apps/api/src/config/env.ts` (with a default or as required).
2. Add it to `.env.example` with a placeholder value.
3. Read it only via the exported `env` object — never `process.env`.

For how each auth-related key is actually used, see the [Security Model](/architecture/security-model/); for local values, `cp .env.example .env` per [Setup](/getting-started/setup/).
