# Mockyard Admin

The Mockyard admin dashboard, built on **Vite + React 19 + React Router v7** with [Ant Design 6](https://ant.design/) and [ProComponents v3](https://procomponents.ant.design/), wired to the API via headless Refine.

---

## Tech Stack

| Concern | Choice |
| --- | --- |
| Build tool | Vite 8 (`@vitejs/plugin-react`) |
| UI runtime | React 19 + React Router v7 (`createBrowserRouter`) |
| Components | Ant Design v6 + ProComponents v3 + `antd-style` |
| Icons | Tabler Icons (`@tabler/icons-react`) + Ant Design Icons |
| Client state | Zustand (`src/store/`) |
| Server state | TanStack Query v5 (`@tanstack/react-query`) |
| API client | `@hey-api/openapi-ts` + `@hey-api/client-fetch` (generated into `src/client/`) |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) |
| Charts | Recharts + `@ant-design/plots` / D3 |
| i18n | `react-intl` (`useIntl`) |
| Lint / format | Biome |
| Tests | Jest + Testing Library |
| Package manager | bun |

---

## Prerequisites

- **Node** >= 20
- **[bun](https://bun.sh/)** (used for installs and scripts)
- Access to a backend API endpoint (set via env, see below)

---

## Getting Started

```bash
# 1. Install dependencies
bun install

# 2. Configure environment (see "Environment Variables" below)
#    Create a .env file at the project root.

# 3. Start the dev server (http://localhost:8000)
bun run dev
```

### Environment Variables

Create a `.env` (and optionally `.env.staging`) file in the project root. **Never commit secret
values.** The app reads the following `VITE_*` keys:

| Variable | Purpose |
| --- | --- |
| `VITE_APP_API_ENDPOINT` | Backend API base URL. Vite proxies `/api` to this in dev and the API client is generated against it. |
| `VITE_APP_PROJECT_NAME` | Display/project name. |
| `VITE_BASE_URL` | App base path. |
| `VITE_BASE_URL_PUBLIC` | Public asset base path. |
| `VITE_ENV` | Environment label (e.g. `local`, `staging`). |

---

## Project Structure

```text
src/
├── app/                 # Routing & layout shell
│   ├── router.tsx       # createBrowserRouter — auth-gated routes (lazy-loaded)
│   ├── BasicLayout.tsx  # ProLayout shell
│   ├── menuConfig.ts    # Sidebar menu definition (MenuRoute[])
│   └── DictionaryLoader.tsx
├── client/              # AUTO-GENERATED API client — do NOT edit by hand
│   ├── sdk.gen.ts       # Typed SDK functions
│   ├── types.gen.ts     # Request/response types
│   └── @tanstack/       # Generated queryOptions / mutationOptions
├── store/               # Zustand stores (useAppStore, useUserStore) + i18n defaults
├── pages/               # Co-located page dirs (index.tsx, service.ts, data.d.ts, styles)
├── components/          # Shared layout-level components (import from @/components)
├── services/            # Cross-page service helpers
├── utils/               # Shared utilities (e.g. format.ts)
├── queryClient.ts       # TanStack Query client + 401 / error interceptors
└── main.tsx             # App bootstrap (providers + router)
```

- **Page co-location:** each page directory owns its `index.tsx`, optional `service.ts`,
  `data.d.ts` (types), and styles.
- **Auth-gated shell:** the root route (`/`) loader calls `useUserStore.getState().fetchUserInfo()`;
  failure redirects to `/user/login`. Admin routes throw a redirect to `/exception/403` when
  `selectAccess(...).canAdmin` is false. Path aliases: `@/*` → `src/*`, `@root/*` → project root.

---

## Application Pages

| Route | Page |
| --- | --- |
| `/` | Layout shell (admin session required) |
| `/admin` | Admin (admin-only) |
| `/notifications` | Notifications |
| `/resources/:resource` (+ `/create`, `/edit/:id`) | Refine resource list + form drawer |
| `/user/login` | Login |
| `/user/register` | Register |
| `/user/register-result` | Registration result |
| `/exception/403`, `/exception/404`, `/exception/500` | Exception pages |

---

## Commands

Run with `bun run <script>`.

### Develop & Build

| Command | Description |
| --- | --- |
| `bun run dev` | Start the Vite dev server (port 8000). |
| `bun run build` | Production build (`vite build`). |
| `bun run preview` | Preview the production build locally. |

### Quality

| Command | Description |
| --- | --- |
| `bun run lint` | Biome lint (check only) + `tsc --noEmit`. |
| `bun run biome` | Biome check with auto-fix (`--write`). |
| `bun run biome:lint` | Biome lint only (no write). |
| `bun run tsc` | Type-check only (`tsc --noEmit`). |

### Test

| Command | Description |
| --- | --- |
| `bun run test` | Run all Jest tests. |
| `bun run test:coverage` | Jest with coverage report. |
| `bun run test:update` | Update Jest snapshots. |

Run a single test file:

```bash
npx jest src/pages/user/login/login.test.tsx
```

### Code Generation

| Command | Description |
| --- | --- |
| `bun run client:generate` | Regenerate `src/client/` from `openapi-ts.config.ts`. |

### Deploy

| Command | Description |
| --- | --- |
| `bun run deploy` | `vite build` + publish via `gh-pages`. |

---

## API Client Generation

The typed client in `src/client/` is **auto-generated** by
[`@hey-api/openapi-ts`](https://heyapi.dev/) from `openapi-ts.config.ts` (which reads
`VITE_APP_API_ENDPOINT`). It produces SDK functions, request/response types, and ready-to-use
TanStack Query `queryOptions` / `mutationOptions`.

- **Never edit `src/client/` by hand** — changes are overwritten on regeneration.
- Regenerate after the API schema changes:

```bash
bun run client:generate
```

Use the generated options with `useQuery` / `useMutation`; never hand-roll fetch calls for
endpoints that already exist in the client.

---

## Browsers Support

Modern browsers (per the `defaults` browserslist query).
