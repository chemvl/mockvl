---
title: Redis
description: Cache reads and coordinate work with Redis while keeping it strictly a cache layer that the system survives losing.
order: 5
---

## The one rule

Redis is a **cache/coordination layer, never a source of truth**. A `FLUSHALL` must never lose data, and every consumer degrades gracefully when Redis is down. Jobs stay on pg-boss in Postgres (see [Background Jobs](/guides/background-jobs/)); admin sessions stay in Postgres; everything Redis holds can be recomputed.

Each consumer has a deliberate failure direction:

| Consumer | Redis down → | Why |
|---|---|---|
| Cache reads (`cached`) | **Fail open** — run against origin | A cache outage may slow reads, never break them |
| Cache invalidation | **Fail open** — swallowed, warn logged | The mutation already committed; TTL bounds staleness |
| Rate limiting | **Fail open** by default (`RATE_LIMIT_FAIL_OPEN=false` to fail closed with 429) | Serving traffic beats blocking it on infra failure |
| Locks (`withLock`) | **Fail closed** — operation rejected | Running a critical section unguarded is worse than a 5xx |
| Idempotency (`idempotent`) | **Fail closed** — operation rejected | A duplicate payment is worse than a retryable error |

## Local setup

Compose Redis (`redis:7-alpine`, appendonly) maps to host port **6380** so it never collides with a natively installed Redis on 6379; `REDIS_URL` in `.env.example` matches:

```bash
docker compose up -d
redis-cli -p 6380 ping   # PONG
```

`GET /api/ready` pings both Postgres and Redis and returns a 503 naming `redis` in `details` when it is unreachable.

The client (`apps/api/src/lib/redis.ts`) is an ioredis singleton tuned for **fast errors over patient retries**: lazy connect, `maxRetriesPerRequest: 1`, a 5s connect timeout, and a capped reconnect backoff — an outage surfaces as a quick error at the call site, not a hang. It is closed during graceful shutdown (order: HTTP → pg-boss → Redis → PG pool).

## Key convention

All cache keys follow one shape:

```text
cache:<area>:<name>:<discriminator>

cache:upstream:acme:widget:123
cache:mocks:route:jane/pet-store
cache:admin:meta:resources:viewer
```

Never embed raw user input in the discriminator — use ids or a hash. `invalidate()` treats any `*` in an entry as a glob pattern, so a literal `*` from user input would turn an exact delete into a keyspace sweep.

Other prefixes you will see in the keyspace: `rl:global:` / `rl:auth:` (rate-limit counters), `lock:` (distributed locks), `idem:` (idempotency markers), `cachefill:` (cross-process fill dedup locks).

## Read-through caching

Wrap any expensive read with `cached()` from `apps/api/src/lib/cache.ts`; invalidate from the **service** that mutates the data — never from routes or repos:

```typescript
import { cached, invalidate } from "@/lib/cache";
import { mockRouteCacheKey } from "@/modules/mocks/mocks.cache";

// In a service or resolver:
const route = await cached(mockRouteCacheKey(wsSlug, mockSlug), ttlS, () =>
  mocksRepo.findRoute(wsSlug, mockSlug),
);

// In the mutation method of the owning service, after the write commits:
await invalidate(mockRouteCacheKey(ws.slug, slug));
```

How it behaves:

- **Miss** → run `fn`, store the JSON-serialized result with the TTL, return it. Values must be plain JSON data.
- **Redis error** → warn once (`CACHE_READ_FAILED`, edge-triggered so a sustained outage doesn't spam logs) and fall through to `fn`. Never handle cache errors at call sites — the helper already does.
- **Concurrent callers of one key** share a single in-process `fn` run (anti-stampede).
- **`{ lock: true }`** as the fourth argument adds cross-process fill dedup via `withLock`: while one process fills the key, a contending process computes without caching instead of stampeding the origin. Off by default.
- **`invalidate(...)`** takes exact keys (one `DEL`) and `*` patterns; failures are swallowed with a warn because the mutation already committed.

Worked examples in the codebase: `GET /admin/meta/resources` is served through `cached()` per role under `cache:admin:meta:resources:<role>`; and the mock runtime's route resolver (`modules/mock-runtime/route-resolver.ts`) caches each published mock under `cache:mocks:route:<ws>/<slug>` (misses included), which `mocks.service.ts` invalidates on every management mutation. Third-party provider reads you add follow the same shape under `cache:upstream:<provider>:<name>:<discriminator>` (see [Third-Party API Clients](/guides/third-party-clients/)).

## L1 micro-cache and stale-while-revalidate

Two layers sit on top of the Redis tier so origin load scales with **keys ÷ TTL instead of request rate** — the property that lets a hot list survive a burst of hundreds of thousands of users:

- **L1 (in-process promise micro-cache).** Every `createCache` instance keeps a promise map: concurrent callers of one key always share one fetch, and a *settled* result keeps serving for `l1TtlMs` (default 200 ms, size-bounded FIFO). A burst of identical reads costs about one Redis round-trip per 200 ms per process — and because L1 is pure in-process, it keeps absorbing bursts even while Redis is down. One rule for callers: **treat cached values as frozen** — L1 hits hand the same object reference to every caller, so never mutate a row returned from a cached read.
- **SWR (`{ swr: true }`).** Entries carry a logical expiry (`staleAt`) and live physically for 2× the TTL. A read past `staleAt` returns the stale value *immediately* and refreshes in the background under a cross-process `cachefill:` lock — end users never pay origin latency on a warm key, and the origin sees at most ~one refresh per key per TTL cluster-wide. If the refresh fails, the stale value keeps serving until physical expiry (`CACHE_REFRESH_FAILED` in the logs).

The effective staleness budget is `ttlS + l1TtlMs`, stretching to 2×`ttlS` while the origin is failing. Don't mix `swr: true` and plain reads on one key — an entry written with SWR but read without it serves as fresh up to the 2× physical TTL.

`invalidate()` purges matching L1 entries synchronously before touching Redis: reads *starting* after `await invalidate()` are fresh in this process; other processes are bounded by their `l1TtlMs`.

## SCAN, never KEYS

`KEYS` blocks Redis for the whole keyspace walk — with a large keyspace that is a production incident. All runtime code walks patterns with `SCAN` in batches, which is exactly what `invalidate()` does for pattern entries:

```typescript
// inside lib/cache.ts invalidate() — the pattern to copy if you ever walk keys yourself
let cursor = "0";
do {
  const [next, matches] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
  cursor = next;
  if (matches.length > 0) await client.del(...matches);
} while (cursor !== "0");
```

The same applies on the command line when inspecting a live instance: `redis-cli -p 6380 --scan --pattern 'rl:global:*'`, not `KEYS`.

## Rate limiting

The per-IP rate limiter (global tier + strict `/auth/*` tier) uses a shared Redis store (`middleware/rate-limit-redis-store.ts`) so every API instance enforces one budget — a fixed-window counter built from `INCR` + `PEXPIRE NX` + `PTTL` in one `MULTI`. It **requires Redis ≥ 7.0** (`PEXPIRE … NX`); against an older server every increment errors and, with the fail-open default, rate limiting is silently disabled with only `RATE_LIMIT_STORE_DOWN` logs as the signal.

On a Redis outage the limiter fails open by default: the request is served and `RATE_LIMIT_STORE_DOWN` is logged. Set `RATE_LIMIT_FAIL_OPEN=false` to fail closed with a 429 instead. Limits and windows are env-tunable — see [Environment Reference](/architecture/env-reference/).

## Coordination primitives

`apps/api/src/lib/primitives.ts` exports two fail-closed primitives. Both reject the operation when Redis cannot confirm state — never run a guarded operation unguarded.

### Distributed lock

One holder at a time across every instance; contested callers get a 409:

```typescript
import { withLock } from "@/lib/primitives";

await withLock(`billing:invoice:${invoiceId}`, 30_000, async () => {
  // critical section — the lock auto-expires after ttlMs if this crashes
});
// throws ConflictError("LOCKED") if someone else holds it — map or retry in the caller
```

Implementation: `SET lock:<key> <token> NX PX <ttl>`, released by a Lua script that compares the token first — so a holder whose TTL expired mid-run can never delete someone else's lock. A failed release is only logged; the TTL frees the lock eventually.

### Idempotency

Run once per key; replay the stored result on retries — built for webhooks and payments:

```typescript
import { idempotent } from "@/lib/primitives";

const receipt = await idempotent(`webhook:${eventId}`, 24 * 60 * 60, () =>
  processPayment(event),
);
```

Semantics:

- First call stores a `pending` marker, runs `fn`, then stores the serialized result under the TTL.
- A replay after success returns the stored result without running `fn`.
- A concurrent duplicate while the first run is still pending gets a `ConflictError` (409).
- If `fn` throws, the marker is cleared so a retry can run.
- Results must be plain JSON data.

## Troubleshooting

- **`/ready` returns 503 naming `redis`** — Redis isn't up: `docker compose up -d`, then `docker compose ps`.
- **Redis down but traffic still flows** — by design. Cache reads fall through to origin (`CACHE_READ_FAILED` warn), rate limiting fails open (`RATE_LIMIT_STORE_DOWN`) unless `RATE_LIMIT_FAIL_OPEN=false`. Only lock/idempotency call sites see errors.
- **Stale data after a mutation** — the mutating service method probably doesn't call `invalidate()` for that key, or the pattern doesn't match. Staleness is always bounded by the TTL regardless.
- **Hot rate-limit keys under CGNAT traffic** — inspect with `redis-cli -p 6380 --scan --pattern 'rl:global:*'` and size the limits per the guidance in [Troubleshooting](/reference/troubleshooting/).
