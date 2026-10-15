---
title: Background Jobs
description: Define, enqueue, and run pg-boss jobs with typed payloads, retries with backoff, and a separate worker process for production.
order: 4
---

## How jobs run

Background jobs run on [pg-boss](https://github.com/timgit/pg-boss). Queues live in Postgres — pg-boss creates its own `pgboss` schema on `DATABASE_URL` — so there is no extra broker to operate. Redis is not involved in job processing at all (see [Redis](/guides/redis/) for what Redis is actually used for).

Two processes can consume jobs:

- **Dev:** `bun run dev` starts the API with workers registered **in-process** — enqueue a job, and the same process picks it up.
- **Production:** `bun run worker` starts `apps/api/src/worker.ts`, a worker-only entry that boots pg-boss and registers every worker without the HTTP server. Same Docker image, different command (`bun run src/worker.ts`).

Both can run at once: pg-boss guarantees each job is delivered to exactly one worker. The worker process handles `SIGINT`/`SIGTERM` gracefully — `stopBoss()` lets active jobs finish (up to a 10s timeout) before exit.

Everything lives in `apps/api/src/jobs/`:

```text
apps/api/src/jobs/
├── types.ts          # payload schemas + JobPayloads map + Enqueue type
├── boss.ts           # pg-boss singleton, enqueue/cancelJob helpers
└── workers/
    ├── welcome-email.ts   # the worked example
    └── push-send.ts       # push notification fan-out
```

## Typed payloads (`types.ts`)

Every job has a Zod payload schema and an entry in the `JobPayloads` name → payload map:

```typescript
// apps/api/src/jobs/types.ts
export const WelcomeEmailJobSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
});
export type WelcomeEmailJob = z.infer<typeof WelcomeEmailJobSchema>;

export interface JobPayloads {
  "welcome-email": WelcomeEmailJob;
  "push-send": PushSendJob;
}

export type Enqueue = <N extends JobName>(
  name: N,
  data: JobPayloads[N],
  options?: SendOptions,
) => Promise<string | null>;
```

Two things fall out of this:

- **Payloads are external input.** They cross a process boundary (Postgres), so workers re-validate them with the schema on the way out of the queue — a malformed payload throws, pg-boss retries, and the job eventually parks in the `failed` state.
- **Services depend on the `Enqueue` function type**, not on pg-boss. Producers stay typed (`enqueue("welcome-email", { userId, email })` won't compile with the wrong payload) and tests inject a recording mock.

## The singleton (`boss.ts`)

`startBoss()` is called once during bootstrap (and in `worker.ts`); `stopBoss()` runs during graceful shutdown. The exported `enqueue` and `cancelJob` helpers resolve the singleton lazily at call time, so services can be constructed before pg-boss has started:

```typescript
// apps/api/src/jobs/boss.ts
export const enqueue: Enqueue = (name, data, options) => getBoss().send(name, data, options);

export const cancelJob: CancelJob = async (name, jobId) => {
  await getBoss().cancel(name, jobId);
};
```

## Defining a worker

`workers/welcome-email.ts` is the pattern every worker follows — queue constants, queue options, a Zod-validated handler behind a test seam, and a `register` function:

```typescript
// apps/api/src/jobs/workers/welcome-email.ts
export const WELCOME_EMAIL_QUEUE = "welcome-email";

// Retries with exponential backoff, stored on the queue so every job inherits it.
export const WELCOME_EMAIL_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  retryLimit: 3,
  retryBackoff: true,
};

export function createWelcomeEmailHandler(deps: WelcomeEmailWorkerDeps = {}) {
  const sendWelcomeEmail = deps.sendWelcomeEmail ?? logOnlyDelivery;
  return async (jobs: Pick<Job<unknown>, "id" | "name" | "data">[]): Promise<void> => {
    for (const job of jobs) {
      const payload = WelcomeEmailJobSchema.parse(job.data); // external input
      await sendWelcomeEmail(payload);
    }
  };
}

export async function registerWelcomeEmailWorker(boss: PgBoss, options = {}): Promise<void> {
  await boss.createQueue(WELCOME_EMAIL_QUEUE, WELCOME_EMAIL_QUEUE_OPTIONS);
  await boss.work(WELCOME_EMAIL_QUEUE, {}, createWelcomeEmailHandler(options));
}
```

Details worth knowing:

- Handlers receive a **batch** (pg-boss v12); with the default `batchSize` of 1 the array holds one job. A throw fails the whole batch, so pg-boss retries it with backoff.
- `createQueue` is create-if-absent — an existing queue keeps its stored options. If you change retry settings for a queue that already exists in your database, update it there too.
- Long-running queues can raise `expireInSeconds`: the `push-send` queue sets it to 3600 because a large fan-out takes minutes and the pg-boss default (15 min) would reap it mid-run.

## Enqueueing from services

Services receive `enqueue` as a factory dependency — never import pg-boss in a service:

```typescript
await enqueue("welcome-email", { userId: user.id, email: user.email });
```

Enqueue failures in request paths are treated as **best-effort**: log them, never turn a failed enqueue into a failed HTTP request. The worked demo: a first-time Google sign-in (`POST /auth/google`) enqueues `welcome-email`, and the worker delivers it — or logs the "sent" line when no email provider is configured.

To schedule a job for later, pass pg-boss `SendOptions`:

```typescript
const jobId = await enqueue("push-send", { notificationId }, { startAfter: scheduledAt });
// keep jobId if you may need to withdraw it later:
await cancelJob("push-send", jobId);
```

`cancelJob` is best-effort — it only cancels jobs that are still queued. Workers that support cancellation must also guard in the handler (the push-send worker checks the notification's status row and acks silently if it was canceled; see [Notifications System](/guides/notifications-system/)).

## Adding a new job end to end

Say you need an `export-report` job:

1. **Payload type** — in `types.ts`, add the schema and map entry:

   ```typescript
   export const ExportReportJobSchema = z.object({ reportId: z.uuid() });
   export type ExportReportJob = z.infer<typeof ExportReportJobSchema>;

   export interface JobPayloads {
     "welcome-email": WelcomeEmailJob;
     "push-send": PushSendJob;
     "export-report": ExportReportJob;   // new
   }
   ```

2. **Worker** — create `workers/export-report.ts` following the welcome-email shape: queue name constant, queue options (`retryLimit: 3`, `retryBackoff: true` is the house default), a handler that `parse`s the payload, and a `registerExportReportWorker(boss)` function. Put real dependencies behind an injectable deps object so unit tests can pass fakes.

3. **Register** it in **both** entry points — `src/index.ts` (API process, so dev picks it up) and `src/worker.ts` (dedicated worker process):

   ```typescript
   await registerExportReportWorker(boss);
   ```

4. **Enqueue** from the service that triggers it, via the injected `enqueue`:

   ```typescript
   await enqueue("export-report", { reportId });
   ```

5. **Test** at two levels:
   - Unit-test the handler directly: `createExportReportHandler({ ...fakes })` and call it with `[{ id, name, data }]` — assert behavior on valid payloads and that malformed payloads throw.
   - Unit-test the producer with a recording `enqueue` mock — assert it was called with the right name and payload.
   - pg-boss lifecycle itself is covered by the integration suite against the compose Postgres; you rarely need to add more there. See [Testing](/guides/testing/).

## Verifying locally

```bash
bun run dev            # workers run in-process; enqueue and watch the logs
bun run worker         # or: worker-only process, no HTTP server
```

Jobs, attempts, and failures are all rows in the `pgboss` schema — `bun run db:studio` or plain SQL works when you need to inspect a stuck job:

```sql
select name, state, retry_count, started_on
from pgboss.job
order by created_on desc
limit 20;
```
