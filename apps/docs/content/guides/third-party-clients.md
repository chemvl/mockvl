---
title: Third-Party API Clients
description: Call an external provider safely — env-validated credentials, a typed client with retries and caching, a mock, and a proxy route.
order: 2
---

This guide shows how to call an external provider safely and expose its data through your own API. The repo ships the generic transport every provider client builds on — `apps/api/src/clients/http.ts` (timeouts, retries, `UpstreamError` mapping), `apps/api/src/clients/token-cache.ts` (OAuth client-credentials tokens), and `apps/api/src/lib/cache.ts` (`cached()`) — but no provider integration of its own besides FCM push. This page walks you through building one on top, file by file, using a hypothetical provider **`acme`** that serves **widgets**, and ends with the last mile: exposing provider data through your own endpoint. Every `acme`/`widgets` file below is code *you* write; substitute your provider's name.

The stack you'll end up with, top to bottom:

```
your route            modules/widgets/widgets.routes.ts   (you write this)
  → service           modules/widgets/widgets.service.ts  (domain errors)
    → provider iface  clients/acme/types.ts               (what services see)
      → real client   clients/acme/client.ts              (auth, zod, cache)
        → transport   clients/http.ts                     (ships: timeout, retry, 502)
```

**The golden rule: the frontend never calls the third party directly.** Your API is the proxy. That keeps credentials server-side, dodges CORS, and gives you one place for retries, caching, and rate limiting.

## The recipe in brief

For a new provider (say, `acme`):

1. Add credentials to `config/env.ts` + `.env.example` (`ACME_BASE_URL`, `ACME_API_KEY`). Never read `process.env` directly.
2. Create `apps/api/src/clients/acme/`:
   - `types.ts` — `interface AcmeClient { ... }` + response types
   - `client.ts` — real implementation built on `createHttpClient()` from `clients/http.ts` (you get timeouts, retry with backoff on 429/5xx, and `UpstreamError` mapping for free)
   - `mock.ts` — a mock implementing the same interface, for tests
3. Inject via the interface into services (factory param) — never import the concrete client in a service.

Rules: never log credentials or raw provider headers; map every provider failure to `UpstreamError` so provider quirks don't leak past the client. The rest of this page expands each step.

## Step 1 — Credentials in config/env.ts (never process.env)

Add your provider's keys to the Zod schema in `apps/api/src/config/env.ts`:

```typescript
ACME_BASE_URL: z.url(),
ACME_API_KEY: z.string().min(1),
```

...and to the root `.env.example` (placeholder values only — never real keys). Env is parsed once at import: a missing key crashes at **boot** with a readable list, not at the first request three days into production. Everything reads `env.X` from `@/config/env`; `process.env` anywhere else fails review. See [Environment Reference](/architecture/env-reference/).

## Step 2 — Wire types + provider interface (types.ts)

Create `apps/api/src/clients/acme/types.ts` to own what the provider's API returns:

```typescript
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

Services depend on the **interface**, never on the HTTP layer underneath it. That single line of indirection is what makes every consumer testable without network access, and lets you swap providers without touching business logic.

## Step 3 — The real client, built on createHttpClient

`apps/api/src/clients/http.ts` is the transport every provider client builds on. What it gives you for free:

| Concern | Behavior |
|---|---|
| Timeout | Per-attempt `AbortController`, default 10s — covers body reads too |
| Retries | Default 2 extra attempts, **only** on 429 / 5xx / network / timeout — never other 4xx |
| Backoff | Exponential + jitter (`250ms · 2^attempt + jitter`) |
| Errors | Everything maps to `UpstreamError` → your API's **502** envelope |
| Credential safety | Request headers/bodies never appear in errors or logs; a path that resolves off `baseUrl`'s origin is rejected (your API key can't be redirected to another host) |

Your provider client (`apps/api/src/clients/acme/client.ts`) adds three things on top — auth, validation, caching:

```typescript
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

- **Validate every upstream payload with Zod.** `http.json()` returns `unknown` on purpose. Never trust external data (a provider "upgrade" that changes a field becomes a clean 502 with field paths, not `undefined` spreading through your services).
- **`encodeURIComponent` any caller-supplied path segment.**
- **Never put payload values, headers, or the key in an error** — provider name, status, and field paths only.
- **Make every dependency injectable** (`fetchFn`, `cachedFn`, credentials) with env-backed defaults, so production wiring is a zero-arg call and tests need no network or Redis.

> **OAuth providers:** if the provider issues short-lived client-credentials tokens instead of a static key, wrap `createTokenCache({ fetchToken })` from `apps/api/src/clients/token-cache.ts` — it caches the token in memory until 30s before expiry, refreshes transparently, and single-flights concurrent refreshes. Resolve the `authorization` header per request from `getToken()` instead of a fixed `headers` entry.

## Step 4 — The mock

Write `apps/api/src/clients/acme/mock.ts`: an in-memory `AcmeClient` (e.g. `createMockAcmeClient({ widgets: [...] })`) seeded with fixtures. The important detail: **an unknown id must throw the exact `UpstreamError` shape the real client throws on an upstream 404** (`provider` + `status: 404` in the details, so `getUpstreamStatus()` reads it) — that way service tests exercise the same error path production hits. Every provider you add gets a mock implementing the same interface; tests and local dev never touch the real API. The FCM client follows the same idea: `clients/fcm/` pairs the real sender with a log-only fallback, and tests use fakes of the same interface.

## Step 5 — Caching (already in the client above)

Third-party reads are the canonical `cached()` use case (see [Redis](/guides/redis/)):

- Key convention: `cache:upstream:<provider>:<name>:<discriminator>`.
- TTL: `env.CACHE_DEFAULT_TTL_S` (default 300s) unless the data demands otherwise.
- **Failure stance: the cache fails open.** Redis down → the read runs against the provider and a `CACHE_READ_FAILED` warning is logged once. Never handle cache errors at call sites; `lib/cache.ts` already does.

## Step 6 — Service: translate provider failures into domain meaning

Create `apps/api/src/modules/widgets/widgets.service.ts`:

```typescript
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

This is the one place upstream statuses get domain meaning: *their* 404 is *our* "this widget does not exist" (→ our 404 envelope). Everything else — timeouts, 5xx, invalid payloads — stays `UpstreamError` and surfaces as our 502. `getUpstreamStatus()` (from `@/clients/http`) is the typed accessor; don't dig into `error.details` by hand.

## Step 7 — The last mile: your proxy route

Create `apps/api/src/modules/widgets/widgets.routes.ts`. One deliberate choice: define a **separate response schema** instead of reusing the provider's `WidgetSchema` — your API contract should never be coupled to a vendor's wire format (when they rename a field, you fix the client mapping, not your public API):

```typescript
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

Then wire it like every other module — the three steps documented in `apps/api/src/modules/index.ts` (service slot in `ModuleServices`, default wiring in `app.defaults.ts`, one `app.route()` in `mountModules`):

```typescript
// modules/index.ts — ModuleServices gains: widgetsService: WidgetsService;
// (CreateAppOptions inherits the injection slot via Partial<ModuleServices>.)

// app.defaults.ts — default wiring:
//   widgetsService: createWidgetsService({ acmeClient: createAcmeClient() })
// Tests inject: createWidgetsService({ acmeClient: createMockAcmeClient({ widgets: [...] }) })

// modules/index.ts — in mountModules:
app.route("/widgets", createWidgetsRoutes(services.widgetsService));
```

Now `GET /api/widgets/:id` serves provider data through every guard your own endpoints get: rate limiting, request ids, the envelope contract, and docs. Declaring the 502 response in the route def documents the failure mode to frontend developers — an upstream outage is a *normal, contractual* response they must handle, not a surprise.

## Step 8 — Tests

Write one test file per layer. The transport's own suite is the template for stubbing the network:

- **Transport** (`tests/unit/http-client.test.ts`, ships with the repo): a `scriptedFetch` stub returns a sequence of `Response`s / network errors / hangs, with injected `sleepFn`/`randomFn` so retries and backoff are asserted without real delays. It also asserts a serialized error **never contains the API key or auth header** — keep that assertion in any client you write.
- **Provider client** (you write, e.g. `tests/unit/acme-client.test.ts`): stubbed `fetchFn` + recording/serving `cachedFn` fakes — assert the bearer header, the cache key, malformed payload → `UpstreamError`, cache hit skips the network, and that the key never appears in a serialized error.
- **Service** (you write, e.g. `tests/unit/widgets-service.test.ts`): `createMockAcmeClient` seeded with fixtures; assert the upstream 404 → `NotFoundError` translation and that other upstream failures pass through unchanged.
- **Route e2e** (you write): build the app with a mock-backed service — `createApp({ widgetsService: createWidgetsService({ acmeClient: createMockAcmeClient(...) }) })` — and assert `/api/widgets/known` → 200 envelope, `/api/widgets/unknown` → 404 envelope. E2E never talks to the real provider.

## Best practices checklist

- [ ] Credentials only via `config/env.ts` + `.env.example` placeholders.
- [ ] Transport is always `createHttpClient` — never raw `fetch` to a provider.
- [ ] Every upstream payload validated with Zod; mismatch → `UpstreamError`.
- [ ] Services depend on the provider **interface**; a mock exists from day one.
- [ ] Reads cached under `cache:upstream:...` keys; cache failures fall through.
- [ ] Upstream statuses get domain meaning in the **service**, nowhere else.
- [ ] Your response schema is yours, not the vendor's.
- [ ] No credential, header, or payload value can reach a log or error message.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Boot crash listing env var names | New keys missing from `.env` — copy from `.env.example` |
| 502 `{ provider: "..." }` envelope | The third party failed/timed out after retries — check its status page; your API behaved correctly |
| 502 `unexpected response shape` | Provider changed its payload — update the client's Zod schema + mapping |
