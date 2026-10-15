---
title: Phase 10 — admin integration
description: Why Refine was integrated headless into the existing Ant Design Pro app, the confirmed decisions, and the deviations from the original plan.
order: 2
---

Historical record — describes decisions as they were made in July 2026.

## Context

By the time Phase 10 began, phases 1–9 were complete: the API served guarded generic
admin CRUD (`/admin/<resource>`), a role-filtered `GET /admin/meta/resources`, and
Google-OIDC cookie sessions. Phase 10's job was to wire the **existing** `apps/admin`
application to that backend via Refine, so that registering a backend resource produced
a sidebar menu item plus generic list/create/edit pages with zero frontend changes —
the template's headline demo.

The merged app was not a blank Vite scaffold. It was an Ant Design Pro v6 app brought
in via git subtree: React 19, antd ^6.3.7, react-router ^7.15, TanStack Query ^5.100,
Biome, jest, a ProLayout shell with a static menu, and its own Bearer-token auth
against a different backend (the app's original product). Its dev server ran on port **8000**, not
the 5173 the plan assumed.

## Decisions confirmed with the user

1. **Headless Refine.** `@refinedev/core@^5`, `@refinedev/react-router@^2`, and
   `@refinedev/react-hook-form@^5` were installed — but **not** `@refinedev/antd`,
   whose peer dependency (`antd ^5.23`) conflicted with the app's antd 6. Generic pages
   were built from core hooks (`useTable`, `useSelect`, `useCan`) plus raw antd v6
   components; forms used the official headless react-hook-form adapter.
2. **Integrated into the existing shell.** Resource pages rendered inside ProLayout at
   `/resources/:name`; a "Resources" menu group was built from the meta endpoint and
   appended after the app's existing menu pipeline via a small zustand bridge store.
   The two auth realms initially coexisted — legacy Bearer login gating the shell, the
   admin cookie gating the data.
3. **Dedicated admin CI.** `.github/workflows/admin.yml` was added as the path-filtered
   inverse of the API workflow.

## Flagged deviations from the original plan

Each was recorded in the progress log rather than silently absorbed:

- **Form layer.** The plan prescribed "Refine `useForm` + antd Form"; the user
  explicitly directed the house convention instead — react-hook-form through the
  existing `FormItem.tsx` bridge (antd `Form.Item` shell + `useController`). Same antd
  input widgets as the plan's table; only the form-state layer differed.
- **`@refinedev/antd` skipped**, per the version-conflict resolution above (the plan
  itself mandated resolving version conflicts before writing providers).
- **Dev port.** `ADMIN_URL=http://localhost:8000`, not the plan's 5173.
- **Naming.** The registry ships `registry.register(def)` rather than the plan's
  `registerAdminResource(def)` — same one-call-per-resource recipe.

## What shipped

A self-contained module tree under `apps/admin/src/refine/`: a plain-fetch HTTP layer
(`credentials: 'include'`, CSRF header on writes, error envelope mapped to Refine's
`HttpError`), a pure query-string translator for the list contract, the
data/auth/access-control/notification providers, meta-driven resource mapping with
boundary Zod validation, and generic `ResourceList`/`ResourceForm` pages with per-type
widgets. Only three existing files were edited (router, layout, i18n keys). 61 jest
tests covered the pure modules; component-level tests were deliberately skipped because
the mocking mass would have dwarfed the code under test.

Notable honest limitations were documented rather than papered over: search is
single-field `like` (the server ANDs filters, so multi-field OR search is not
expressible), and relation list cells show raw ids.

## Outcome

Acceptance was executed in a real browser, not reasoned about: pagination, sorting,
filtering, and search composing server-side; create/edit/delete round-trips; read-only
`users`; in-page 403s; and the CSRF negative check. The headline demo passed —
temporarily registering a third resource def on the backend and refreshing the admin
produced a new menu item and a working list page with zero frontend edits.

Two days later a follow-up retired the dual-login design: the legacy realm was parked and
the `admin_session` cookie now gates the whole shell, with `/user/login` hosting the
single Google sign-in button.

The living documentation for what shipped here is at /admin/frontend/,
/admin/resource-registry/, and /admin/auth/. The broader build narrative is at
/decisions/how-it-was-built/.
