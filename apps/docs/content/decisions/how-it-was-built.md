---
title: How it was built
description: Historical record of the phase-by-phase build process that produced this codebase and explains why it is so uniform.
order: 1
---

This codebase was not grown organically — it was built phase by phase from a fixed,
pre-written implementation plan, by an autonomous coding agent working one phase per
session. That process, more than any style guide, explains why every module, repo, and
test in the repository looks the same: each phase established a pattern once, and every
later phase was required to copy it. (The plan and log are not part of the public repository.)

## The working method

- **A written build plan was the immutable source of truth.** It specified the stack (Hono on
  Bun, PostgreSQL via Drizzle, Zod everywhere, pg-boss, Refine admin), the global
  conventions (response envelopes, the list query contract, error handling, layering
  rules), and acceptance criteria per phase. The agent was forbidden from editing it;
  when reality demanded a change, an amendment was proposed to the user instead.
- **A progress log was the running record.** Each completed phase appended a dated
  entry recording what shipped, deviations, review findings, and follow-ups — the
  decision records in this section are distilled from those entries.
- **One phase per session, no look-ahead.** No speculative abstractions, no stubs for
  future phases, no dependencies not listed in the plan.
- **A definition of done gated every phase**: `bun run typecheck`, `bun run lint`
  (Biome), `bun test`, plus the phase's acceptance criteria *actually executed* —
  servers run, endpoints hit, e2e flows exercised — never just reasoned about. Code
  review followed each phase, and MEDIUM-and-above findings were fixed test-first
  before the phase was marked done.

## The phases

| Phase | What landed |
|---|---|
| 1 — Skeleton & foundations | Workspace root, fail-fast Zod env, `AppError` hierarchy, pino JSON logging with secret redaction, request-id middleware, `/health` + `/ready`, graceful shutdown. |
| 2 — Database | Compose Postgres 16 (host port 5433), Drizzle + postgres.js pool, `users` and `refresh_tokens` tables, migration scripts. |
| 3 — App-user JWT auth | Register/login/refresh/logout with argon2id (`Bun.password`), 15-minute access JWTs, hashed single-use rotating refresh tokens with family revocation — the module pattern exemplar. |
| 4 — OpenAPI + Scalar | All routes converted to `createRoute()`; `packages/schemas` became the single source of truth; `/openapi.json` + `/docs` gated by `DOCS_ENABLED`. |
| 5 — Third-party client pattern | `createHttpClient` (timeout, retry with backoff + jitter, `UpstreamError` mapping, credential-safe logging) plus the mockable example provider. |
| 6 — Background jobs | pg-boss on `DATABASE_URL`, typed `enqueue`, the welcome-email worker, and a separate `bun run worker` entrypoint. |
| 7 — Hardening | Rate limiting (strict `/auth/*` tier + global tier), secure headers, explicit-origin CORS with credentials, body limits, JSON-only enforcement. |
| 8 — Tests, Docker, CI | unit/integration/e2e test layout, multi-stage Bun Dockerfile, path-filtered GitHub Actions pipeline. |
| 8.5 — Redis (a–d) | Added mid-plan by an approved amendment: (a) client + readiness + compose Redis 7 on host port 6380; (b) Redis-backed rate-limit store that fails open; (c) `cached()`/`invalidate()` cache-aside utility that fails open; (d) `withLock` + `idempotent` primitives that fail closed. Redis is cache/coordination only — never a source of truth. |
| 9a — Admin auth | Google OIDC via arctic with server-side `hd` claim verification, HMAC-hashed session tokens, 7-day sliding cookies, `requireAdmin(minRole)`, CSRF via `X-Requested-With`. |
| 9b — Resource registry | `registry.register(def)` → generic, permission-guarded CRUD under `/admin/:resource`, boot-time def validation, allow-listed list-query engine, and the role-filtered `GET /admin/meta/resources` endpoint. |
| 10 — Admin frontend | Headless Refine wired into the existing Ant Design Pro app so a backend registration produces a menu item and working pages with zero frontend changes — see /decisions/phase-10-admin-integration/. |

## After the plan

Once Phase 10 closed, work continued as user-directed follow-ups, each logged in
the progress log with the same rigor:

- Admin role management — the registry applied to `admin_users` itself, with
  last-owner guards.
- A single admin login realm replacing the original dual-login design; the
  `admin_session` cookie now gates the whole admin shell.
- Env-tunable rate limits with trusted-proxy IP keying, sized for CGNAT-heavy mobile
  traffic.
- Public Google sign-in (`POST /auth/google`) with JWKS-verified ID tokens and
  auto-linking by verified email.
- The push notification system — see /decisions/push-notifications/.

## Why this matters to you

The conventions documented in /architecture/conventions/ were not extracted from the
code after the fact; the code was generated from them. When you extend the template,
the highest-leverage move is the one the build process itself used: find the exemplar
(the `posts` module, the `welcome-email` worker, the `example` client), copy its shape,
and let the existing tests and generators (/generators/module-generate/) keep you
inside the pattern.
