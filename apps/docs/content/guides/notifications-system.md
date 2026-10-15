---
title: Notifications System
description: Server and admin internals of the push notification system — data model, the admin console, the pg-boss delivery pipeline, and the FCM client.
order: 6
---

## Architecture overview

The admin console creates notification rows; **one worker** delivers them:

```text
Admin console ─session─▶ Admin API (/admin/notifications)      admin/notifications/
                              │
                              │ enqueue("push-send", { notificationId })
                              ▼
                    pg-boss worker (push-send)                  jobs/workers/push-send.ts
                    ┌─────────┴─────────┐
                    ▼                   ▼
            inbox fan-out         FCM fan-out (HTTP v1)
            user_notifications    clients/fcm/ → device push
```

| Producer | `source` value | Entry point |
|---|---|---|
| Admin console (campaigns) | `admin` | `POST /admin/notifications` → `/{id}/send` or `/{id}/schedule` |
| Scheduled sends | `admin` | `/{id}/schedule` → pg-boss `startAfter` |

> The client-facing endpoints (device registration under `/devices`, the user inbox under `/notifications`) and the transactional `notificationsService.sendToUsers()` seam were removed from this codebase. The `devices` and `user_notifications` tables, the admin console, the worker, and the FCM client remain; no public API writes `devices` rows or reads the inbox anymore.

Invariants — do not break these when extending:

- **The inbox is the source of truth.** Every targeted user gets a `user_notifications` row whether or not the push was delivered. The push is a hint; the inbox is the record.
- **Inbox is exactly-once** (unique index on `(notificationId, userId)`); **FCM delivery is at-least-once** (a worker retry may re-send pushes and slightly inflate counts — accepted trade-off).
- **`pushEnabled` gates FCM only.** Opted-out devices still produce inbox rows.
- **The DB status row is the lock.** Every state transition is a guarded `UPDATE ... WHERE status IN (...)`, so concurrent admin actions and the worker can never double-run a send.

## Data model

Three tables in `apps/api/src/db/schema/`:

**`devices`** — one row per FCM token (`token` is unique). Columns: `userId` (FK, cascade delete), `token`, `platform` (`ios | android`), `pushEnabled` (per-device opt-out, default `true`, gates FCM only), `lastSeenAt`.

**`notifications`** — the campaign/send record. Columns: `source` (`admin | system`; only the admin console produces rows now), content (`title`, `body`, `imageUrl?`, `deepLink?`, `data` — a jsonb string→string map merged into the FCM data payload), targeting (`audience`: `all | users`, `userIds` uuid[] required iff `audience = "users"`, max 10,000), `status`, `scheduledAt`/`sentAt`, live counters (`sentCount`, `failedCount`), `bossJobId` (for best-effort cancel of a scheduled send), `createdByAdminId`.

**`user_notifications`** — the inbox. `(notificationId, userId)` is unique (makes fan-out retry-safe); `readAt` null means unread. The worker writes these rows and the console's stats read them.

### Status lifecycle

```text
draft ──send──▶ sending ──▶ sent
  │                 └─────▶ failed (0 sent while >0 targeted)
  └──schedule──▶ scheduled ──(startAfter fires)──▶ sending ─▶ ...
                     │
                     └──cancel──▶ canceled
```

Editing is allowed only in `draft`/`scheduled`; deleting only in `draft`/`canceled`/`failed`. Everything else returns `409 CONFLICT`.

## Shared schemas

All wire shapes live in `packages/schemas/src/notification.ts` and are consumed by the API (Zod validation + OpenAPI) and the admin UI (generated client): `NotificationCreateSchema`, `NotificationUpdateSchema`, `NotificationScheduleSchema`, `NotificationSchema`, the `NOTIFICATION_*` enum constants, and `notificationFields`.

Validation worth knowing: `audience: "users"` requires a non-empty `userIds` and `audience: "all"` forbids it (superRefine); `title` 1–200 chars, `body` 1–1000, `deepLink` ≤ 500, `imageUrl` must be a URL, `data` values ≤ 1000 chars each. Schema changes flow to the API automatically, but the admin UI client must be regenerated (`bun run client:generate` in `apps/admin`).

## The delivery pipeline

`apps/api/src/jobs/workers/push-send.ts`, registered in **both** `src/index.ts` (API process) and `src/worker.ts` (dedicated worker) — see [Background Jobs](/guides/background-jobs/) for how workers run. Queue settings: `retryLimit: 3`, `retryBackoff: true`, `expireInSeconds: 3600` (a ~100k-device broadcast takes minutes; the default 15-minute expiration would reap it mid-run).

Handler flow, in order:

1. **Load + status guard.** Terminal statuses (`sent`, `failed`, `canceled`, `draft`) ack silently — this is also how a canceled scheduled send dies even when `boss.cancel` missed the job.
2. **Claim `scheduled` rows** with a guarded UPDATE to `sending`; losing the race means an admin canceled concurrently, so stop.
3. **Inbox fan-out (idempotent).** Targeted sends write an inbox row for every listed user id (narrowed to users that still exist, so a stale id cannot FK-fail the job) — device or not. Broadcasts resolve to users with ≥ 1 registered device at send time. Bulk insert with `onConflictDoNothing`, so retries never duplicate rows.
4. **FCM fan-out.** Keyset-paginates `pushEnabled` devices in pages of 500, sends 40 concurrently via `Promise.allSettled`. Tokens FCM reports as `unregistered`/`invalid-token` are deleted per page — automatic stale-token cleanup.
5. **Live counters.** `sentCount`/`failedCount` are incremented per page so the admin console can poll progress mid-send.
6. **Finalize.** `sent` if anything was delivered (or nothing was targeted), `failed` if every send failed; `sentAt` stamped either way.

A thrown error fails the job and pg-boss retries with backoff. Re-entry is safe: the status guard plus the inbox unique index absorb duplicates (pushes may re-send — the accepted at-least-once trade-off).

The FCM data payload always carries the reserved keys `notificationId` and (when set) `deepLink`; campaign-defined `data` keys ride along but reserved keys win (`buildDataPayload`).

## FCM client

`apps/api/src/clients/fcm/`:

- `index.ts` — `createPushSender()` returns the **real FCM client** when all three env keys are set, otherwise a **log-only sender** so the template runs without Firebase. Statuses, counters, and the inbox behave identically in log-only mode.
- `client.ts` — one POST per token to FCM HTTP v1 (`/v1/projects/{id}/messages:send`). Per-token failures are **returned as data** (`PushSendResult` with `reason: unregistered | invalid-token | rate-limited | server | unknown`), never thrown — the worker needs them to count and clean up.
- `auth.ts` — service-account OAuth: a WebCrypto RS256 JWT wrapped in the shared `token-cache.ts` (single-flight, expiry skew). No Firebase SDK dependency.

Env keys are validated **all-or-none** in `config/env.ts`:

```bash
FCM_PROJECT_ID=my-firebase-project
FCM_CLIENT_EMAIL=firebase-adminsdk-...@my-project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."   # \n escapes are unescaped by env.ts
```

Get them from Firebase console → Project settings → Service accounts → Generate new private key. Local dev without them is fine — sends are logged, not delivered.

## Admin console touchpoints

`/admin/notifications` is custom-mounted (NOT the generic CRUD registry — `"notifications"` is in `RESERVED_RESOURCE_NAMES`). Files: `apps/api/src/admin/notifications/admin-notifications.{routes,service}.ts`, mounted in `admin/mount.ts`. Reads need `requireAdmin("viewer")`, mutations `requireAdmin("editor")`.

Beyond list/create/update/delete (create is always a `draft`; update only in `draft`/`scheduled`, delete only in `draft`/`canceled`/`failed`, else 409), the action endpoints:

| Endpoint | Semantics |
|---|---|
| `POST .../{id}/send` | Guarded flip `draft\|scheduled → sending`, cancels any pending boss job, enqueues. Returns **202** |
| `POST .../{id}/schedule` | Body `{ scheduledAt }` (future ISO); enqueues with `startAfter`; re-scheduling withdraws the old job first |
| `POST .../{id}/cancel` | `scheduled → canceled`; best-effort `boss.cancel` — the worker's status guard is the real safety net |
| `POST .../{id}/test-send` | Body `{ userId }`. Direct FCM to that user's enabled devices — no inbox rows, no counters, any status. For verifying real payloads on a device |
| `GET .../{id}/stats` | `{ targetedDevices, sentCount, failedCount, inboxCount, readCount }` |

Design rule to preserve: **every transition is a guarded UPDATE** (`updateWhereStatusIn`). Never read-then-write status — the conditional UPDATE is the concurrency lock; if it affects 0 rows, throw `ConflictError` with the current status.

The dashboard page (`apps/admin/src/pages/Notifications/`) is a custom console page: ProTable list, compose modal (react-hook-form + `zodResolver(NotificationCreateSchema)`), a detail drawer that polls `/{id}/stats` while `status === "sending"`, and a debounced user picker over `GET /admin/users?filter[email][like]=`. It uses the generated hey-api client only — never hand-written fetches.

## Extending the system

**Add a field to the payload (e.g. `category`):**

1. Column in `db/schema/notifications.ts` → `bun run db:generate && bun run db:migrate`.
2. Extend `packages/schemas/src/notification.ts` (Create/Update/wire schemas; `notificationFields` if filterable).
3. Thread through `admin-notifications.service.ts` and the route serializer.
4. If the app must receive it: add it in `buildDataPayload()` in `push-send.ts` (FCM `data` values must be **strings**).
5. Admin UI: `bun run client:generate`, then surface it in the compose modal / detail drawer.

**Test end to end in dev:** without FCM env everything works log-only — compose in the console, send, watch worker logs, and poll `/{id}/stats`. With real FCM env, use the console's **Test send** with your user id — real payload, no inbox/stat pollution.

**Accepted trade-offs (don't "fix" without a decision):** at-least-once FCM delivery (retries can inflate `sentCount`; the inbox stays exactly-once), broadcast snapshot semantics (no retroactive inbox backfill for later installs), best-effort `boss.cancel` (the status guard is authoritative), and no topics/segments (targeting is broadcast or ≤ 10k explicit user IDs). Background: [Push Notifications decision record](/decisions/push-notifications/).
