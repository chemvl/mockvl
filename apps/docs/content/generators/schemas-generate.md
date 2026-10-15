---
title: schemas:generate
description: Scaffold house-style Zod model files and admin resource defs from your Drizzle tables.
order: 1
---

## What it does

```bash
bun run schemas:generate                 # write all missing model files; drift-warn existing ones
bun run schemas:generate category        # one model; errors if the file already exists
bun run schemas:generate posts --force   # overwrite one model (discards hand edits!)
```

The generator (`apps/api/scripts/generate-schemas.ts`) introspects every Drizzle table exported from `apps/api/src/db/schema` and, for each model, does four things:

1. Writes `packages/schemas/src/<file-base>.ts` — a house-style model file with a private `<Name>BaseSchema`, exported `<Name>CreateSchema` (defaults applied), `<Name>UpdateSchema` (fully partial), the `<Name>Schema` output shape, inferred types, and a `<name>Fields: ResourceField[]` metadata array that drives the generic admin list and form rendering.
2. Upserts `export * from "./<file-base>";` into the `packages/schemas/src/index.ts` barrel, keeping export lines sorted.
3. Registers the model with the admin console: it emits `apps/api/src/admin/registry/resources/<name>.resource.ts` and splices an import plus a `registry.register(...)` call into `apps/api/src/admin/registry/resources.ts` (see [the resource registry](/admin/resource-registry/)).
4. Formats the output — `biome format --write` on the model files and barrel, then `biome check --write` on the registry files so Biome's organizeImports assist sorts the appended imports.

The internal auth tables `refresh_tokens` and `admin_sessions` are never scaffolded: they are excluded in all-models mode, and naming one explicitly exits with an error, because they never appear on the wire.

## Arguments and flags

| Input | Effect |
|---|---|
| *(none)* | Generates every missing model file. Tables whose file already exists are drift-checked instead — nothing is ever overwritten in this mode, even with `--force`. |
| `model` | Generates exactly one model. Matching is case- and punctuation-insensitive against the schema export key (`adminUsers`), the database table name (`admin_users`), the file base (`admin-user`), and the singular export key — so `adminUsers`, `admin_users`, `admin-user`, and `AdminUser` all resolve to the same table. |
| `--force` | Single-model mode only: overwrites an existing `packages/schemas/src/<file-base>.ts`. The generator warns that hand edits are being discarded. |

Any unknown `--flag`, or more than one positional argument, prints usage (with the list of valid model names) and exits non-zero.

## Refusing to overwrite

In single-model mode, if `packages/schemas/src/<file-base>.ts` already exists the run fails:

```bash
packages/schemas/src/category.ts already exists. Re-run with --force to overwrite (hand edits will be lost).
```

Generated files are scaffolds you are expected to hand-tune, so the generator treats an existing file as yours. `--force` exists for the case where you changed the table and would rather re-scaffold than reconcile by hand — accepting that every hand edit in that file is lost.

## Drift warnings

When a model file already exists (the all-models run), the generator compares the table's columns against the exported `<Name>Schema` output shape instead of writing anything:

- `⚠ posts: PostSchema is missing table column(s): …` — the table gained columns the wire schema doesn't expose. Add them by hand or regenerate with `--force`.
- `⚠ posts: PostSchema has key(s) with no table column: …` — the schema exposes keys the table no longer has.
- If the file exists but exports no `<Name>Schema`, the generator says so and skips the check.

Columns that are deliberately kept off the wire are listed in `DRIFT_IGNORE` in `apps/api/scripts/schema-gen/drift.ts` (for example `users`: `passwordHash`, `updatedAt`, `googleSub`) and never reported. Running `bun run schemas:generate` with no arguments is therefore a cheap, safe drift audit for the whole schema package.

## How columns are classified

Introspection (in `apps/api/scripts/schema-gen/introspect.ts`) maps each column to a kind that decides both the Zod expression and the admin field type:

- A `uuid` primary key named `id` becomes the `id` convention (output-only, with an OpenAPI example).
- A single-column `uuid` foreign key becomes a `relation` field pointing at the target resource slug, with a display field guessed from the target's `name`/`title`/`email` column (falling back to `id` with a TODO).
- pg enums become an exported `const` array, a `<Enum>Schema`, and an enum admin field with options.
- `createdAt`/`updatedAt` timestamps are auto-managed: excluded from Create/Update, and `createdAt` is emitted as a read-only, sortable list column.
- Text columns: `email` → `z.email()`, `*Url` → `z.url()`, nullable columns and long-form names (`content`, `description`, `body`, `notes`) → `text`, otherwise `string` with a "tune max length" TODO.
- `richtext` and `image` kinds are explicit opt-ins via the `RICHTEXT_COLUMNS` / `IMAGE_COLUMNS` maps at the top of `introspect.ts`, so `--force` regeneration keeps them.
- Unmapped column types are emitted as `z.unknown()` with a warning — refine those by hand.

The generator also warns (without stopping) about composite primary keys, missing uuid `id` primary keys, composite foreign keys, and enums shared by two models (the duplicated const would collide in the barrel — dedupe by hand; a v1 limitation).

## The TODO(generator) workflow

Everything the generator is unsure about is surfaced as a `TODO(generator)` comment in the emitted source, and the run ends with the checklist:

```bash
next steps:
  1. review the generated resources/<name>.resource.ts (icon, permissions) and its register() line in apps/api/src/admin/registry/resources.ts
  2. review TODO(generator) comments and tune labels/limits/flags
  3. bun run typecheck && bun run lint && bun test
```

What you still edit by hand:

- **Field flags** — the generator only sets conservative defaults (`listColumn`/`searchable` on the first required string, `filterable` on enums and relations, `sortable` on `createdAt`). Add `sortable`, `filterable`, and `searchable` flags deliberately: they are the allow-list for the admin list query contract.
- **Limits and labels** — `z.string().min(1)` max lengths, human-friendly labels.
- **Relations** — confirm the emitted `resource:` slug matches the target's registered resource name, and fix any guessed `displayField`.
- **The resource def** — replace the placeholder `TableOutlined` icon and review the default permissions (`list: viewer, create/update: editor, delete: owner`; read-only tables get `list: viewer` only).

If auto-registration cannot find its anchors in `resources.ts`, or the model is already registered (by resource name *or* by table — a table registered under a hand-picked name is still detected), the schema file is written anyway and the registry step is skipped with a warning telling you to wire it by hand.

## Worked example

With a `categories` table (uuid `id`, required `name`, nullable `description`, `createdAt`):

```bash
bun run schemas:generate category
```

emits `packages/schemas/src/category.ts`:

```typescript
// Generated by scripts/generate-schemas.ts — review the TODO(generator)
// comments and hand-tune labels, limits, and field flags before shipping.
// Regenerating with --force discards hand edits.

import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

// Shared property shapes; create adds defaults, update goes fully partial.
const CategoryBaseSchema = z.object({
  name: z.string().min(1), // TODO(generator): tune max length
  description: z.string().nullable(),
});

export const CategoryCreateSchema = CategoryBaseSchema.extend({
  description: CategoryBaseSchema.shape.description.default(null),
}).openapi("CategoryCreate");

export const CategoryUpdateSchema = CategoryBaseSchema.partial().openapi("CategoryUpdate");

// Public wire shape — dates cross as ISO strings.
export const CategorySchema = z
  .object({
    id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
  })
  .openapi("Category");

export type Category = z.infer<typeof CategorySchema>;
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof CategoryUpdateSchema>;

// Drives the generic admin list/form rendering.
export const categoryFields: ResourceField[] = [
  { name: "name", type: "string", label: "Name", required: true, listColumn: true, searchable: true },
  { name: "description", type: "text", label: "Description" },
  { name: "createdAt", type: "date", label: "Created", listColumn: true, sortable: true, readOnly: true },
];
```

alongside `apps/api/src/admin/registry/resources/categories.resource.ts` and its `registry.register(categoriesResource)` line. Restart the API and the admin dashboard picks the resource up with zero frontend changes.

Once the schema exists and its TODOs are reviewed, scaffold the public API with [module:generate](/generators/module-generate/). For the surrounding conventions, see [conventions](/architecture/conventions/).
