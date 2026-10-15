---
title: Resource Registry
description: Register a model once and get admin CRUD routes, OpenAPI docs, a meta entry, and a dashboard page for free.
order: 2
---

The admin resource registry (`apps/api/src/admin/registry/`) turns one definition into a complete admin surface. Registering a resource gives you:

- `GET/POST /admin/<name>` and `GET/PATCH/DELETE /admin/<name>/:id` — each guarded by `requireAdmin(<permission>)` and documented in `/docs` with the resource's real schemas
- An entry in `GET /admin/meta/resources` (filtered to what the caller's role can list)
- On the dashboard: a sidebar menu item, a list page with pagination/sort/filter/search, and create/edit forms — with **zero frontend changes**

The worked examples registered out of the box: `posts` (full CRUD), `categories`, `users` (read-only), and `admins` (owner-only role management).

## The 3-step recipe

1. **Drizzle table** in `apps/api/src/db/schema`, then `bun run db:generate && bun run db:migrate`.
2. **Schemas + field metadata** in `packages/schemas` — one file per model with the Zod schemas and a `fields` array.
3. **Resource def + register** — a `resources/<name>.resource.ts` file plus one `registry.register(...)` line in `resources.ts`.

Steps 2–3 are automated: given the table, `bun run schemas:generate <model>` scaffolds the schemas file, its barrel export, and the resource def wired into the index — with a placeholder icon and full-CRUD default permissions, each flagged `TODO(generator)` for review. See [schemas:generate](/generators/schemas-generate/) for the generator's knobs, and the [posts-with-categories guide](/guides/posts-with-categories/) for the recipe end to end.

Restart the API, refresh the dashboard, and the menu item and pages appear.

## The resource definition

The def shape, from `apps/api/src/admin/registry/registry.ts`:

```typescript
export interface AdminResourceDef {
  // URL segment + Refine resource name.
  name: string;
  label: string;
  // antd icon name as a string (frontend looks it up by name).
  icon?: string;
  table: PgTable;
  // create/update are optional so read-only resources don't carry dead
  // schemas — but a def granting a mutating permission must supply the
  // matching schema (enforced at registration).
  schema: {
    create?: z.ZodType<ResourceRow>;
    update?: z.ZodType<ResourceRow>;
    output: z.ZodObject<z.ZodRawShape>;
  };
  fields: ResourceField[];
  permissions: ResourcePermissions;
  hooks?: AdminResourceHooks;
}
```

A real registered resource, `apps/api/src/admin/registry/resources/posts.resource.ts`:

```typescript
import { PostCreateSchema, PostSchema, PostUpdateSchema, postFields } from "@starter/schemas";
import { posts } from "@/db/schema";
import { sanitizeRichTextFields } from "@/lib/sanitize";
import type { AdminResourceDef } from "../registry";

const richTextFieldNames = postFields
  .filter((field) => field.type === "richtext")
  .map((field) => field.name);

export const postsResource: AdminResourceDef = {
  name: "posts",
  label: "Posts",
  icon: "FileTextOutlined",
  table: posts,
  schema: {
    create: PostCreateSchema,
    update: PostUpdateSchema,
    output: PostSchema,
  },
  fields: postFields,
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
  hooks: {
    beforeCreate: (input) => sanitizeRichTextFields(input, richTextFieldNames),
    beforeUpdate: (_id, input) => sanitizeRichTextFields(input, richTextFieldNames),
  },
};
```

And the registration in `resources.ts`:

```typescript
registry.register(postsResource);
```

If a def ever needs dependencies, export a factory instead of a const — `admins.resource.ts` is the worked example (`createAdminsResource({ adminUsersRepo })`).

## Permissions per action

`permissions` maps each action to the minimum role (`viewer < editor < owner`) that may perform it. Every generated route is guarded by `requireAdmin(permissions[action])` — see [admin auth](/admin/auth/) for how the guard works.

**Omit a permission to disable the action.** No `create`/`update`/`delete` means the route is never mounted (404) and the dashboard hides the buttons — that is exactly how `users` ships read-only. The registry also enforces consistency at boot: a `create` or `update` permission without its matching request schema throws, because it would mount a route that cannot validate its body.

The `admins` resource shows the pattern's range: owner-only `list`/`update`/`delete`, **no** `create` (admins only enter via the Google-login upsert), an update schema limited to `role`, and `before*` hooks that make demoting or deleting the last owner a 409 — the hooks-as-guard pattern. A `beforeUpdate`/`beforeDelete` hook can throw any `AppError` and the request gets the matching error envelope.

## What the def controls

- **Field flags are the allow-list.** The list endpoint follows the standard query contract (`page`, `pageSize` ≤ 100, `sort=field:dir`, `filter[field][op]=value` with `eq|like|in|gte|lte`) — but sorting is only accepted on `sortable` fields, `filter[…][like]` only on `searchable` fields, other ops only on `filterable` fields. Anything else is a 400, never a Postgres error. `id` is always filterable with `eq`/`in`. ILIKE wildcards in filter values are escaped.
- **The output schema is the wire contract.** Rows are serialized through `schema.output` — dates become ISO strings and undeclared columns are stripped, so a column like `users.passwordHash` cannot leak through the generic engine.
- **Custom behavior goes in `hooks`.** `beforeCreate`/`beforeUpdate` may transform the validated input; `after*` hooks observe the affected row — the place to call `invalidate("cache:query:<name>:*")` if you cache that resource's reads.

The engine itself is three small files: `crud.repo.ts` (one Drizzle repo over any table), `crud.service.ts` (shared logic plus the per-resource `hooks` escape hatch), and `crud.routes.ts` (per-resource `createRoute()` definitions, so `/docs` documents every resource with its real schemas).

## Relations render as dropdowns

A field with `type: "relation"` points at another registered resource, and the dashboard turns it into a dropdown. From `postFields` in `packages/schemas`:

```typescript
{
  name: "categoryId",
  type: "relation",
  label: "Category",
  resource: "categories",   // must match the name registered for that resource
  displayField: "name",     // which field of the related row to show as the label
  listColumn: true,
  filterable: true,
},
```

The form's dropdown loads its options from `GET /admin/categories`, showing each row's `displayField`. `filterable: true` lets the list API accept `filter[categoryId][eq]=<uuid>` — relation values are validated as UUIDs at the boundary. Leave off `required` when the column is nullable and the form allows clearing the value.

Two limits worth knowing: list rows show relation fields as raw ids (the generic engine does no joins), and the search box is single-field `like` — the API ANDs flat filters, so multi-field OR search is not expressible.

## Boot-time validation

Registration happens once at app assembly, and every check throws a plain `Error` — a broken def crashes boot instead of surfacing at request time. The registry verifies:

- The name is unique and not reserved (`auth`, `meta`, `notifications` are mounted by the app itself)
- The public half parses as a valid meta entry (what the frontend renders)
- Mutating permissions have matching request schemas
- The table has an `id` column (get/update/delete lookups and the list tiebreaker)
- Every field is backed by a real table column **and** appears in the output schema

## The meta endpoint

`GET /admin/meta/resources` returns each def's public half — name, label, icon, fields, permissions; never the table, schemas, or hooks. It is filtered to resources the caller's role can list, cached per role (`cache:admin:meta:resources:<role>`), and swept at every process start, since the registry only changes with a deploy. The [admin frontend](/admin/frontend/) builds its entire menu and generic pages from this payload.
