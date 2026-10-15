import { logger } from "@/lib/logger";
import type { PushMessage, PushSender, PushSendResult } from "./types";

// Delivery stand-in used when FCM env is not configured, mirroring the
// welcome-email worker's log-only delivery: the template boots and the full
// send pipeline (inbox fan-out, counts, statuses) works without a Firebase
// project. Never log the device token — treat it like a credential.
export function createLogOnlyPushSender(): PushSender {
  return {
    async send(message: PushMessage): Promise<PushSendResult> {
      logger.info({ title: message.title }, "push sent (log-only)");
      return { ok: true };
    },
  };
}
