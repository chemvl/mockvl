# Quick Start — API Development

Get running, then learn the three recipes you'll use every day: adding a feature module, adding an admin resource, and adding a third-party client.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- Docker (for local PostgreSQL + Redis)
- A Google OAuth client (only needed for admin dashboard work — see `.env.example`)

## 1. Setup (first time)

```bash
git clone <repo> && cd <repo>
bun install
cp .env.example .env          # fill in secrets; defaults work for local dev
docker compose up -d           # starts PostgreSQL 16 + Redis 7
bun run db:migrate
```

## 2. Run

```bash
bun run dev                    # API on http://localhost:3000
```

For the admin dashboard (Phase 10), run the admin app alongside the API:

```bash
cd apps/admin && bun run dev   # Vite on http://localhost:8000
```

Make sure the API's `.env` has `ADMIN_URL=http://localhost:8000` (CORS origin + post-login redirect — the admin app's Vite port is 8000, not 5173). There is a single login: `/user/login` hands the browser to the API's Google OAuth flow, and the `admin_session` cookie gates the whole app (use the `ADMIN_SEED_OWNER_EMAIL` account for full CRUD).

Verify:

- `GET http://localhost:3000/api/health` → 200
- `GET http://localhost:3000/api/ready` → 200 (checks DB + Redis; a 503 names the failing dependency)
- API docs (Scalar UI): http://localhost:3000/api/docs
- Raw OpenAPI spec: http://localhost:3000/api/openapi.json

Other daily commands:

```bash
bun run typecheck              # tsc, no emit
bun run lint                   # Biome
bun test                       # all tests
bun run db:generate            # generate migration from schema changes
bun run db:migrate             # apply migrations
bun run db:studio              # browse DB (Drizzle Studio)
bun run worker                 # run pg-boss workers only (separate process)
```

## 3. How a request flows

```
HTTP → middleware (request-id, logger, rate-limit, auth)
     → route   (Zod validation via @hono/zod-openapi — HTTP concerns only)
     → service (business logic — throws AppError subclasses, no Hono imports)
     → repo    (Drizzle queries only)
```

Responses always use the standard envelopes:

- Single: `{ "data": { ... } }`
- List: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`
- Error: `{ "error": { "code", "message", "details?", "requestId" } }`

List endpoints share one query contract: `?page=1&pageSize=20&sort=createdAt:desc&filter[status]=published&filter[title][like]=hello` (operators: `eq` default, `like`, `in`, `gte`, `lte`; `pageSize` max 100).

### Rate limiting: sizing for your traffic

Two per-IP tiers (Redis-backed, shared across instances), tuned via env — no code change needed:

| Env key | Default | Applies to |
|---|---|---|
| `RATE_LIMIT_GLOBAL_LIMIT` / `RATE_LIMIT_GLOBAL_WINDOW_MS` | 100 / 60000 | everything (health/ready exempt) |
| `RATE_LIMIT_AUTH_LIMIT` / `RATE_LIMIT_AUTH_WINDOW_MS` | 10 / 60000 | `/auth/*`, `/admin/auth/*` (`/me` exempt) |
| `TRUST_PROXY` | false | which IP source keys the counters |

Set `TRUST_PROXY=true` when a reverse proxy you control (nginx ingress, LB) fronts the API — the client IP then comes from `x-real-ip` or the rightmost `x-forwarded-for` hop. Leave it `false` when exposed directly: forwarded headers are client-forgeable and get ignored.

The limits are **per IP**, and behind carrier-grade NAT (common on mobile networks) one address can carry hundreds of real users. Size the global tier as a flood backstop, not a fairness control: `max users per IP × requests per user per minute × 2` (e.g. high-CGNAT consumer traffic often needs 2000+/min). Watch 429 rates and hot keys (`redis-cli --scan --pattern 'rl:global:*'`) after deploying and adjust.

## 4. Recipe: add a feature module (e.g. `comments`)

1. **Schema (shared):** `packages/schemas/src/comments.ts` — Zod schemas (`CommentSchema`, `CommentCreateSchema`, `CommentUpdateSchema`) + `fields` metadata in the same file.
2. **Table:** `apps/api/src/db/schema/comments.ts` (export from the barrel), then `bun run db:generate && bun run db:migrate`.
3. **Module:** create `apps/api/src/modules/comments/`:
   - `comments.repo.ts` — `createCommentsRepo(db)` factory, Drizzle only
   - `comments.service.ts` — `createCommentsService({ repo })`, business rules, throw `NotFoundError` etc.
   - `comments.routes.ts` — `createRoute()` definitions using the shared Zod schemas
4. **Mount** the router in `app.ts`.
5. **Test:** unit-test the service with a mocked repo; e2e via `app.request()`.

The route appears in `/docs` automatically — the OpenAPI spec is derived from the same Zod schemas that validate at runtime.

## 5. Recipe: add an admin resource (dashboard CRUD in 3 steps)

Given a Drizzle table, `bun run schemas:generate <model>` scaffolds steps 2–3
for you: the `packages/schemas` file (Zod schemas + fields, relations included),
its barrel export, **and** the resource def below — a
`resources/<name>.resource.ts` file wired into the `resources.ts` index (with a
placeholder icon and full-CRUD default permissions, each marked
`TODO(generator)` for review). The manual version, for hand-written schemas or
custom defs:

```ts
// apps/api/src/admin/registry/resources/comments.resource.ts
import { CommentCreateSchema, CommentSchema, CommentUpdateSchema, commentFields } from "@starter/schemas";
import { comments } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

export const commentsResource: AdminResourceDef = {
  name: "comments",
  label: "Comments",
  icon: "CommentOutlined",
  table: comments,
  schema: { create: CommentCreateSchema, update: CommentUpdateSchema, output: CommentSchema },
  fields: commentFields,          // from packages/schemas — drives table columns + form widgets
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
};
```

```ts
// apps/api/src/admin/registry/resources.ts — inside createDefaultAdminRegistry()
registry.register(commentsResource);   // + the import at the top
```

That single call gives you:

- `GET/POST /admin/comments`, `GET/PATCH/DELETE /admin/comments/:id` — each guarded by `requireAdmin(<permission>)`, documented in `/docs`, following the list query contract (`page`, `pageSize` ≤ 100, `sort=field:dir`, `filter[field][op]=value` with `eq|like|in|gte|lte`)
- An entry in `GET /admin/meta/resources` (filtered to what the caller's role can list)
- **On the dashboard:** a new sidebar menu item, list page (paginate/sort/filter/search), and create/edit forms — restart the API and refresh the admin; the menu item and pages appear with zero frontend changes

Things the def controls:

- **Field flags are the allow-list.** Sorting is only accepted on `sortable` fields, `filter[…][like]` only on `searchable` fields, other ops only on `filterable` fields — anything else is a 400. `id` is always filterable with `eq`/`in` (Refine's `getMany`).
- **The output schema is the wire contract.** Rows are serialized through `schema.output`, so columns you don't declare (hashes, internal flags) can never leak.
- **Omit a permission to disable the action.** No `create`/`update`/`delete` → the route is never mounted (404) and the dashboard hides the buttons — that's how `users` ships read-only.
- **Custom behavior** goes in `hooks` (`beforeCreate` transforms input, `afterUpdate` observes the row, …) — this is also where you call `invalidate("cache:query:comments:*")` if you cache that resource's reads — or build a bespoke page in `apps/admin` and point the resource at it.

Dashboard limits worth knowing: list rows show relation fields as raw ids (no join in the generic engine), and the search box is single-field `like` (the API ANDs flat filters, so multi-field OR search is not expressible — with several `searchable` fields the UI shows a field picker).

The three registered examples show the pattern's range: `posts` (full CRUD), `users` (read-only — no mutating permissions), and `admins` (admin role management: owner-only `list`/`update`/`delete`, **no** `create` since admins only enter via the Google-login upsert, an update schema limited to `role`, and `before*` hooks as guards — demoting or deleting the last owner is a 409, so an org can't lock itself out). `admins` is the worked example for hooks-as-guard: a `beforeUpdate`/`beforeDelete` hook can throw any `AppError` and the request gets the matching envelope.

## 6. Recipe: add a third-party API client (e.g. `acme`)

1. Add credentials to `config/env.ts` + `.env.example` (`ACME_BASE_URL`, `ACME_API_KEY`). Never read `process.env` directly.
2. Create `apps/api/src/clients/acme/`:
   - `types.ts` — `interface AcmeClient { ... }` + response types
   - `client.ts` — real implementation built on `createHttpClient()` from `clients/http.ts` (you get timeouts, retry with backoff on 429/5xx, and `UpstreamError` mapping for free)
   - `mock.ts` — `MockAcmeClient` implementing the same interface, for tests
3. Inject via the interface into services (factory param) — never import the concrete client in a service.

If the provider uses OAuth client-credentials, use the token-cache utility in `clients/http.ts` (caches the access token in memory, refreshes before expiry).

Rules: never log credentials or raw provider headers; map every provider failure to `UpstreamError` so provider quirks don't leak past the client.

## 7. Background jobs

```ts
await enqueue("welcome-email", { userId });   // from any service
```

Handlers live in `apps/api/src/jobs/workers/`. In dev they run in-process with `bun run dev`; in production run `bun run worker` as a separate container (same image, different command). Jobs get retries with backoff via pg-boss — no Redis involved.

## 8. Recipe: cache a read + coordination primitives (Redis)

**Cache-aside** — wrap any expensive read with `cached()` from `lib/cache.ts`; invalidate from the *service* that mutates the data (never from routes or repos):

```ts
import { cached, invalidate } from "@/lib/cache";
import { env } from "@/config/env";

// In a service or client: key convention is cache:<area>:<name>:<discriminator>
const post = await cached(`cache:query:posts:byId:${id}`, env.CACHE_DEFAULT_TTL_S, () =>
  postsRepo.findById(id),
);

// In the mutation method of the same service, after the write commits:
await invalidate(`cache:query:posts:byId:${id}`, "cache:query:posts:list:*"); // exact + SCAN pattern
```

The cache fails open: if Redis is down the read runs against its origin and a `CACHE_READ_FAILED` warn is logged — never handle cache errors at call sites. Concurrent callers of one key share a single fetch in-process; pass `{ lock: true }` as the fourth argument for cross-process fill dedup (off by default). Worked example: the mock runtime's route resolver (`apps/api/src/modules/mock-runtime/route-resolver.ts`) caches each published mock under `cache:mocks:route:<ws>/<slug>` (misses included), and `mocks.service.ts` invalidates those keys on every management mutation.

**L1 micro-cache + stale-while-revalidate** — two layers on top of the Redis tier, both in `lib/cache.ts`:

- **L1**: every `createCache` instance keeps an in-process promise map. Concurrent callers of one key always share one fetch, and a *settled* result keeps serving for `l1TtlMs` (default 200 ms) — so a burst of identical reads costs ~one Redis round-trip per 200 ms per process, and keeps absorbing bursts even while Redis is down. Treat cached values as **frozen**: L1 hits hand the same object reference to every caller — never mutate a row you got from a cached read.
- **SWR** (`{ swr: true }`): entries carry a logical expiry (`staleAt`) and live physically for 2× the TTL. A read past `staleAt` returns the stale value immediately and refreshes in the background under a cross-process lock — users never pay origin latency on a warm key, and the origin sees at most ~1 refresh per key per TTL *cluster-wide*. Effective staleness budget: `ttlS + l1TtlMs` (+ up to 2×`ttlS` if the origin is failing — stale keeps being served until physical expiry). Don't mix `swr: true` and plain reads on one key.

**Distributed lock** — one worker at a time across every instance; contested callers get a 409:

```ts
import { withLock } from "@/lib/primitives";

await withLock(`billing:invoice:${invoiceId}`, 30_000, async () => {
  // critical section — lock auto-expires after ttlMs if this crashes
});
// throws ConflictError("LOCKED") if someone else holds it — map/retry in the caller
```

**Idempotency** — run once per key, replay the stored result on retries (webhooks, payments):

```ts
import { idempotent } from "@/lib/primitives";

const receipt = await idempotent(`webhook:${eventId}`, 24 * 60 * 60, () =>
  processPayment(event),
); // duplicate while running → 409; retry after a failure → runs again
```

Unlike the cache, both primitives **fail closed**: if Redis is unreachable the operation is rejected instead of running unguarded. Results must be plain JSON data.

## 9. Auth cheat sheet

**App users (JWT):** `POST /auth/google` (client-obtained Google ID token) or `POST /auth/google/code` (GIS popup code; send `X-Requested-With: XMLHttpRequest`) signs in — matching by Google account, auto-linking by verified email, or creating a password-less account — and returns an access token (15 min) + refresh token (single-use, rotates on `POST /auth/refresh`; revoke with `POST /auth/logout`). `APP_GOOGLE_ALLOWED_HD` optionally restricts the domain. Send `Authorization: Bearer <access>`. Protect routes with `authMiddleware`; read the user via `c.var.userId`.

**Admins (Google, org-restricted):** browse to `/admin/auth/google` → sign in with a `GOOGLE_ALLOWED_HD` account → the `admin_session` cookie is set (httpOnly, 7-day sliding). All `/admin/*` routes require it; roles are `viewer < editor < owner`. Check who you are: `GET /admin/auth/me`. Mutating `/admin/*` requests must also send `X-Requested-With: XMLHttpRequest` (CSRF check). First owner: set `ADMIN_SEED_OWNER_EMAIL` in `.env` before that person's first login; everyone else starts as `viewer`. Protect routes with `requireAdmin(minRole)`; read the admin via `c.var.adminUser`.

**Role management:** owners change roles at **Admins** in the dashboard (`PATCH /admin/admins/:id`, role is the only editable field). Changes apply on the target's next request — sessions read the role fresh from the DB. The last owner can't be demoted or deleted (409). Deleting an admin kills their sessions but is *reset, not ban*: a Google re-login recreates them as `viewer`.

## 10. Testing

- **Unit:** services with mocked repos/clients — fast, no infra.
- **Integration:** repos against the compose Postgres (separate test database).
- **E2E:** full app via `await app.request("/auth/refresh", { ... })` — no server needed.

Run everything with `bun test`. CI runs typecheck → lint → tests → docker build on every push.

## 11. Troubleshooting

- `/ready` returns 503 → Postgres or Redis isn't up; the envelope's `details` names which. `docker compose up -d`, check `docker compose ps`.
- Redis down but traffic still flowing → that's by design: rate limiting fails open (logs `RATE_LIMIT_STORE_DOWN`) unless `RATE_LIMIT_FAIL_OPEN=false`. Reads must always fall through to their origin.
- Boot crash listing env vars → copy new keys from `.env.example` into `.env`.
- 429 during dev on `/auth/*` → rate limiter; wait a minute or raise `RATE_LIMIT_AUTH_LIMIT` in `.env` locally.
- Admin login loops → your Google account's domain doesn't match `GOOGLE_ALLOWED_HD`, or the cookie is blocked (use the proxied same-origin setup, or check CORS `credentials` config when running Vite on a separate port).
- Schema change not reflected → you edited the table but didn't run `bun run db:generate && bun run db:migrate`.

## 12. Where things live

| I want to… | Look in |
|---|---|
| Change validation / API shapes | `packages/schemas` |
| Add business rules | `modules/<feature>/<feature>.service.ts` |
| Touch the DB | `db/schema` + `modules/<feature>/<feature>.repo.ts` |
| Add admin CRUD | `admin/registry/resources/<name>.resource.ts` + register in `resources.ts` |
| Call an external API | `clients/` |
| Add async work | `jobs/workers/` |
| Cache a read / invalidate | `lib/cache.ts` (`cached`, `invalidate`) |
| Lock or dedupe an operation | `lib/primitives.ts` (`withLock`, `idempotent`) |
| Global behavior (errors, logging, limits) | `app.ts`, `middleware/`, `lib/` |