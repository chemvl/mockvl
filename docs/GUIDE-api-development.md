# Guide: Writing app-facing API endpoints (backend → frontend)

This is a step-by-step tutorial for junior developers. You will learn how to
build API endpoints that a frontend (web or mobile app) can call, handle, and
display — the hand-written kind, not the auto-generated admin CRUD.

It has two main sections:

1. **Endpoints backed by the local database** — worked example: building a
   public `GET /posts` list + `GET /posts/:id` (not shipped — this codebase has
   no public posts routes), plus one JWT-protected route.
2. **Config & third-party endpoints** — how to call an external provider
   safely and expose its data through your own API.

Plus a short closing section on **how the frontend consumes** what you built.

**Before you start**, make sure the project runs (see `QUICKSTART.md` §1–2):

```bash
docker compose up -d      # Postgres + Redis
bun install
bun run db:migrate
bun run dev               # API on http://localhost:3000
```

> **Related guide:** if what you actually want is a CRUD screen in the admin
> dashboard, stop here and read `GUIDE-posts-with-categories.md` instead — the
> registry generates all of that for you. This guide is for everything else.

---

## The mental model (read this first)

### Two route families

| | `modules/*` (this guide) | `admin/registry` (other guide) |
|---|---|---|
| Who calls it | Your app frontend (web/mobile) | The Refine admin dashboard |
| How it's built | Hand-written routes → service → repo | One `registry.register(def)` call |
| Auth | Public, or JWT bearer (`authMiddleware`) | Admin session cookie + roles |
| Shape | Whatever your product needs | Generic CRUD, one shape for all |

Use a module when the endpoint has *product* semantics: "list published posts",
"my orders", "search". Use the registry when the endpoint is "let an admin edit
rows in this table".

### How a request flows (QUICKSTART §3)

```
HTTP → middleware (request-id, logger, secure headers, CORS, rate-limit,
       json-only, body-limit — all global, you get them for free)
     → route   (Zod validation via @hono/zod-openapi — HTTP concerns only)
     → service (business logic — throws AppError subclasses, no Hono imports)
     → repo    (Drizzle queries only)
```

Everything is served under the base path from `env.API_BASE_PATH` (default
`/api`). Route files never write `/api` — `app.ts` adds it once via
`.basePath()`. So `path: "/posts"` in code is `GET /api/posts` on the wire.

### The three envelopes — the whole frontend contract

Every endpoint in this repo responds in exactly one of three shapes
(PLAN §4.1, helpers in `packages/schemas/src/common.ts`):

```jsonc
{ "data": { ... } }                                          // single resource
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 137 } } // list
{ "error": { "code": "NOT_FOUND", "message": "...", "details": {}, "requestId": "..." } }
```

The frontend can rely on this: success always has `data`, failure always has
`error.code` (machine-readable) and `error.requestId` (paste it in a bug
report; it matches the server logs). You never build these by hand — routes
return `c.json({ data: ... })` and the global `app.onError` builds every error
envelope from thrown `AppError`s.

### The layering rule (PLAN §4.4)

| Layer | File | Allowed to | Never |
|---|---|---|---|
| Route | `<name>.routes.ts` | Validate, call service, serialize | Business logic, DB access |
| Service | `<name>.service.ts` | Business rules, throw `AppError`s | Import Hono, touch Drizzle |
| Repo | `<name>.repo.ts` | Drizzle queries | Throw domain errors, know HTTP |

Each layer is a **factory function** taking deps as params
(`createPostsService({ postsRepo })`) — that's the whole DI story, and it's
what makes unit tests trivial (pass a fake object).

---

## Section 1 — Endpoints backed by the local database

Worked example: a public posts API on the existing `posts` table.

- `GET /api/posts` — published posts only, with pagination / sort / filter
- `GET /api/posts/:id` — one published post, 404 otherwise
- `GET /api/posts/mine` — **JWT-protected**: the caller's own posts (drafts too)

> Posts currently exist only as an admin resource (`/api/admin/posts`, session
> cookie + role required). Nothing public serves them — that's the gap this
> section fills, and the pattern for every future module.

> **Shortcut:** everything in Steps 1–7 can be scaffolded in one command —
> `bun run module:generate <model> [--protected] [--force]` — which writes the
> repo/service/routes files, the public allow-list, both test files, and the
> wiring, ready to serve immediately. This section explains what that generator
> writes and why; read it before shipping generated code, then resolve the
> `TODO(generator)` comments (visibility rules, allow-list trimming).

### Step 1 — Decide the wire contract (schemas)

The output schema already exists: `PostSchema` in `packages/schemas/src/post.ts`
(dates as ISO strings, registered as the `Post` OpenAPI component). Reuse it.

What we add is a **public query allow-list**. The admin `postFields` metadata
allows filtering by author, status, etc. — right for admins, too much surface
for an anonymous endpoint. Public list endpoints should declare their own,
smaller allow-list. Add to `packages/schemas/src/post.ts` (metadata lives next
to the schema — repo rule):

```ts
// What the PUBLIC list endpoint accepts. Deliberately smaller than postFields:
// status is forced to "published" by the service, so it is not filterable here.
export const publicPostFields: ResourceField[] = [
  { name: "title", type: "string", label: "Title", searchable: true },
  {
    name: "categoryId",
    type: "relation",
    label: "Category",
    resource: "categories",
    displayField: "name",
    filterable: true,
  },
  { name: "createdAt", type: "date", label: "Created", sortable: true },
];
```

These flags are enforced by `parseListQuery` (`apps/api/src/lib/pagination.ts`),
the same parser the admin engine uses: `searchable` → `filter[title][like]=...`
allowed, `filterable` → `eq/in/gte/lte` allowed, `sortable` → `sort=field:dir`
allowed. Anything undeclared is a 400 at the boundary — never a Postgres error,
and columns you didn't list are unreachable no matter what the URL says.

> **Narrowing the output:** if the public shape should hide fields the admin
> sees (internal flags, cost prices...), don't reuse the admin schema — derive
> one: `export const PublicPostSchema = PostSchema.omit({ ... }).openapi("PublicPost")`.
> The output schema is the wire contract; what's not in it can't leak. For
> posts the shapes coincide, so we reuse `PostSchema` as-is.

### Step 2 — Repo (Drizzle only)

Create `apps/api/src/modules/posts/posts.repo.ts`. The repo translates the
normalized `ListQuery` (which `parseListQuery` produces at the route boundary)
into Drizzle conditions — for exactly the columns the public API exposes:

```ts
import { and, asc, desc, eq, gte, ilike, inArray, lte, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { type PostRow, posts } from "@/db/schema";
import type { ListFilter, ListQuery } from "@/lib/pagination";

// The repo-side mirror of publicPostFields: only these columns are reachable
// from the public query contract. parseListQuery already allow-listed the
// request, so a miss here means the two lists drifted — fail loudly.
const columns: Record<string, PgColumn> = {
  title: posts.title,
  categoryId: posts.categoryId,
  createdAt: posts.createdAt,
};

function column(field: string): PgColumn {
  const col = columns[field];
  if (!col) throw new Error(`Column not exposed to the public posts API: ${field}`);
  return col;
}

// ILIKE's %/_ are wildcards; filter values are data, so escape them.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Filter values arrive as validated strings; timestamp columns are the one
// case Drizzle won't coerce itself (see admin/registry/crud.repo.ts).
function driverValue(col: PgColumn, value: string): string | Date {
  return col.dataType === "date" ? new Date(value) : value;
}

function toCondition(filter: ListFilter) {
  const col = column(filter.field);
  switch (filter.op) {
    case "eq":
      return eq(col, driverValue(col, filter.value as string));
    case "like":
      return ilike(col, `%${escapeLike(filter.value as string)}%`);
    case "in":
      return inArray(col, (filter.value as string[]).map((v) => driverValue(col, v)));
    case "gte":
      return gte(col, driverValue(col, filter.value as string));
    case "lte":
      return lte(col, driverValue(col, filter.value as string));
  }
}

export function createPostsRepo(db: Db) {
  // Shared list machinery: WHERE + stable ORDER BY + LIMIT/OFFSET + COUNT.
  async function list(base: SQL | undefined, query: ListQuery) {
    const where = and(
      ...(base ? [base] : []),
      ...query.filters.map((filter) => toCondition(filter)),
    );
    // Trailing id tiebreaker keeps pagination stable when the requested sort
    // has duplicate values (or no sort was requested at all).
    const orderBy = [
      ...query.sort.map((s) => (s.dir === "desc" ? desc(column(s.field)) : asc(column(s.field)))),
      asc(posts.id),
    ];

    const rows = await db
      .select()
      .from(posts)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [counted] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(posts)
      .where(where);

    return { rows, total: counted?.total ?? 0 };
  }

  return {
    listPublished(query: ListQuery): Promise<{ rows: PostRow[]; total: number }> {
      return list(eq(posts.status, "published"), query);
    },

    listByAuthor(authorId: string, query: ListQuery) {
      return list(eq(posts.authorId, authorId), query);
    },

    async findPublishedById(id: string): Promise<PostRow | undefined> {
      const [row] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), eq(posts.status, "published")))
        .limit(1);
      return row;
    },
  };
}

export type PostsRepo = ReturnType<typeof createPostsRepo>;
```

Two things worth copying everywhere:

- **The "published only" constraint lives in the repo method name**, not
  sprinkled through callers. `findPublishedById` cannot return a draft — a 404
  for a draft id is guaranteed by construction, and the list/detail endpoints
  can never disagree.
- **`count(*)::int`** — postgres.js returns bigint counts as strings; the cast
  keeps `total` a number (same idiom as `admin/registry/crud.repo.ts`).

### Step 3 — Service (business logic, no Hono)

Create `apps/api/src/modules/posts/posts.service.ts`:

```ts
import { NotFoundError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import type { PostsRepo } from "./posts.repo";

export interface PostsServiceDeps {
  postsRepo: PostsRepo;
}

export function createPostsService(deps: PostsServiceDeps) {
  const { postsRepo } = deps;

  return {
    async listPublished(query: ListQuery) {
      return postsRepo.listPublished(query);
    },

    async getPublishedById(id: string) {
      const post = await postsRepo.findPublishedById(id);
      // Drafts and nonexistent ids look identical from outside — a public
      // caller must not be able to probe which unpublished ids exist.
      if (!post) throw new NotFoundError("Post not found");
      return post;
    },

    async listMine(authorId: string, query: ListQuery) {
      return postsRepo.listByAuthor(authorId, query);
    },
  };
}

export type PostsService = ReturnType<typeof createPostsService>;
```

The service throws `AppError` subclasses from `apps/api/src/lib/errors.ts`
(`NotFoundError` → 404, `ConflictError` → 409, ...) and never touches HTTP.
The global `app.onError` turns each into the matching error envelope. There is
no try/catch in routes and no status codes in services — that's the point.

### Step 4 — Routes (HTTP only)

Create `apps/api/src/modules/posts/posts.routes.ts`. Three route definitions
plus the factory that wires them to the service:

```ts
import { createRoute, z } from "@hono/zod-openapi";
import { envelope, listEnvelope, type Post, PostSchema, publicPostFields } from "@starter/schemas";
import type { PostRow } from "@/db/schema";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import { parseListQuery } from "@/lib/pagination";
import { authMiddleware } from "@/middleware/auth";
import type { PostsService } from "./posts.service";

const IdParamsSchema = z.object({ id: z.uuid() });

// Documents the list convention for OpenAPI. filter[field][op] keys can't be
// a static Zod shape, so real validation lives in parseListQuery (which also
// allow-lists fields); this schema is deliberately permissive.
const ListQueryDocSchema = z.object({
  page: z.string().optional().openapi({ example: "1" }),
  pageSize: z.string().optional().openapi({ example: "20", description: "Max 100" }),
  sort: z.string().optional().openapi({ example: "createdAt:desc" }),
});

// Dates cross the wire as ISO strings. Mapping explicitly (instead of relying
// on JSON.stringify) keeps the handler return type aligned with PostSchema,
// so drift is a compile error (see lib/serialize.ts for the house pattern).
function serializePost(row: PostRow): Post {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    content: row.content,
    coverImageUrl: row.coverImageUrl,
    categoryId: row.categoryId,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listPostsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["posts"],
  summary: "List published posts",
  description:
    "Public list. Query convention: `page`, `pageSize` (max 100), `sort=createdAt:desc`, " +
    "`filter[categoryId]=<uuid>`, `filter[title][like]=hello`.",
  request: { query: ListQueryDocSchema },
  responses: {
    200: jsonContent(listEnvelope(PostSchema), "A page of published posts"),
    400: errorResponse("Invalid list query"),
  },
});

const myPostsRoute = createRoute({
  method: "get",
  path: "/mine",
  tags: ["posts"],
  summary: "List my posts (drafts included)",
  security: [{ bearerAuth: [] }],
  middleware: [authMiddleware()] as const,
  request: { query: ListQueryDocSchema },
  responses: {
    200: jsonContent(listEnvelope(PostSchema), "A page of the caller's posts"),
    400: errorResponse("Invalid list query"),
    401: errorResponse("Missing, invalid, or expired access token"),
  },
});

const getPostRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["posts"],
  summary: "Get one published post",
  request: { params: IdParamsSchema },
  responses: {
    200: jsonContent(envelope(PostSchema), "The post"),
    400: errorResponse("Invalid id"),
    404: errorResponse("No published post with that id"),
  },
});

export function createPostsRoutes(service: PostsService) {
  const router = createRouter();

  router.openapi(listPostsRoute, async (c) => {
    const query = parseListQuery(c.req.query(), publicPostFields);
    const { rows, total } = await service.listPublished(query);
    return c.json(
      {
        data: rows.map(serializePost),
        meta: { page: query.page, pageSize: query.pageSize, total },
      },
      200,
    );
  });

  // Registered BEFORE /{id}: Hono matches in registration order, and "/mine"
  // would otherwise be captured by /{id} and die on uuid validation.
  router.openapi(myPostsRoute, async (c) => {
    const query = parseListQuery(c.req.query(), publicPostFields);
    const { rows, total } = await service.listMine(c.get("userId"), query);
    return c.json(
      {
        data: rows.map(serializePost),
        meta: { page: query.page, pageSize: query.pageSize, total },
      },
      200,
    );
  });

  router.openapi(getPostRoute, async (c) => {
    const post = await service.getPublishedById(c.req.valid("param").id);
    return c.json({ data: serializePost(post) }, 200);
  });

  return router;
}
```

How to read this file:

- `createRouter()` (from `apps/api/src/lib/openapi.ts`) gives every router the
  shared `defaultHook`: any Zod validation failure anywhere becomes the same
  400 `VALIDATION_ERROR` envelope with flattened field details.
- **Auth is opt-in per route** here via the `middleware:` option (the pattern
  `admin/registry/crud.routes.ts` uses). When a *whole* router is protected,
  do `router.use(authMiddleware())` once instead — that's what
  `modules/users/users.routes.ts` does. After the middleware runs,
  `c.get("userId")` is the verified JWT subject.
- `security: [{ bearerAuth: [] }]` is documentation only — it makes Scalar
  show the lock icon and the Authorize box. The `middleware` entry is what
  actually enforces it. Always set both.
- Validated inputs come from `c.req.valid("param")` / `c.req.valid("json")` —
  never `c.req.param()` / `await c.req.json()` in an `openapi()` handler.
- **Route order matters**: static paths (`/mine`) before parameterized ones
  (`/{id}`).

### Step 5 — Mount it in `app.ts`

Three small edits in `apps/api/src/app.ts`, following the existing
`usersService` precedent exactly:

```ts
// 1. Imports
import { createPostsRepo } from "./modules/posts/posts.repo";
import { createPostsRoutes } from "./modules/posts/posts.routes";
import { createPostsService, type PostsService } from "./modules/posts/posts.service";

// 2. Test-injection seam: add to CreateAppOptions...
export interface CreateAppOptions {
  // ...existing options...
  postsService?: PostsService;
}

// ...build the default in createDefaultServices() alongside the others...
    postsService: createPostsService({ postsRepo: createPostsRepo(db) }),
// ...and resolve it in resolveServices() like authService/usersService.

// 3. Mount, next to the existing app.route() calls:
app.route("/posts", createPostsRoutes(postsService));
```

That's the entire integration. The base path makes it `GET /api/posts`, the
global middleware stack (rate limit, CORS, body limit, logging) applies
automatically, and the OpenAPI spec picks up the routes because they were
defined with `createRoute()`.

> **Why the options seam matters:** e2e tests build the app with
> `createApp({ postsService: createPostsService({ postsRepo: createPostsRepo(testDb) }) })`
> against a test database, and unit-ish route tests can inject a fully fake
> service. Skipping the seam means every test drags the real pool in.

### Step 6 — Verify by hand

Restart `bun run dev`, then:

- Open http://localhost:3000/api/docs — a **posts** tag appears with the three
  routes; `/posts/mine` shows the bearer lock.
- Exercise the behavior (create a published post via the admin dashboard or
  `POST /api/admin/posts` first, so the list has data):

```bash
# List: envelope + meta
curl -s "http://localhost:3000/api/posts?page=1&pageSize=10&sort=createdAt:desc"
# → { "data": [ ... ], "meta": { "page": 1, "pageSize": 10, "total": 3 } }

# Filter by category (declared filterable → allowed)
curl -s "http://localhost:3000/api/posts?filter[categoryId]=<category-uuid>"

# Search titles (declared searchable → like allowed)
curl -s "http://localhost:3000/api/posts?filter[title][like]=hello"

# One post / a draft or unknown id
curl -s http://localhost:3000/api/posts/<post-uuid>          # → { "data": { ... } }
curl -s http://localhost:3000/api/posts/<draft-uuid>         # → 404 envelope

# Protected route without / with a token (sign-in flow: QUICKSTART §9)
curl -s http://localhost:3000/api/posts/mine                  # → 401 envelope
curl -s http://localhost:3000/api/posts/mine \
  -H "Authorization: Bearer <accessToken from POST /api/auth/google>"
```

And the failure shapes that prove the guards work:

```bash
# title is searchable but NOT sortable in publicPostFields
curl -s "http://localhost:3000/api/posts?sort=title:asc"
# → 400 { "error": { "code": "VALIDATION_ERROR", "message": "Field is not sortable: title", ... } }

# authorId is not in the public allow-list at all
curl -s "http://localhost:3000/api/posts?filter[authorId]=..."
# → 400 "Field is not filterable: authorId"

# garbage uuid is caught at the boundary, not by Postgres
curl -s http://localhost:3000/api/posts/not-a-uuid            # → 400 VALIDATION_ERROR

# pageSize is capped
curl -s "http://localhost:3000/api/posts?pageSize=5000"       # → 400 "pageSize must be at most 100"
```

### Step 7 — Tests

Follow the two existing precedents:

**Unit — service with a fake repo** (pattern:
`apps/api/tests/unit/workspaces-service.test.ts`). No database, no HTTP:

```ts
// apps/api/tests/unit/posts-service.test.ts
import { describe, expect, test } from "bun:test";
import { NotFoundError } from "@/lib/errors";
import type { PostsRepo } from "@/modules/posts/posts.repo";
import { createPostsService } from "@/modules/posts/posts.service";

const fakeRepo: PostsRepo = {
  listPublished: async () => ({ rows: [], total: 0 }),
  listByAuthor: async () => ({ rows: [], total: 0 }),
  findPublishedById: async () => undefined,
};

describe("posts service", () => {
  test("getPublishedById throws NotFoundError for unknown/draft ids", async () => {
    const service = createPostsService({ postsRepo: fakeRepo });
    await expect(service.getPublishedById(crypto.randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
```

**E2E — the full app over a test database** (pattern:
`apps/api/tests/e2e/auth-e2e.test.ts`): call `prepareTestDatabase()`, build
`createApp({ postsService: ..., rateLimit: { ...relaxed... } })`, seed a
published post and a draft with Drizzle, then assert through the HTTP surface:

```ts
const res = await app.request("/api/posts?filter[title][like]=seeded");
expect(res.status).toBe(200);
const body = await res.json();
expect(body.meta.total).toBe(1);            // the draft is invisible

const draft = await app.request(`/api/posts/${draftId}`);
expect(draft.status).toBe(404);             // and unprobeable
```

Note the paths in e2e tests **include `/api`** — `app.request()` goes through
the real base path. Run the gates before calling it done:

```bash
bun run typecheck && bun run lint && bun test apps/api
```

### Section 1 best practices — the checklist

- [ ] Output goes through a Zod schema from `packages/schemas` — undeclared
      fields can't leak; dates are ISO strings via an explicit serializer.
- [ ] List queries go through `parseListQuery` with a **public** allow-list —
      never interpolate query params into Drizzle conditions yourself.
- [ ] Visibility rules (published-only, owner-only) live in repo method
      semantics + service, never in the route.
- [ ] Services throw `AppError`s; routes have no try/catch and no status logic.
- [ ] 404 for "exists but you may not see it" — don't leak existence.
- [ ] New service is injectable through `CreateAppOptions`.
- [ ] Static routes registered before `/{id}` routes.

---

## Section 2 — Config & third-party endpoints

The repo ships the generic transport every provider client builds on —
`apps/api/src/clients/http.ts` (timeouts, retries, `UpstreamError` mapping),
`apps/api/src/clients/token-cache.ts` (OAuth client-credentials tokens), and
`apps/api/src/lib/cache.ts` (`cached()`) — but no provider integration of its
own besides FCM push. This section walks you through building one on top, file
by file, using a hypothetical provider **`acme`** that serves **widgets**, and
ends with the last mile: exposing provider data through your own endpoint.
Every `acme`/`widgets` file below is code *you* write; substitute your
provider's name.

The stack you'll end up with, top to bottom:

```
your route            modules/widgets/widgets.routes.ts   (you write this)
  → service           modules/widgets/widgets.service.ts  (domain errors)
    → provider iface  clients/acme/types.ts               (what services see)
      → real client   clients/acme/client.ts              (auth, zod, cache)
        → transport   clients/http.ts                     (ships: timeout, retry, 502)
```

**The golden rule: the frontend never calls the third party directly.** Your
API is the proxy. That keeps credentials server-side, dodges CORS, and gives
you one place for retries, caching, and rate limiting.

### Step 1 — Credentials in `config/env.ts` (never `process.env`)

Add your provider's keys to the Zod schema in `apps/api/src/config/env.ts`:

```ts
ACME_BASE_URL: z.url(),
ACME_API_KEY: z.string().min(1),
```

...and to the root `.env.example` (placeholder values only — never real keys).
Env is parsed once at import: a missing key crashes at **boot** with a readable
list, not at the first request three days into production. Everything reads
`env.X` from `@/config/env`; `process.env` anywhere else fails review.

### Step 2 — Wire types + provider interface (`types.ts`)

Create `apps/api/src/clients/acme/types.ts` to own what the provider's API
returns:

```ts
export const WidgetSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "archived"]),
});

export type Widget = z.infer<typeof WidgetSchema>;

export interface AcmeClient {
  getWidget(id: string): Promise<Widget>;
}
```

Services depend on the **interface**, never on the HTTP layer underneath it.
That single line of indirection is what makes every consumer testable without
network access, and lets you swap providers without touching business logic.

### Step 3 — The real client (`client.ts`), built on `createHttpClient`

`apps/api/src/clients/http.ts` is the transport every provider client builds
on. What it gives you for free:

| Concern | Behavior |
|---|---|
| Timeout | Per-attempt `AbortController`, default 10s — covers body reads too |
| Retries | Default 2 extra attempts, **only** on 429 / 5xx / network / timeout — never other 4xx |
| Backoff | Exponential + jitter (`250ms · 2^attempt + jitter`) |
| Errors | Everything maps to `UpstreamError` → your API's **502** envelope |
| Credential safety | Request headers/bodies never appear in errors or logs; a path that resolves off `baseUrl`'s origin is rejected (your API key can't be redirected to another host) |

Your provider client (`apps/api/src/clients/acme/client.ts`) adds three
things on top — auth, validation, caching:

```ts
export function createAcmeClient(options: AcmeClientOptions = {}) {
  const {
    baseUrl = env.ACME_BASE_URL,                  // env defaults → prod wiring
    apiKey = env.ACME_API_KEY,                    // is a zero-arg call
    fetchFn,
    cachedFn = cached,
    cacheTtlS = env.CACHE_DEFAULT_TTL_S,
  } = options;

  const http = createHttpClient({
    name: "acme",                                 // shows up in UpstreamError
    baseUrl,
    headers: { authorization: `Bearer ${apiKey}` },
    ...(fetchFn ? { fetchFn } : {}),
  });

  function parseWidget(payload: unknown): Widget {
    const result = WidgetSchema.safeParse(payload);
    if (!result.success) {
      // A schema mismatch is the PROVIDER's contract breaking, not our
      // caller's input — surface it as an upstream failure. Only zod issue
      // paths (field names, never payload values) are included.
      throw new UpstreamError("acme: unexpected response shape", {
        provider: "acme",
        issues: result.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    return result.data;
  }

  const client: AcmeClient = {
    async getWidget(id: string): Promise<Widget> {
      return cachedFn(`cache:upstream:acme:widget:${id}`, cacheTtlS, async () => {
        const payload = await http.json(`/widgets/${encodeURIComponent(id)}`);
        return parseWidget(payload);
      });
    },
  };
  return client;
}
```

Rules encoded here that you must keep in your own clients:

- **Validate every upstream payload with Zod.** `http.json()` returns
  `unknown` on purpose. Never trust external data (a provider "upgrade" that
  changes a field becomes a clean 502 with field paths, not `undefined`
  spreading through your services).
- **`encodeURIComponent` any caller-supplied path segment.**
- **Never put payload values, headers, or the key in an error** — provider
  name, status, and field paths only.
- **Make every dependency injectable** (`fetchFn`, `cachedFn`, credentials)
  with env-backed defaults, so production wiring is a zero-arg call and tests
  need no network or Redis.

> **OAuth providers:** if the provider issues short-lived client-credentials
> tokens instead of a static key, wrap `createTokenCache({ fetchToken })` from
> `apps/api/src/clients/token-cache.ts` — it caches the token in memory until
> 30s before expiry, refreshes transparently, and single-flights concurrent
> refreshes. Resolve the `authorization` header per request from
> `getToken()` instead of a fixed `headers` entry.

### Step 4 — The mock (`mock.ts`)

Write `apps/api/src/clients/acme/mock.ts`: an in-memory `AcmeClient` (e.g.
`createMockAcmeClient({ widgets: [...] })`) seeded with fixtures. The
important detail: **an unknown id must throw the exact `UpstreamError` shape
the real client throws on an upstream 404** (`provider` + `status: 404` in the
details, so `getUpstreamStatus()` reads it) — that way service tests exercise
the same error path production hits. Every provider you add gets a mock
implementing the same interface; tests and local dev never touch the real API.
The FCM client follows the same idea: `clients/fcm/` pairs the real sender
with a log-only fallback, and tests use fakes of the same interface.

### Step 5 — Caching (already in the client above)

Third-party reads are the canonical `cached()` use case (QUICKSTART §8):

- Key convention: `cache:upstream:<provider>:<name>:<discriminator>`.
- TTL: `env.CACHE_DEFAULT_TTL_S` (default 300s) unless the data demands otherwise.
- **Failure stance: the cache fails open.** Redis down → the read runs against
  the provider and a `CACHE_READ_FAILED` warning is logged once. Never handle
  cache errors at call sites; `lib/cache.ts` already does.

### Step 6 — Service: translate provider failures into domain meaning

Create `apps/api/src/modules/widgets/widgets.service.ts`:

```ts
export function createWidgetsService(deps: WidgetsServiceDeps) {
  const { acmeClient } = deps;

  return {
    async getWidget(id: string): Promise<Widget> {
      try {
        return await acmeClient.getWidget(id);
      } catch (error) {
        if (getUpstreamStatus(error) === 404) {
          throw new NotFoundError("Widget not found");
        }
        throw error;
      }
    },
  };
}

export type WidgetsService = ReturnType<typeof createWidgetsService>;
```

This is the one place upstream statuses get domain meaning: *their* 404 is
*our* "this widget does not exist" (→ our 404 envelope). Everything else —
timeouts, 5xx, invalid payloads — stays `UpstreamError` and surfaces as our
502. `getUpstreamStatus()` (from `@/clients/http`) is the typed accessor; don't
dig into `error.details` by hand.

### Step 7 — The last mile: your proxy route

Create `apps/api/src/modules/widgets/widgets.routes.ts`. One deliberate
choice: define a **separate response schema** instead of reusing the
provider's `WidgetSchema` — your API contract should never be coupled to a
vendor's wire format (when they rename a field, you fix the client mapping,
not your public API):

```ts
import { createRoute, z } from "@hono/zod-openapi";
import { envelope } from "@starter/schemas";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import type { WidgetsService } from "./widgets.service";

// OUR wire shape for widgets — decoupled from the provider's WidgetSchema even
// though the fields currently coincide. (For a real feature, promote this to
// packages/schemas so the frontend shares the type.)
const WidgetResponseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["active", "archived"]),
  })
  .openapi("Widget");

const getWidgetRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["widgets"],
  summary: "Get a widget from the acme provider",
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: jsonContent(envelope(WidgetResponseSchema), "The widget"),
    404: errorResponse("No such widget upstream"),
    502: errorResponse("The acme provider failed or timed out"),
  },
});

export function createWidgetsRoutes(service: WidgetsService) {
  const router = createRouter();

  router.openapi(getWidgetRoute, async (c) => {
    const widget = await service.getWidget(c.req.valid("param").id);
    return c.json({ data: widget }, 200);
  });

  return router;
}
```

Then wire it like every other module — the three steps documented in
`apps/api/src/modules/index.ts` (service slot in `ModuleServices`, default
wiring in `app.defaults.ts`, one `app.route()` in `mountModules`):

```ts
// modules/index.ts — ModuleServices gains: widgetsService: WidgetsService;
// (CreateAppOptions inherits the injection slot via Partial<ModuleServices>.)

// app.defaults.ts — default wiring:
//   widgetsService: createWidgetsService({ acmeClient: createAcmeClient() })
// Tests inject: createWidgetsService({ acmeClient: createMockAcmeClient({ widgets: [...] }) })

// modules/index.ts — in mountModules:
app.route("/widgets", createWidgetsRoutes(services.widgetsService));
```

Now `GET /api/widgets/:id` serves provider data through every guard your own
endpoints get: rate limiting, request ids, the envelope contract, and docs.
Declaring the 502 response in the route def documents the failure mode to
frontend developers — an upstream outage is a *normal, contractual* response
they must handle, not a surprise.

### Step 8 — Tests

Write one test file per layer. The transport's own suite is the template for
stubbing the network:

- **Transport** (`tests/unit/http-client.test.ts`, ships with the repo): a
  `scriptedFetch` stub returns a sequence of `Response`s / network errors /
  hangs, with injected `sleepFn`/`randomFn` so retries and backoff are
  asserted without real delays. It also asserts a serialized error **never
  contains the API key or auth header** — keep that assertion in any client
  you write.
- **Provider client** (you write, e.g. `tests/unit/acme-client.test.ts`):
  stubbed `fetchFn` + recording/serving `cachedFn` fakes — assert the bearer
  header, the cache key, malformed payload → `UpstreamError`, cache hit skips
  the network, and that the key never appears in a serialized error.
- **Service** (you write, e.g. `tests/unit/widgets-service.test.ts`):
  `createMockAcmeClient` seeded with fixtures; assert the upstream 404 →
  `NotFoundError` translation and that other upstream failures pass through
  unchanged.
- **Route e2e** (you write): build the app with a mock-backed service —
  `createApp({ widgetsService: createWidgetsService({ acmeClient: createMockAcmeClient(...) }) })`
  — and assert `/api/widgets/known` → 200 envelope, `/api/widgets/unknown` →
  404 envelope. E2E never talks to the real provider.

### Section 2 best practices — the checklist

- [ ] Credentials only via `config/env.ts` + `.env.example` placeholders.
- [ ] Transport is always `createHttpClient` — never raw `fetch` to a provider.
- [ ] Every upstream payload validated with Zod; mismatch → `UpstreamError`.
- [ ] Services depend on the provider **interface**; a mock exists from day one.
- [ ] Reads cached under `cache:upstream:...` keys; cache failures fall through.
- [ ] Upstream statuses get domain meaning in the **service**, nowhere else.
- [ ] Your response schema is yours, not the vendor's.
- [ ] No credential, header, or payload value can reach a log or error message.

---

## Section 3 — How the frontend consumes it

### The contract, from the client's side

Every response is one of the three envelopes. A minimal fetch wrapper:

```ts
class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await res.json();
  if (!res.ok) {
    const e = body.error ?? {};
    throw new ApiError(e.code ?? "UNKNOWN", e.message ?? res.statusText, e.requestId, e.details);
  }
  return body as T; // { data } or { data, meta }
}
```

Frontend handling rules of thumb: branch on `error.code` (stable,
machine-readable — `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`,
`RATE_LIMITED`, `UPSTREAM_ERROR`...), show `error.message` to users, and log
`error.requestId` — it's the string that finds the exact request in server
logs. `meta.total` drives pagination UIs.

### The typed client (zero hand-written types)

The admin app already generates a full TypeScript SDK from the OpenAPI spec
with `@hey-api/openapi-ts` — and since the spec is derived from the same Zod
schemas that validate at runtime, the generated types cannot drift from the
server. After adding or changing an endpoint:

```bash
bun run dev                                   # API must be serving /api/openapi.json
cd apps/admin && bun run client:generate      # regenerates src/client/
```

Function names derive from method + path — `GET /api/posts` becomes
`getApiPosts`, with TanStack Query helpers alongside:

```tsx
import { useQuery } from "@tanstack/react-query";
import { getApiPostsOptions } from "../client/@tanstack/react-query.gen";

function PostList() {
  const { data, isPending, error } = useQuery(
    getApiPostsOptions({ query: { page: "1", pageSize: "10", sort: "createdAt:desc" } }),
  );
  // data.data is Post[] (typed!), data.meta.total drives the pager
}
```

A separate frontend (mobile app, marketing site) can run the same generator
against `http://localhost:3000/api/openapi.json` — see
`apps/admin/openapi-ts.config.ts` for the config to copy.

### CORS and auth, briefly

- The API allows exactly one browser origin: `env.ADMIN_URL`, with
  credentials. A **new browser frontend on another origin** must be added to
  the `cors()` config in `app.ts` (extend it to a list of origins from env) —
  never `*`, which browsers reject with credentials anyway.
- App-user endpoints authenticate with `Authorization: Bearer <accessToken>`
  (QUICKSTART §9: Google sign-in → 15-min access token + rotating refresh token). No
  cookies involved, so non-browser clients (mobile) need no CORS at all.
- In production, prefer serving frontend and API under one domain (reverse
  proxy) so browsers avoid cross-origin entirely.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Boot crash listing env var names | New keys missing from `.env` — copy from `.env.example` |
| Route missing from `/api/docs` | Handler registered with `router.get(...)` instead of `router.openapi(createRoute(...), ...)`, or router never mounted in `app.ts` |
| 404 on a route you just wrote | Forgot `app.route(...)`, or you called it without the `/api` base path |
| `/posts/mine` returns 400 "Invalid id" | `/mine` registered after `/{id}` — static routes first |
| 400 `Field is not sortable/filterable` | The field isn't flagged in the allow-list you passed to `parseListQuery` |
| Handler return type errors against the schema | Serializer drifted from the output schema — fix the serializer (that compile error is the feature) |
| 401 on a protected route with a token | Header isn't `Authorization: Bearer <token>`, token expired (15 min — refresh it), or it's a refresh token not an access token |
| 415 / 413 on writes | Missing `Content-Type: application/json` / body over 1 MB |
| 429 during dev | Rate limiter; wait or raise `RATE_LIMIT_*` in `.env` (QUICKSTART §2) |
| 502 `{ provider: "..." }` envelope | The third party failed/timed out after retries — check its status page; your API behaved correctly |
| 502 `unexpected response shape` | Provider changed its payload — update the client's Zod schema + mapping |
| Frontend types stale after API change | Re-run `cd apps/admin && bun run client:generate` with the API running |
| Browser CORS error from a new frontend | Its origin isn't in the `cors()` origin list in `app.ts` |

## Recap — the whole change in one view

**Section 1 (public posts API):**

```text
packages/schemas/src/post.ts                       EDIT  + publicPostFields allow-list
apps/api/src/modules/posts/posts.repo.ts           NEW   createPostsRepo (Drizzle only)
apps/api/src/modules/posts/posts.service.ts        NEW   createPostsService (rules + AppErrors)
apps/api/src/modules/posts/posts.routes.ts         NEW   createRoute defs + factory + serializer
apps/api/src/app.ts                                EDIT  option + default wiring + app.route("/posts", ...)
apps/api/tests/unit/posts-service.test.ts          NEW   fake-repo unit tests
apps/api/tests/e2e/posts-e2e.test.ts               NEW   app.request() over a test DB
```

**Section 2 (third-party proxy):** the transport (`clients/http.ts`,
`clients/token-cache.ts`, `lib/cache.ts`) already exists — a new provider is
`clients/<provider>/{types,client,mock}.ts` plus env keys, a service that
translates upstream statuses, and one routes file + the module wiring.

No frontend changes were required for any of it — the frontend regenerates its
typed client from `/api/openapi.json` and the new endpoints, types, and query
hooks appear.
