import type { Job, PgBoss, Queue, WorkOptions } from "pg-boss";
import type { EmailSender } from "@/clients/email/types";
import { type WelcomeEmailJob, WelcomeEmailJobSchema } from "@/jobs/types";
import { logger } from "@/lib/logger";

export const WELCOME_EMAIL_QUEUE = "welcome-email";

// Retry policy required by the plan: 3 retries with exponential backoff.
// Stored on the queue, so every job inherits it.
export const WELCOME_EMAIL_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  retryLimit: 3,
  retryBackoff: true,
};

export interface WelcomeEmailWorkerDeps {
  // Test seam / future provider hook. Phase 6 ships log-only delivery.
  sendWelcomeEmail?: (job: WelcomeEmailJob) => Promise<void>;
}

async function logOnlyDelivery(job: WelcomeEmailJob): Promise<void> {
  logger.info({ userId: job.userId, email: job.email }, "welcome email sent (log-only)");
}

// Production delivery over the injected sender — the seam this worker shipped
// with in Phase 6, filled in by Phase 11c's Resend client.
export function createWelcomeEmailDelivery(sender: EmailSender) {
  return async (job: WelcomeEmailJob): Promise<void> => {
    await sender.send({
      to: job.email,
      subject: "Welcome!",
      html: `<p>Welcome! Your account is ready.</p>`,
      text: "Welcome! Your account is ready.",
    });
  };
}

// Handlers receive a batch (pg-boss v12); with the default batchSize of 1 the
// array holds one job. A throw fails the whole batch so pg-boss retries it.
export function createWelcomeEmailHandler(deps: WelcomeEmailWorkerDeps = {}) {
  const sendWelcomeEmail = deps.sendWelcomeEmail ?? logOnlyDelivery;
  return async (jobs: Pick<Job<unknown>, "id" | "name" | "data">[]): Promise<void> => {
    for (const job of jobs) {
      const payload = WelcomeEmailJobSchema.parse(job.data);
      await sendWelcomeEmail(payload);
    }
  };
}

export interface RegisterWelcomeEmailWorkerOptions extends WelcomeEmailWorkerDeps {
  // Overridable in tests (e.g. tiny retry delays); production uses the defaults.
  queueOptions?: Omit<Queue, "name">;
  workOptions?: WorkOptions;
}

export async function registerWelcomeEmailWorker(
  boss: PgBoss,
  options: RegisterWelcomeEmailWorkerOptions = {},
): Promise<void> {
  const { queueOptions = WELCOME_EMAIL_QUEUE_OPTIONS, workOptions = {}, ...deps } = options;
  // Create-if-absent: an existing queue keeps its stored options.
  await boss.createQueue(WELCOME_EMAIL_QUEUE, queueOptions);
  await boss.work(WELCOME_EMAIL_QUEUE, workOptions, createWelcomeEmailHandler(deps));
}
