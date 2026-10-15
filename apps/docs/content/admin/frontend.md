---
title: Admin Frontend
description: The apps/admin dashboard — Ant Design Pro with headless Refine, wired to the API's resource registry.
order: 3
---

`apps/admin` is a full Ant Design Pro application: Vite, React 19, Ant Design v6, ProComponents v3, react-router v7, TanStack Query v5, Zustand, Biome, and Jest — all run with bun. It was an existing product app merged into this monorepo via git subtree in Phase 10, then wired to this API with **headless Refine** under `apps/admin/src/refine/`. The payoff: registering a backend resource in the [resource registry](/admin/resource-registry/) produces a sidebar menu item plus generic list/create/edit pages with zero frontend changes.

The background on why it was integrated this way is in [the Phase 10 decision record](/decisions/phase-10-admin-integration/).

## Headless Refine

The Refine layer is `@refinedev/core` + `@refinedev/react-router` + the official `@refinedev/react-hook-form` adapter. `@refinedev/antd` is deliberately **not** installed — it is peer-locked to antd v5 while the app runs antd v6. Generic pages use core hooks (`useTable`, `useSelect`, `useCan`) with raw antd components instead.

## Running it

```bash
cd apps/admin
bun install
bun run dev        # Vite dev server on http://localhost:8000
```

The dev server runs on **port 8000** (set in `vite.config.ts`), not Vite's default 5173 — so the API's `ADMIN_URL` must be `http://localhost:8000` (it is both the CORS origin and the post-login redirect). Other scripts from `apps/admin/package.json`:

```bash
bun run build      # vite build
bun run test       # jest
bun run tsc        # tsc --noEmit
bun run biome      # biome check --write
bun run lint       # biome lint + tsc
```

One expectation to set before you run `tsc`: roughly **73 type errors in legacy pages are the accepted baseline**, not regressions. They predate the subtree merge and are tolerated deliberately; only new errors in files you touched count against you. CI (`.github/workflows/admin.yml`) runs tsc → biome → jest → vite build on `apps/admin/**` and `packages/schemas/**` changes.

## How it talks to the API

Two auth realms coexist in the app:

- The **legacy Bearer-token login** (the app's original product backend, generated hey-api client under `src/client/`) gates the shell — layout, legacy pages.
- The **admin session cookie** gates the resource data from this API. `/resources/*` pages render a "Sign in with Google" card when the admin session is missing; the shell keeps working either way. The cookie flow is described in [admin auth](/admin/auth/).

All admin-realm calls go through `apps/admin/src/refine/http.ts`, which:

- sends `credentials: 'include'` so the `admin_session` cookie rides along
- adds `X-Requested-With` on writes (the CSRF requirement)
- maps the API's error envelope to Refine's `HttpError`

Never use the generated hey-api client for admin resources — it belongs to the other realm.

Environment wiring:

```bash
# apps/admin/.env
VITE_ADMIN_API_URL=http://localhost:3000/api   # must include the API's API_BASE_PATH

# apps/api/.env
ADMIN_URL=http://localhost:8000
```

## Boot sequence

A pathless route wrapper (`RefineRoot` + `adminBootLoader` in `src/refine/`) fetches `GET /admin/auth/me` and `GET /admin/meta/resources` in parallel — it never throws, so a missing session degrades to the sign-in card. The meta payload is validated against `ResourceMetaSchema` from `@starter/schemas`, then bridged through a small zustand store (`refine/adminStore.ts`) to the ProLayout menu, which lives outside the Refine subtree.

From that meta payload the UI derives everything server-driven:

- table columns and form widgets (per field `type` — string, enum, richtext, image, relation, date, …)
- zod validation schemas built from field metadata
- sort/filter/search affordances (only fields flagged `sortable`/`filterable`/`searchable`)
- button visibility, as role × permission via the access-control provider (`useCan`)

Known limits: relation cells in list rows show the raw id (no joins in the generic engine), and search is single-field `like` — the API ANDs flat filters, so multi-field OR search is not expressible; with several `searchable` fields the UI shows a field picker.

## Where pages live

| Location | What it holds |
| --- | --- |
| `apps/admin/src/refine/pages/` | The generic CRUD machinery: `ResourceList.tsx`, `ResourceTable.tsx`, `ResourceFormDrawer.tsx`, `ResourceFormBody.tsx`, `fieldWidgets.tsx`, `listCells.tsx`, `AdminSignIn.tsx`, `AdminHome.tsx` |
| `apps/admin/src/refine/` | Providers and glue: `dataProvider.ts`, `authProvider.ts`, `accessControlProvider.ts`, `http.ts`, `adminStore.ts`, `menu.ts`, `RefineRoot.tsx` |
| `apps/admin/src/pages/` | Custom and legacy product pages (Alerts, Reports, Channels, …) |
| `apps/admin/src/components/Form/FormItem.tsx` | The house form bridge every custom form uses |

Generic pages come for free from the registry. When a resource outgrows them, build a bespoke page under `src/pages/` and point the resource at it.

## House convention: forms use react-hook-form + FormItem

Custom forms do **not** use antd's `Form`/`Form.Item`. The house convention is React Hook Form (with `@hookform/resolvers` + Zod) driving raw antd inputs through the `FormItem.tsx` bridge component:

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "antd";
import FormItem from "@/components/Form/FormItem";

const { control, handleSubmit } = useForm({ resolver: zodResolver(schema) });

<FormItem control={control} name="title" label="Title">
  <Input />
</FormItem>
```

The generic resource forms follow the same convention via the `@refinedev/react-hook-form` adapter — `ResourceFormBody.tsx` builds its zod schema from the field metadata and renders each field's widget through the same bridge. If you find older pages using antd `Form`, that is legacy code, not the pattern to copy.

## Adding a resource, end to end

1. Register the resource on the API side — the [3-step recipe](/admin/resource-registry/).
2. Restart the API so the registry (and its cached meta) picks up the def.
3. Refresh the dashboard. The sidebar item, list page, and forms appear, filtered to your role's permissions.

For a complete worked example including a relation dropdown, follow the [posts-with-categories guide](/guides/posts-with-categories/).
