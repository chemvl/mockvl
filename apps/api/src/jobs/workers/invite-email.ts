import type { Job, PgBoss, Queue, WorkOptions } from "pg-boss";
import type { EmailSender } from "@/clients/email/types";
import { InviteEmailJobSchema } from "@/jobs/types";
import { logger } from "@/lib/logger";
import { hashOpaqueToken } from "@/modules/auth/auth.tokens";
import type { InviteEmailContext } from "@/modules/workspaces/invites.repo";

export const INVITE_EMAIL_QUEUE = "invite-email";

// Same policy as the welcome email: 3 retries with exponential backoff,
// stored on the queue so every job inherits it.
export const INVITE_EMAIL_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  retryLimit: 3,
  retryBackoff: true,
};

const PRODUCT_NAME = "Mockvl";

export interface InviteEmailWorkerDeps {
  loadInvite: (inviteId: string) => Promise<InviteEmailContext | undefined>;
  sender: EmailSender;
  // APP_URL: the accept page lives at `${appUrl}/invite/{token}`.
  appUrl: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// Why an invite no longer gets its email, or null to send it.
function skipReason(invite: InviteEmailContext | undefined, token: string): string | null {
  if (!invite) return "missing";
  if (invite.acceptedAt !== null) return "accepted";
  if (invite.revokedAt !== null) return "revoked";
  // A resend replaced the token; its own job carries the live one.
  if (hashOpaqueToken(token) !== invite.tokenHash) return "superseded";
  return null;
}

// Handlers receive a batch (pg-boss v12); with the default batchSize of 1 the
// array holds one job. A send failure throws so pg-boss retries; a closed or
// superseded invite is skipped without retry.
export function createInviteEmailHandler(deps: InviteEmailWorkerDeps) {
  const appUrl = deps.appUrl.replace(/\/+$/, "");
  return async (jobs: Pick<Job<unknown>, "id" | "name" | "data">[]): Promise<void> => {
    for (const job of jobs) {
      const { inviteId, token } = InviteEmailJobSchema.parse(job.data);
      const invite = await deps.loadInvite(inviteId);
      const reason = skipReason(invite, token);
      if (reason !== null || !invite) {
        logger.info({ inviteId, reason }, "invite email skipped");
        continue;
      }
      const inviter = invite.inviterName ?? invite.inviterEmail ?? "Someone";
      const url = `${appUrl}/invite/${token}`;
      await deps.sender.send({
        to: invite.email,
        subject: `${inviter} invited you to ${invite.workspaceName} on ${PRODUCT_NAME}`,
        text: `${inviter} invited you to join ${invite.workspaceName} on ${PRODUCT_NAME}: ${url}`,
        html: `<p>${esc(inviter)} invited you to join ${esc(invite.workspaceName)} on ${PRODUCT_NAME}. <a href="${esc(url)}">Accept the invite</a></p>`,
      });
      logger.info({ inviteId }, "invite email sent");
    }
  };
}

export interface RegisterInviteEmailWorkerOptions extends InviteEmailWorkerDeps {
  // Overridable in tests (e.g. tiny retry delays); production uses the defaults.
  queueOptions?: Omit<Queue, "name">;
  workOptions?: WorkOptions;
}

export async function registerInviteEmailWorker(
  boss: PgBoss,
  options: RegisterInviteEmailWorkerOptions,
): Promise<void> {
  const { queueOptions = INVITE_EMAIL_QUEUE_OPTIONS, workOptions = {}, ...deps } = options;
  // Create-if-absent: an existing queue keeps its stored options.
  await boss.createQueue(INVITE_EMAIL_QUEUE, queueOptions);
  await boss.work(INVITE_EMAIL_QUEUE, workOptions, createInviteEmailHandler(deps));
}
