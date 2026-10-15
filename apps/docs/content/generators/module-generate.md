---
title: module:generate
description: Scaffold a working public API module — repo, service, routes, tests, and wiring — from a schema.
order: 2
---

## What it does

```bash
bun run module:generate categories               # public GET list + GET /:id
bun run module:generate posts --protected        # same, behind JWT bearer auth
bun run module:generate posts --force            # overwrite (discards hand edits!)
```

The generator (`apps/api/scripts/generate-module.ts`) turns a Drizzle table plus its `packages/schemas` model file into a complete, immediately working read module following the route → service → repo layering (see [how a request flows](/getting-started/request-flow/)). After a run, `GET /api/<name>` (paginated list with the full query contract) and `GET /api/<name>/{id}` respond for real, appear in `/api/docs` under their own tag, and ship with unit and e2e tests. Write endpoints (POST/PATCH/DELETE) are deliberately left to you — they carry business rules a generator cannot guess.

## Prerequisites

The module reuses the wire schema, so the model file must exist first: `packages/schemas/src/<file-base>.ts` must exist **and** export `<Name>Schema`. If either is missing the run fails and tells you to run [schemas:generate](/generators/schemas-generate/) for that model, review its TODOs, then re-run.

The generator also refuses to scaffold when:

- the table is internal auth plumbing (`refresh_tokens`, `admin_sessions`) — never wire-exposed;
- the table has no uuid `id` primary key — the `GET /{id}` route and the pagination tiebreaker require one, so write that module by hand;
- the route segment is reserved (`admin`, `health`, `ready`, `docs`, `openapi.json`) — it would shadow or collide with system routes.

## Arguments and flags

| Input | Effect |
|---|---|
| `<model>` | Required, exactly one. Matched case- and punctuation-insensitively against the schema export key, table name, file base, or singular form (`categories`, `category`, `Categories` all work). |
| `--protected` | Puts the whole router behind JWT bearer auth: `router.use(authMiddleware())` guards every route, each route gets `security: [{ bearerAuth: [] }]` plus a documented 401 response, and the e2e test mints a token and asserts the 401 envelope for unauthenticated requests. |
| `--force` | Overwrites an existing module. The module directory is the collision unit: all five generated files are rewritten and hand edits are lost. Wiring edits are idempotent, so re-runs never duplicate lines. |

Unknown flags, zero positionals, or more than one positional print usage and exit non-zero. Without `--force`, an existing `apps/api/src/modules/<name>/` directory aborts the run:

```bash
apps/api/src/modules/categories already exists. Re-run with --force to overwrite (hand edits will be lost).
```

## Files it creates

For a model `categories` the generator writes five files:

| Path | Contents |
|---|---|
| `apps/api/src/modules/categories/categories.repo.ts` | `createCategoriesRepo(db)` — Drizzle-only queries, a column allow-list mirroring the public fields, LIKE-escaping, stable pagination with an `id` tiebreaker, `count(*)::int` totals. |
| `apps/api/src/modules/categories/categories.service.ts` | `createCategoriesService({ categoriesRepo })` — business-logic layer; `getById` throws `NotFoundError`, no Hono imports. |
| `apps/api/src/modules/categories/categories.routes.ts` | `createRoute()` definitions from `@hono/zod-openapi`, a typed serializer (`Date` → ISO string), envelope responses, `parseListQuery` against the public field allow-list. |
| `apps/api/tests/unit/categories-service.test.ts` | Service tests with a fake repo: `NotFoundError` on unknown ids, query pass-through to the repo. |
| `apps/api/tests/e2e/categories-e2e.test.ts` | Seed-free `app.request()` tests: list envelope shape, 404 envelope, 400 on non-uuid ids, rejected undeclared sort fields, the 100-row `pageSize` cap — and the 401 envelope when `--protected`. |

## What it wires automatically

Three source edits follow the file writes. Each is idempotent, and each is **non-fatal**: if an anchor is missing the module files are still written and the warning tells you the exact line to add by hand.

1. **`apps/api/src/modules/index.ts`** — imports the routes factory and service type, adds `categoriesService: CategoriesService` to the `ModuleServices` interface, and mounts `app.route("/categories", createCategoriesRoutes(services.categoriesService))` after the last existing mount.
2. **`apps/api/src/app.defaults.ts`** — imports the repo and service factories, builds the default instance inside `createDefaultServices` (`createCategoriesService({ categoriesRepo: createCategoriesRepo(db) })`), and adds the injected-vs-default resolution line so tests can substitute mocks.
3. **`packages/schemas/src/category.ts`** — appends the `publicCategoryFields` allow-list export. This is deliberately separate from the admin fields array: it defines what the *public* list endpoint accepts for sort, filter, and search, and it starts generous with a TODO telling you to trim it.

The public wire surface is the model's output-schema shape intersected with the table's columns. Anything named like a secret (`password`, `hash`, `secret`, `token`) is dropped even if the schema exposes it, with a warning to reconcile by hand. Schema keys with no table column produce a `TODO(generator)` in the serializer that deliberately fails typecheck until you map them.

Finally the generator runs `biome check --write` on every touched file so appended imports land in canonical sorted order.

## What you finish by hand

The run ends with its own checklist:

```bash
next steps:
  1. review the TODO(generator) comments: visibility rules in apps/api/src/modules/categories/categories.repo.ts, and trim the publicCategoryFields allow-list in packages/schemas/src/category.ts
  2. bun run typecheck && bun run lint && bun test apps/api
  3. bun run dev, then GET /api/categories — docs at /api/docs under the "categories" tag
```

- **Visibility rules.** The generated `list`/`findById` expose *all* rows. Encode restrictions in repo method semantics (for example rename to `listPublished`/`findPublishedById` with a base condition) before shipping anything with restricted rows.
- **Trim the public allow-list.** Drop any field the public API should not search, filter, or sort by.
- **Write endpoints.** Add POST/PATCH/DELETE routes by hand, registering static paths (like `/mine`) *before* `/{id}` — Hono matches in registration order.
- **Seeded test scenarios.** The generated e2e suite only asserts envelope shapes because the test database is shared; add seeded tests for real business rules (see [testing](/guides/testing/)).

## Worked example

```bash
bun run schemas:generate category        # once, then review its TODOs
bun run module:generate categories
```

Output:

```bash
generated apps/api/src/modules/categories/categories.repo.ts
generated apps/api/src/modules/categories/categories.service.ts
generated apps/api/src/modules/categories/categories.routes.ts
generated apps/api/tests/unit/categories-service.test.ts
generated apps/api/tests/e2e/categories-e2e.test.ts
wired apps/api/src/modules/index.ts (mount + ModuleServices)
wired apps/api/src/app.defaults.ts (default wiring)
wired packages/schemas/src/category.ts (public allow-list)
```

The emitted service shows the pattern every module follows — factories taking deps as params, `AppError` subclasses, no Hono:

```typescript
export function createCategoriesService(deps: CategoriesServiceDeps) {
  const { categoriesRepo } = deps;

  return {
    async list(query: ListQuery) {
      return categoriesRepo.list(query);
    },

    async getById(id: string) {
      const category = await categoriesRepo.findById(id);
      // "Exists but you may not see it" and "does not exist" must look identical.
      if (!category) throw new NotFoundError("Category not found");
      return category;
    },
  };
}
```

Run `bun run dev` and exercise the query contract immediately:

```http
GET /api/categories?page=1&pageSize=20&sort=createdAt:desc&filter[name][like]=intro
```

Sorting and filtering only work on fields declared in `publicCategoryFields` — an undeclared field is a 400, which the generated e2e test already proves. Beyond the scaffold, the hand-written modules in `apps/api/src/modules/` (`workspaces`, `mocks`, `usage`) are the reference, and [Core Conventions](/architecture/conventions/) is the contract.
