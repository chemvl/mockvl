import type { SendOptions } from "pg-boss";
import { z } from "zod";

// Job payloads cross a process boundary (Postgres), so they are validated on
// the way out of the queue exactly like any other external input.
export const WelcomeEmailJobSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
});

export type WelcomeEmailJob = z.infer<typeof WelcomeEmailJobSchema>;

// Scheduled (cron) job — no payload beyond the tick itself.
export const FlushMockUsageJobSchema = z.object({});

export type FlushMockUsageJob = z.infer<typeof FlushMockUsageJobSchema>;

// Scheduled (cron) job — no payload beyond the tick itself.
export const PurgeDeletedWorkspacesJobSchema = z.object({});

export type PurgeDeletedWorkspacesJob = z.infer<typeof PurgeDeletedWorkspacesJobSchema>;

// The raw invite token travels only here (the DB keeps its SHA-256). The
// worker re-reads the invite and skips it once accepted, revoked or
// superseded by a resend (hash mismatch).
export const InviteEmailJobSchema = z.object({
  inviteId: z.uuid(),
  token: z.string().min(20),
});

export type InviteEmailJob = z.infer<typeof InviteEmailJobSchema>;

// The payload stays a pointer — the worker re-reads the notification row, so
// edits made between enqueue (scheduled sends) and delivery are honored and
// the status column can act as the cancel/concurrency guard.
export const PushSendJobSchema = z.object({
  notificationId: z.uuid(),
});

export type PushSendJob = z.infer<typeof PushSendJobSchema>;

// One entry per queue: the payload type enqueue() and the worker agree on.
// Adding a job = add its schema above and an entry here.
export interface JobPayloads {
  "welcome-email": WelcomeEmailJob;
  "push-send": PushSendJob;
  "flush-mock-usage": FlushMockUsageJob;
  "purge-deleted-workspaces": PurgeDeletedWorkspacesJob;
  "invite-email": InviteEmailJob;
}

export type JobName = keyof JobPayloads;

// The seam services depend on. It is a plain function type so services stay
// free of pg-boss imports and tests can pass a recording mock.
export type Enqueue = <N extends JobName>(
  name: N,
  data: JobPayloads[N],
  options?: SendOptions,
) => Promise<string | null>;

// Best-effort cancel of a queued (not yet active) job — used to withdraw
// scheduled push sends. Same plain-function-seam rationale as Enqueue.
export type CancelJob = (name: JobName, jobId: string) => Promise<void>;
