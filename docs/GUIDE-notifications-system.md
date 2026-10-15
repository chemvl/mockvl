# Notification System — Developer Guide

How the push notification system works end to end, and how to extend it —
the admin console, its API, and the delivery worker.

The public app-facing API (`/devices` registration, the user inbox under
`/notifications`) and the transactional `notificationsService.sendToUsers()`
seam were removed from this codebase. What remains is the admin push console
(`/admin/notifications`), the `push-send` worker, and the FCM client; the
`devices`/`user_notifications` tables are kept and still written/read by the
worker.

---

## 1. Architecture overview

```
                         ┌──────────────────────────────────────────────┐
Admin console ─session─▶ Admin API (/admin/notifications)               │
                         │            apps/api/src/admin/notifications/ │
                         └──────────────┬───────────────────────────────┘
                                        │ enqueue("push-send", { notificationId })
                                        ▼
                          pg-boss worker (push-send)
                          apps/api/src/jobs/workers/push-send.ts
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
              inbox fan-out                    FCM fan-out (HTTP v1)
              user_notifications rows          apps/api/src/clients/fcm/
                                                        │
                                                        ▼
                                                  device (push)
```

Two entry points create sends; **one worker** delivers them all:

| Producer | Source value | Entry point |
| --- | --- | --- |
| Admin console (campaigns) | `admin` | `POST /admin/notifications` → `/{id}/send` or `/{id}/schedule` |
| Scheduled sends | `admin` | `/{id}/schedule` → pg-boss `startAfter` |

The `system` source value is still in the schema, but nothing in the API
produces it any more.

Key invariants (do not break these when extending):

- **The inbox is the source of truth.** Every targeted user gets a
  `user_notifications` row whether or not the push was delivered. The push is
  a hint; the inbox is the record.
- **Inbox is exactly-once** (unique index on `(notificationId, userId)`);
  **FCM delivery is at-least-once** (a worker retry may re-send pushes and
  slightly inflate counts — accepted trade-off).
- **`pushEnabled` gates FCM only.** Opted-out devices still produce inbox rows.
- **The DB status row is the lock.** Every state transition is a guarded
  `UPDATE ... WHERE status IN (...)`, so concurrent admin actions and the
  worker can never double-run a send.

---

## 2. Data model

Three tables in `apps/api/src/db/schema/`:

### `devices` (`devices.ts`)

One row per FCM token (`token` unique). No API endpoint writes this table any
more (public device registration was removed) — rows must be inserted out of
band (e.g. directly in the DB) for pushes to reach anyone. The worker reads it
and deletes stale tokens.

| Column | Notes |
| --- | --- |
| `userId` | FK → users, cascade delete |
| `token` | FCM registration token, unique index |
| `platform` | enum `ios \| android` |
| `pushEnabled` | per-device opt-out; default `true`; gates FCM only |
| `lastSeenAt` | last registration time |

### `notifications` (`notifications.ts`)

The campaign/send record — one row per notification, shared by admin and
transactional sends.

| Column | Notes |
| --- | --- |
| `source` | `admin` (console) or `system` (backend-triggered) |
| `title`, `body`, `imageUrl?`, `deepLink?` | content |
| `data` | jsonb string→string map, merged into the FCM data payload |
| `audience` | `all` or `users` |
| `userIds` | uuid[] — required iff `audience = "users"` (max 10,000; see `NOTIFICATION_MAX_TARGET_USERS`) |
| `status` | `draft → scheduled → sending → sent \| failed`, plus `canceled` |
| `scheduledAt`, `sentAt` | timestamps |
| `sentCount`, `failedCount` | incremented per page during fan-out (live progress) |
| `bossJobId` | pg-boss job id of a scheduled send, for best-effort cancel |
| `createdByAdminId` | FK → admin_users (null for system sends) |

### `user_notifications` (`user-notifications.ts`) — the inbox

| Column | Notes |
| --- | --- |
| `notificationId`, `userId` | unique pair — makes fan-out retry-safe |
| `readAt` | null = unread; feeds `readCount` in the admin stats. Nothing in the API marks rows read now (the inbox endpoints were removed); the partial unread index remains |

### Status lifecycle

```
draft ──send──▶ sending ──▶ sent
  │                 └─────▶ failed (0 sent while >0 targeted)
  └──schedule──▶ scheduled ──(startAfter fires)──▶ sending ─▶ ...
                     │
                     └──cancel──▶ canceled
```

Editing is allowed only in `draft`/`scheduled`. Deleting only in
`draft`/`canceled`/`failed`. Everything else returns `409 CONFLICT`.

---

## 3. Shared schemas (`packages/schemas/src/`)

All wire shapes live here and are consumed by the API (Zod validation +
OpenAPI) and by the admin UI (via the generated client):

- `notification.ts` — `NotificationCreateSchema`, `NotificationUpdateSchema`,
  `NotificationScheduleSchema`, `NotificationSchema` (wire shape), the
  `NOTIFICATION_*` enum constants, and `notificationFields` (what the admin
  list endpoint accepts for filter/sort).

(`device.ts` and `user-notification.ts` were removed along with the public
device/inbox API.)

Validation worth knowing:

- `audience: "users"` **requires** a non-empty `userIds`; `audience: "all"`
  **forbids** it (superRefine in `NotificationCreateSchema`).
- `title` 1–200 chars, `body` 1–1000, `deepLink` ≤ 500, `imageUrl` must be a
  URL, `data` values ≤ 1000 chars each.

If you change a schema: it flows to the API automatically, but the admin UI
client must be regenerated (`bun run client:generate` in `apps/admin`).

---

## 4. The delivery pipeline (pg-boss worker)

`apps/api/src/jobs/workers/push-send.ts` — registered in **both**
`src/index.ts` (API process) and `src/worker.ts` (dedicated worker process).

Queue settings: `retryLimit: 3`, `retryBackoff: true`,
`expireInSeconds: 3600` (a ~100k-device broadcast takes minutes; the default
15-minute expiration would reap it mid-run).

Handler flow, in order:

1. **Load + status guard.** Terminal statuses (`sent`, `failed`, `canceled`,
   `draft`) ack silently. This guard is also how a canceled scheduled send
   dies even when `boss.cancel` missed the job.
2. **Claim `scheduled` rows** with a guarded UPDATE to `sending` — loses the
   race only if an admin canceled concurrently, in which case it stops.
3. **Inbox fan-out (idempotent).** Targeted sends (`audience: "users"`) write
   an inbox row for every listed user id (narrowed to users that still exist,
   so a stale id cannot FK-fail the job) — device or not. Broadcasts resolve
   to users with ≥ 1 registered device at send time (any `pushEnabled`
   value). Bulk insert with `onConflictDoNothing` — retries never duplicate
   rows.
4. **FCM fan-out.** Keyset-paginates `pushEnabled` devices in pages of 500
   (`DEVICE_PAGE_SIZE`), sends 40 concurrently (`SEND_CONCURRENCY`) via
   `Promise.allSettled`. Tokens FCM reports as `unregistered`/`invalid-token`
   are deleted per page (automatic stale-token cleanup).
5. **Live counters.** `sentCount`/`failedCount` are incremented per page so
   the admin console can poll progress mid-send.
6. **Finalize.** `sent` if anything was delivered (or nothing was targeted),
   `failed` if every send failed; `sentAt` stamped either way.

A thrown error fails the job → pg-boss retries with backoff. Re-entry is safe:
the status guard plus the inbox unique index absorb duplicates (pushes may
re-send — the accepted at-least-once trade-off).

The FCM data payload always carries the reserved keys `notificationId` and
(when set) `deepLink`; campaign-defined `data` keys ride along but reserved
keys win (`buildDataPayload`). Mobile clients depend on this contract.

---

## 5. FCM client (`apps/api/src/clients/fcm/`)

- `index.ts` — `createPushSender()`: returns the **real FCM client** when all
  three env keys are set, otherwise a **log-only sender** so the template runs
  without Firebase. Everything else (statuses, counters, inbox) behaves
  identically in log-only mode.
- `client.ts` — one POST per token to FCM HTTP v1
  (`/v1/projects/{id}/messages:send`). Per-token failures are **returned as
  data** (`PushSendResult` with `reason: unregistered | invalid-token |
  rate-limited | server | unknown`), never thrown — the worker needs them to
  count and clean up.
- `auth.ts` — service-account OAuth: hand-rolled WebCrypto RS256 JWT wrapped
  in the shared `token-cache.ts` (single-flight, expiry skew). No SDK
  dependency.

Env keys (validated all-or-none in `config/env.ts`):

```
FCM_PROJECT_ID=my-firebase-project
FCM_CLIENT_EMAIL=firebase-adminsdk-...@my-project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."   # \n escapes are unescaped by env.ts
```

Get them from Firebase console → Project settings → Service accounts →
Generate new private key. Local dev without them is fine — sends are logged,
not delivered.

---

## 6. Admin API (`/admin/notifications`)

Custom-mounted routes (NOT the generic CRUD registry — `"notifications"` is in
`RESERVED_RESOURCE_NAMES`). Files:
`apps/api/src/admin/notifications/admin-notifications.{routes,service}.ts`,
mounted in `apps/api/src/admin/mount.ts`.

Auth: admin session cookie. Role gates — reads need `requireAdmin("viewer")`,
mutations need `requireAdmin("editor")`.

| Endpoint | Gate | Semantics |
| --- | --- | --- |
| `GET /admin/notifications` | viewer | List; query contract with `notificationFields` (filter by `status`/`source`/`audience`, search `title` via `like`, sort by dates) |
| `POST /admin/notifications` | editor | Create **draft**, `source: admin`, `createdByAdminId` from session |
| `GET /admin/notifications/{id}` | viewer | |
| `PATCH /admin/notifications/{id}` | editor | Only `draft`/`scheduled`, else **409** |
| `DELETE /admin/notifications/{id}` | editor | Only `draft`/`canceled`/`failed`, else **409** |
| `POST .../{id}/send` | editor | Guarded flip `draft\|scheduled → sending`, cancels any pending boss job, enqueues. **202** |
| `POST .../{id}/schedule` | editor | Body `{ scheduledAt }` (future ISO). `draft\|scheduled → scheduled`; enqueues with `startAfter`; re-scheduling withdraws the old job first |
| `POST .../{id}/cancel` | editor | `scheduled → canceled`; best-effort `boss.cancel` (worker status guard is the real safety net) |
| `POST .../{id}/test-send` | editor | Body `{ userId }`. Direct FCM to that user's enabled devices — **no inbox rows, no counters**, works in any status. For verifying real payloads on a device |
| `GET .../{id}/stats` | viewer | `{ targetedDevices, sentCount, failedCount, inboxCount, readCount }` |

Design rule to preserve: **every transition is a guarded UPDATE**
(`updateWhereStatusIn`). Never read-then-write status; the conditional UPDATE
is the concurrency lock. If a guarded update affects 0 rows, throw
`ConflictError` with the current status in the message.

---

## 7. Admin UI (`apps/admin/src/pages/Notifications/`)

A custom console page (not a generic Refine/registry resource). Structure:

| File | Role |
| --- | --- |
| `index.tsx` | ProTable list — server-side pagination/filter/sort via the query contract; status tag colors from `constants.tsx`; row click opens the drawer |
| `FilterBar.tsx` | Title search + status/source selects |
| `ComposeModal.tsx` | react-hook-form + `zodResolver(NotificationCreateSchema)`; data key/value pairs via `useFieldArray`; audience radio + `UserPicker`; optional schedule DatePicker. Create → optionally chain send/schedule |
| `UserPicker.tsx` + `hooks/useUserSearch.ts` | Debounced multi-select over `GET /admin/users?filter[email][like]=` |
| `DetailDrawer.tsx` | Payload preview, stats (polls `refetchInterval` while `status === "sending"`), actions: Send now / Cancel / Duplicate / Test send |
| `service.ts` | Query-option builders over the **generated** hey-api client; `NOTIFICATIONS_LIST_KEY` for invalidation |
| `types.ts`, `constants.tsx` | Page-local types, status color maps |

House rules that apply here:

- **Never hand-write fetches** — use the generated client
  (`src/client/@tanstack/react-query.gen.ts`). After changing admin API
  routes/schemas, regenerate with `bun run client:generate` (reads
  `VITE_APP_API_ENDPOINT`, so the API must be running).
- Forms use **react-hook-form + `src/components/Form/FormItem.tsx`**, never
  antd `Form` logic.
- After a mutation, `queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY })`
  — the key matches partially, covering every filter combination.
- Destructive actions (`cancel`, `delete`) go through antd `Modal.confirm`.
- Static text via `useIntl().formatMessage` with keys in
  `src/store/defaultLang.ts`.
- Viewer-role admins get a read-only page — mutation affordances are hidden
  based on the admin store role, and the API enforces it regardless.

Integration points if you rename/move things: lazy route in
`src/app/router.tsx`, menu entry in the layout, i18n keys in `defaultLang.ts`.

---

## 8. Common recipes

### Add a field to the notification payload (e.g. `category`)

1. Column in `apps/api/src/db/schema/notifications.ts` →
   `bun run db:generate && bun run db:migrate`.
2. Extend schemas in `packages/schemas/src/notification.ts` (Create/Update/
   wire `NotificationSchema`; add to `notificationFields` if filterable).
3. Thread through `admin-notifications.service.ts` (`create`/`update`) and the
   route serializer (`serializeNotification`).
4. If the app must receive it: include it in `buildDataPayload()` in
   `push-send.ts` (FCM `data` values must be **strings**).
5. Admin UI: `bun run client:generate`, then surface it in
   `ComposeModal.tsx`/`DetailDrawer.tsx`.

### Test push delivery end to end in dev

1. Without FCM env: everything works log-only — compose in the console, send,
   watch the worker logs and poll `/{id}/stats` (`inboxCount` shows the inbox
   fan-out).
2. With real FCM env + a dev build of the app: insert a `devices` row for your
   user with the app's FCM token (there is no registration endpoint), then use
   the console's **Test send** with your user id — real payload, no inbox/stat
   pollution.

### Debug "user didn't get a push"

Check in order:

1. Does the user have a `devices` row? (No row → no push. A targeted send
   still writes the inbox row; a broadcast skips device-less users entirely.)
2. Is `pushEnabled` true on it? (False → inbox row only, by design.)
3. Notification `status` — `failed`? Check `failedCount` vs `sentCount` and
   worker logs (`push-send:` prefix, structured with `notificationId`).
4. Token may have gone stale — if FCM said `unregistered`, the device row was
   auto-deleted; it has to be re-inserted (no registration endpoint).
5. OS-level permission denied on the device fails **silently** — FCM accepts
   the message; nothing shows. The inbox row is still written.
6. Broadcasts only reach users with a device registered **at send time** —
   later installs don't see past broadcasts.

---

## 9. Testing map

| Area | Where | Covers |
| --- | --- | --- |
| FCM client | `apps/api/tests/unit` | JWT assembly, token-cache reuse, error→reason mapping, log-only fallback |
| Notification schemas | unit | Enum/pgEnum parity, audience/userIds refinement, `notificationFields` validity |
| Admin service | unit | Every 409 state-transition guard, schedule/cancel, test-send |
| push-send worker | unit | Fake repos + recording sender: both audiences, canceled no-op, stale-token deletion, count math, retry idempotency |
| Repos | `tests/integration` | Keyset device pagination, inbox unique no-op, guarded status transitions, atomic counters |
| Full flow | `tests/e2e` | seeded device → compose → send → worker fan-out → inbox rows + stats; scheduled + cancel-before-fire; viewer 403 |

Run with `bun test` (root). The e2e flow uses the log-only sender, so no
Firebase project is needed. The full phase gate is
`bun run typecheck && bun run lint && bun test`.

---

## 10. Accepted trade-offs (don't "fix" these without a decision)

- **At-least-once FCM delivery**: a worker retry after a mid-run crash re-sends
  earlier pages and can inflate `sentCount`. The inbox stays exactly-once. The
  planned hardening at scale is sharded child jobs + a per-device delivery
  ledger — not needed at current fan-out.
- **Broadcast snapshot semantics**: `audience: "all"` resolves to users with a
  registered device at send time; there is no retroactive inbox backfill.
- **Best-effort `boss.cancel`**: cancel may miss the job; the worker's status
  guard is the authoritative check.
- **No topics/segments**: targeting is broadcast or explicit user IDs (≤ 10k).
  Bigger targeting needs a design pass, not a bigger array.
