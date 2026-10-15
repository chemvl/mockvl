---
title: Push notifications
description: Design decisions and trade-offs behind the device registry, FCM send pipeline, in-app inbox, and admin notification console.
order: 3
---

Historical record — describes decisions as they were made in July 2026. The living
documentation is at /guides/notifications-system/ (backend). The client-facing device
registration and inbox endpoints described below were later removed when the API was
trimmed to Mockyard; the admin console, `push-send` worker, and FCM client remain.

## Context

The Flutter mobile app needed push notifications, and nothing push-related existed —
the original plan had deliberately deferred delivery integrations. The feature added
device-token registration for mobile users, an FCM (HTTP v1) send pipeline over the
existing pg-boss job system, a per-user in-app inbox, a full custom admin console in
`apps/admin`, and an API contract document for the Flutter team.

## Confirmed decisions

- **Notification types**: admin campaigns, transactional (backend-triggered) sends,
  and scheduled one-shot sends (`scheduledAt`, no recurrence).
- **Provider**: FCM only, HTTP v1, one POST per token (the batch endpoint is dead). A
  log-only sender is used when FCM env keys are absent, so the template boots without
  Firebase.
- **Targeting**: broadcast to all, or an explicit user-ID list. No topics or segments.
- **Delivery semantics**: the in-app inbox is exactly-once; FCM delivery is
  at-least-once — an accepted trade-off.
- **Device registration**: authenticated (JWT) only, with a simple `pushEnabled`
  opt-out per device.
- **Fan-out**: a single chunked job (pages of 500 tokens, ~50 concurrent sends);
  sharding into child jobs was deferred until scale demands it.
- **FCM credentials**: three optional env vars (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
  `FCM_PRIVATE_KEY`), validated all-or-none.
- **OAuth**: a hand-rolled WebCrypto RS256 service-account JWT wrapped in the existing
  token cache — no new dependencies.
- **Admin UI**: a full custom console page, not a generic registry resource — the
  workflow (compose, schedule, cancel, test-send, live stats) doesn't fit generic CRUD.

## Database design

Three tables, following the house pattern (uuid PKs, timezone-aware timestamps, pg
enums):

- **`devices`** — FCM token (unique; re-registering re-points the row to the new
  owner), platform (`ios|android`), `pushEnabled`, `lastSeenAt`, FK to `users` with
  cascade.
- **`notifications`** — source (`admin|system`), title/body/imageUrl/deepLink, a jsonb
  string→string `data` map, audience (`all|users`) with a jsonb `userIds` list, status
  (`draft → scheduled/sending → sent|failed|canceled`), live `sentCount`/`failedCount`,
  `bossJobId` for best-effort cancel, and the creating admin.
- **`user_notifications`** (the inbox) — one row per recipient with nullable `readAt`.
  A unique `(notificationId, userId)` index makes fan-out retry-safe; a partial index
  where `readAt IS NULL` serves the unread count.

## The send pipeline

Sending is a pg-boss job (`push-send`) so it inherits retry with backoff and survives
restarts. The worker's flow was designed to be safe under re-entry:

1. Load the notification and **status-guard**: terminal or draft states ack and
   return; `scheduled` flips to `sending` under a guarded UPDATE — which is both how
   scheduled jobs start and how canceled ones die even if `boss.cancel` was missed.
2. **Inbox fan-out first, idempotently**: recipients resolved (explicit list, or all
   users with a registered device), inserted in 1,000-row chunks with
   `onConflictDoNothing`. `pushEnabled` gates FCM only — the inbox is always written.
3. **FCM fan-out**: keyset-paginated enabled devices in pages of 500, sent
   concurrently; `unregistered`/`invalid-token` responses delete the stale tokens per
   page.
4. Per-page incremental `sentCount` updates give the admin console live progress; a
   final update lands the terminal status and `sentAt`.

Scheduling needed no cron: `enqueue(..., { startAfter: scheduledAt })`, with the job id
persisted for cancel/reschedule. See /guides/background-jobs/ for the underlying job
system.

A transactional seam — `notificationsService.sendToUsers(userIds, payload)` — lets any
backend service trigger a system notification through the same table and pipeline.

## Admin API and console

Admin routes were custom-mounted (the same pattern as `/admin/auth`), not
registry-generated, with `notifications` added to the registry's reserved names. State
transitions are enforced server-side with 409s: only `draft/scheduled` can be edited or
sent, only `scheduled` canceled, only `draft/canceled/failed` deleted. Reads require
`viewer`, mutations `editor`. The console (`apps/admin/src/pages/Notifications/`)
follows house rules — ProTable with real server-side pagination, react-hook-form
compose modal, detail drawer polling stats while a send is in flight.

## Accepted trade-offs

- A job retry can re-send pushes to already-delivered tokens and slightly inflate
  counts; the inbox stays exactly-once. The phase-2 hardening path (child-job sharding
  plus a per-device delivery ledger) was documented but not built.
- A broadcast's inbox covers users with at least one registered device at send time;
  later installs don't see past broadcasts.
- The device-unregister endpoint (since removed) needed a valid JWT, so clients had to
  unregister the device **before** clearing credentials on logout.
