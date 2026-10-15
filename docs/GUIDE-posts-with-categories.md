# Guide: Add a Category to Posts (a relation, end to end)

This is a step-by-step tutorial for junior developers. You will:

1. Create a new `categories` table and expose it as an admin resource.
2. Add a `categoryId` foreign key to `posts` so every post can belong to a category.
3. Watch the admin dashboard grow a **Categories** menu item and a **Category
   dropdown** on the post form — with zero frontend changes.

It follows the 3-step recipe from `QUICKSTART.md` §5 (table → schemas → register),
applied twice, plus the extra step a relation needs: wiring the foreign key.

**Before you start**, make sure the project runs (see `QUICKSTART.md` §1–2):

```bash
docker compose up -d      # Postgres + Redis
bun install
bun run db:migrate
bun run dev               # API on http://localhost:3000
```

---

## The mental model (read this first)

Every admin resource in this repo is defined in three places, and they must agree:

| Piece | Where | What it does |
|---|---|---|
| **Drizzle table** | `apps/api/src/db/schema/<name>.ts` | The real Postgres columns |
| **Zod schemas + `fields` metadata** | `packages/schemas/src/<name>.ts` | Wire validation + what the dashboard renders |
| **`registry.register(...)`** | `apps/api/src/admin/registry/resources/<name>.resource.ts` + `resources.ts` | Mounts `/admin/<name>` CRUD, OpenAPI docs, meta entry, dashboard page |

The registry **cross-checks all three at boot** and crashes with a clear error if
they drift (e.g. a field that isn't a real column). That's a feature: you find
mistakes at startup, not in production requests.

A **relation** is just a plain foreign-key column (`categoryId`) plus one piece of
field metadata (`type: "relation"`) that tells the dashboard to render a dropdown
instead of a text input. There is no ORM magic — no joins in the generic engine.

---

## Step 1 — Create the `categories` table

Create `apps/api/src/db/schema/categories.ts`:

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
```

Then export it from the barrel, `apps/api/src/db/schema/index.ts` (keep the list
alphabetical):

```ts
export * from "./admin-sessions";
export * from "./admin-users";
export * from "./categories";   // <-- add this line
export * from "./posts";
export * from "./refresh-tokens";
export * from "./users";
```

> The registry requires every resource table to have an `id` column — it's how
> get/update/delete address rows. `uuid` + `defaultRandom()` is the house pattern.

## Step 2 — Add the `categoryId` foreign key to `posts`

Edit `apps/api/src/db/schema/posts.ts`. Import the new table and add one column:

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { categories } from "./categories";   // <-- add
import { users } from "./users";

export const postStatus = pgEnum("post_status", ["draft", "published"]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  status: postStatus("status").notNull().default("draft"),
  content: text("content"),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id")                                   // <-- add
    .references(() => categories.id, { onDelete: "set null" }),     // <-- add
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

Two deliberate choices here — copy them unless you have a reason not to:

- **Nullable** (no `.notNull()`): existing posts have no category, so a `NOT NULL`
  column would make the migration fail on any table with rows. Start nullable;
  tighten later with a backfill migration if the product needs it.
- **`onDelete: "set null"`**: deleting a category should not delete its posts
  (compare `authorId`, which uses `cascade` — a deleted user takes their posts
  with them). `set null` orphans the post back to "no category".

## Step 3 — Generate and apply the migration

From the **repo root** (the `db:*` scripts need the root `.env`):

```bash
bun run db:generate
bun run db:migrate
```

`db:generate` diffs your schema files against the last migration and writes a new
SQL file into `apps/api/src/db/migrations/` (e.g. `0004_....sql`). Open it and
sanity-check: it should `CREATE TABLE "categories"` and
`ALTER TABLE "posts" ADD COLUMN "category_id" uuid` with the FK. **Never edit
migration files by hand.**

You can eyeball the result with `bun run db:studio`.

## Step 4 — Category schemas + field metadata (shared package)

> **Generator shortcut:** `bun run schemas:generate category` scaffolds this
> entire file from the Drizzle table (Steps 4 **and** 6 — it also adds the
> barrel export, the `categories.resource.ts` def, and its `register()` line).
> Review its `TODO(generator)` comments afterwards. The manual walkthrough
> below is what the generator produces, explained.

Create `packages/schemas/src/category.ts`. Zod schemas and the `fields` metadata
live in the **same file** so they can't drift — that's the repo rule:

```ts
import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

// Shared property shapes; create adds defaults, update goes fully partial.
const CategoryBaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
});

export const CategoryCreateSchema = CategoryBaseSchema.extend({
  description: CategoryBaseSchema.shape.description.default(null),
}).openapi("CategoryCreate");

export const CategoryUpdateSchema = CategoryBaseSchema.partial().openapi("CategoryUpdate");

// Public wire shape — dates cross as ISO strings.
export const CategorySchema = z
  .object({
    id: z.uuid().openapi({ example: "a1b2c3d4-0000-4000-8000-000000000000" }),
    name: z.string().openapi({ example: "Engineering" }),
    description: z.string().nullable(),
    createdAt: z.iso.datetime().openapi({ example: "2026-07-09T00:00:00.000Z" }),
  })
  .openapi("Category");

export type Category = z.infer<typeof CategorySchema>;
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof CategoryUpdateSchema>;

// Drives the generic admin list/form rendering.
export const categoryFields: ResourceField[] = [
  {
    name: "name",
    type: "string",
    label: "Name",
    required: true,
    listColumn: true,
    searchable: true,
  },
  { name: "description", type: "text", label: "Description" },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
];
```

Export it from `packages/schemas/src/index.ts` (alphabetical):

```ts
export * from "./admin-user";
export * from "./auth";
export * from "./category";   // <-- add this line
export * from "./common";
export * from "./post";
export * from "./resource";
export * from "./user";
```

What the field flags mean (they are the **allow-list** for the list API):

| Flag | Effect |
|---|---|
| `listColumn` | Shown as a column on the dashboard list page |
| `searchable` | The search box may target it (`filter[name][like]=...`) |
| `filterable` | `eq`/`in`/`gte`/`lte` filters allowed on it |
| `sortable` | `sort=field:dir` allowed on it |
| `required` | Form validation requires a value |
| `readOnly` | Rendered but not editable (and excluded from forms' payloads) |

Anything you don't flag is rejected with a 400 — undeclared columns are unreachable.

## Step 5 — Add the relation to the post schemas + fields

Edit `packages/schemas/src/post.ts`. Three changes:

**5a. Add `categoryId` to the base schema** (nullable, mirroring the column):

```ts
const PostBaseSchema = z.object({
  title: z.string().min(1).max(500),
  status: PostStatusSchema,
  content: z.string().max(100_000).nullable(),
  authorId: z.uuid(),
  categoryId: z.uuid().nullable(),   // <-- add
});
```

**5b. Default it in the create schema** so clients may omit it:

```ts
export const PostCreateSchema = PostBaseSchema.extend({
  status: PostStatusSchema.default("draft"),
  content: PostBaseSchema.shape.content.default(null),
  categoryId: PostBaseSchema.shape.categoryId.default(null),   // <-- add
}).openapi("PostCreate");
```

(`PostUpdateSchema` is `PostBaseSchema.partial()`, so it picks the field up
automatically — nothing to do there.)

**5c. Add it to the output schema** (`PostSchema`) — the registry *requires*
every field to appear here, and columns absent from it are stripped from
responses:

```ts
export const PostSchema = z
  .object({
    id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),
    title: z.string().openapi({ example: "Hello world" }),
    status: PostStatusSchema,
    content: z.string().nullable(),
    authorId: z.uuid().openapi({ example: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a" }),
    categoryId: z.uuid().nullable(),   // <-- add
    createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
    updatedAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
  })
  .openapi("Post");
```

**5d. Add the relation entry to `postFields`** — this is what turns the raw uuid
column into a dropdown on the dashboard:

> **Generator note:** when the FK already exists on the table, the generator
> emits this exact entry (including `listColumn: true, filterable: true`) into
> the owning model's file. But `post.ts` already exists here, so a bulk run
> only *reports drift* — either make these three edits by hand (below) or
> regenerate with `bun run schemas:generate post --force` (which discards any
> hand edits in `post.ts`).

```ts
export const postFields: ResourceField[] = [
  // ... existing entries unchanged ...
  {
    name: "categoryId",
    type: "relation",
    label: "Category",
    resource: "categories",   // the *registry name* of the target resource
    displayField: "name",     // which target column the dropdown shows
    listColumn: true,
    filterable: true,
  },
  // ... createdAt stays last ...
];
```

How to read that entry:

- `type: "relation"` is a discriminated variant of `ResourceField`
  (`packages/schemas/src/resource.ts`) — TypeScript forces you to also provide
  `resource` and `displayField`. Compare the existing `authorId` field, which
  relates to `users` by `email`.
- `resource: "categories"` must match the `name:` you register in Step 6. The
  dashboard's dropdown loads its options from `GET /admin/categories`.
- `filterable: true` lets the list API accept `filter[categoryId][eq]=<uuid>` —
  relation values are validated as UUIDs at the boundary, so garbage is a 400,
  never a Postgres error.
- No `required: true` because we made the column nullable — the form lets the
  user leave it empty (and clear it on edit).

## Step 6 — Register the `categories` resource

> **This step is automated.** When `bun run schemas:generate category` writes a
> new schema file, it also generates
> `admin/registry/resources/categories.resource.ts` and wires it into the
> `resources.ts` index (an import + a `register()` line) — with
> `icon: "TableOutlined"` and full-CRUD default permissions, each flagged by a
> `TODO(generator)` comment to review. It skips resources that are already
> registered (by name or table), so re-runs are safe. The manual version below
> is what gets generated — read it to understand the knobs, and use it when
> you're wiring a hand-written schema file.

Create `apps/api/src/admin/registry/resources/categories.resource.ts` exporting
the def (a factory instead of a const if it ever needs deps — see
`admins.resource.ts`):

```ts
import {
  CategoryCreateSchema,
  CategorySchema,
  CategoryUpdateSchema,
  categoryFields,
} from "@starter/schemas";
import { categories } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

export const categoriesResource: AdminResourceDef = {
  name: "categories",
  label: "Categories",
  icon: "TagsOutlined",
  table: categories,
  schema: {
    create: CategoryCreateSchema,
    update: CategoryUpdateSchema,
    output: CategorySchema,
  },
  fields: categoryFields,
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
};
```

Then register it in `apps/api/src/admin/registry/resources.ts` inside
`createDefaultAdminRegistry()` (before or after the `posts` line — order
doesn't matter):

```ts
import { categoriesResource } from "./resources/categories.resource";
// ...
  registry.register(categoriesResource);
```

Notes:

- `icon` is an antd icon name looked up by the frontend (falls back to
  `TableOutlined` if unknown).
- **`list: "viewer"` matters for the relation**: the post form's Category
  dropdown fetches `GET /admin/categories`, so anyone allowed to edit posts
  (`editor`) must also be allowed to *list* categories. Keeping `list` at
  `viewer` guarantees that.
- Omitting a permission disables that action entirely (route never mounted →
  404, button hidden) — that's how `users` ships read-only.

That single call gives you `GET/POST /admin/categories`,
`GET/PATCH/DELETE /admin/categories/:id`, OpenAPI docs, a meta entry, and the
dashboard page. `posts` needs **no registration change** — its new field rides
in through `postFields` and `PostSchema`.

## Step 7 — Verify the code gates

From the repo root:

```bash
bun run typecheck
bun run lint
bun run test:unit       # no Postgres needed
bun test apps/api       # full suite — needs docker compose up -d
```

Then restart the dev server:

```bash
bun run dev
```

**Watch the boot output.** If you mismatched the three pieces, the registry
crashes immediately with a message that names the problem, e.g.:

| Boot error | You forgot |
|---|---|
| `field is not a table column: categoryId` | Step 2 (column) or you didn't run the migration's schema edit |
| `field missing from output schema: categoryId` | Step 5c (`PostSchema`) |
| `create permission requires a create schema` | `schema.create` in the Step 6 def |
| `Admin resource already registered: categories` | You registered it twice |

Quick API smoke checks:

- http://localhost:3000/api/docs — the **categories** routes appear, and the
  `PostCreate`/`Post` components now include `categoryId`.
- `GET /admin/meta/resources` (needs an admin session) includes the
  `categories` entry and the new `postFields` relation entry.

> The meta endpoint is cached in Redis per role, but the cache is swept on every
> process start — restarting the API is enough; you never need to flush Redis.

## Step 8 — See it in the dashboard

Run the admin app alongside the API (see `QUICKSTART.md` §2 — the API's `.env`
needs `ADMIN_URL=http://localhost:8000`):

```bash
cd apps/admin && bun run dev   # http://localhost:8000
```

Sign in (Google login on /user/login, then the "Sign in with Google" card on `/resources/*`
using a `GOOGLE_ALLOWED_HD` account — the `ADMIN_SEED_OWNER_EMAIL` account has
full CRUD). Then:

1. **Categories** appears in the sidebar. Open it → **Create** → make one, e.g.
   name `Engineering`. (Create needs the `editor` role or above.)
2. Open **Posts** → **Create**. The form now has a **Category** dropdown listing
   categories by name. Pick one and save.
3. Edit that post — the dropdown resolves the stored id back to the category
   name (the frontend fetches it via `getMany`).
4. Filter the list: the Category column supports an `eq` filter.

Known dashboard limit (documented in `QUICKSTART.md` §5): the **list page cell
shows the raw category id**, not the name — the generic engine does no joins.
The form dropdown resolves names; the list column doesn't. If that matters for
your resource, build a bespoke page in `apps/admin` and point the resource at it.

## Step 9 — Exercise the API directly (optional)

Admin routes need the `admin_session` cookie and, on writes, the
`X-Requested-With` header (CSRF). Easiest way to get a cookie for manual
testing: sign in via the dashboard, then copy the `admin_session` value from
your browser devtools (Application → Cookies).

```bash
COOKIE="admin_session=<paste value here>"

# Create a category (editor+)
curl -s http://localhost:3000/api/admin/categories \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Cookie: $COOKIE" \
  -d '{"name":"Engineering","description":"Tech posts"}'
# → 201 { "data": { "id": "...", "name": "Engineering", ... } }

CATEGORY_ID=<id from the response>
AUTHOR_ID=$(curl -s "http://localhost:3000/api/admin/users?pageSize=1" \
  -H "Cookie: $COOKIE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Create a post in that category
curl -s http://localhost:3000/api/admin/posts \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Cookie: $COOKIE" \
  -d "{\"title\":\"Hello categories\",\"authorId\":\"$AUTHOR_ID\",\"categoryId\":\"$CATEGORY_ID\"}"

# List posts in that category (the filterable flag makes this legal)
curl -s "http://localhost:3000/api/admin/posts?filter\[categoryId\]\[eq\]=$CATEGORY_ID" \
  -H "Cookie: $COOKIE"

# Move a post out of its category (nullable column → null is valid)
curl -s -X PATCH http://localhost:3000/api/admin/posts/<post-id> \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Cookie: $COOKIE" \
  -d '{"categoryId":null}'
```

Failure shapes you should see (they prove the guards work):

- Missing `X-Requested-With` on a write → 403 envelope.
- `filter[categoryId][eq]=not-a-uuid` → 400 `VALIDATION_ERROR` (boundary
  validation), not a Postgres error.
- `categoryId` pointing at a nonexistent category → the FK rejects it (surfaces
  as an error envelope; the DB is the final integrity check).

## Step 10 — Add tests

Follow the existing precedents (all in `apps/api/tests/`):

1. **Schema unit tests** — copy the shape of `tests/unit/post-schemas.test.ts`
   into `tests/unit/category-schemas.test.ts`: assert `CategoryCreateSchema`
   applies defaults, `CategoryUpdateSchema` accepts partials, `CategorySchema`
   rejects a bad row, and every `categoryFields` name exists in
   `CategorySchema` (the no-drift pin). Add a case to the post schema tests
   asserting `categoryId` accepts a uuid and `null`.
2. **Registry** — the existing `tests/unit/registry.test.ts` already proves the
   cross-checks; you get boot-time coverage of your def for free via any test
   that builds the default registry.
3. **E2E (optional but recommended)** — extend
   `tests/e2e/admin-crud-e2e.test.ts`'s pattern: editor creates a category,
   creates a post with its `categoryId`, filters posts by it, PATCHes it to
   null. The e2e helpers already mint admin sessions without touching Google.

Run everything again before you call it done:

```bash
bun run typecheck && bun run lint && bun test apps/api
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Boot crash naming your field or schema | See the table in Step 7 — the three pieces disagree |
| Migration fails with `column "category_id" ... contains null values` | You made the column `NOT NULL` with existing rows — keep it nullable (Step 2) |
| Category dropdown is empty | The signed-in admin's role can't `list` categories, or you haven't created any yet |
| Dropdown shows ids instead of names | `displayField` doesn't match a real field of the target's output schema (`name` for categories) |
| `filter[categoryId]...` returns 400 `Field is not filterable` | You forgot `filterable: true` on the relation entry (Step 5d) |
| New resource missing from the sidebar | API not restarted (registration is boot-time), or the role can't `list` it |
| Schema change not reflected in the DB | You edited the table but didn't run `bun run db:generate && bun run db:migrate` |
| 415 on curl writes | Missing `Content-Type: application/json` |
| 403 on curl writes | Missing `X-Requested-With: XMLHttpRequest` (CSRF check) |

## Recap — the whole change in one view

```text
apps/api/src/db/schema/categories.ts        NEW    categories table
apps/api/src/db/schema/index.ts             EDIT   barrel export
apps/api/src/db/schema/posts.ts             EDIT   + categoryId FK (nullable, set null)
apps/api/src/db/migrations/0004_*.sql       GEN    bun run db:generate (never hand-edit)
packages/schemas/src/category.ts            GEN    bun run schemas:generate category (review TODOs)
packages/schemas/src/index.ts               GEN    barrel export (same command)
packages/schemas/src/post.ts                EDIT   + categoryId in base/create/output + relation field
apps/api/src/admin/registry/resources/categories.resource.ts  GEN  def scaffold, same command (review TODOs)
apps/api/src/admin/registry/resources.ts    GEN    import + registry.register() line added by the same command
apps/api/tests/unit/category-schemas.test.ts NEW   schema pins (mirror post-schemas.test.ts)
```

No route files, no service files, no repo files, no frontend files. That is the
point of the registry: the relation is one column, one schema field, one
metadata entry, and one registration.
