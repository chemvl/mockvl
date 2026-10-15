import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { createFcmTokenProvider } from "./auth";
import { createFcmClient } from "./client";
import { createLogOnlyPushSender } from "./log-only";
import type { PushSender } from "./types";

export { createFcmTokenProvider } from "./auth";
export { createFcmClient } from "./client";
export { createLogOnlyPushSender } from "./log-only";
export type { PushFailureReason, PushMessage, PushSender, PushSendResult } from "./types";

// Real FCM when the service-account env keys are present (env.ts enforces
// all-or-none), log-only otherwise so the template runs without Firebase.
export function createPushSender(): PushSender {
  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    return createFcmClient({
      projectId: env.FCM_PROJECT_ID,
      tokenProvider: createFcmTokenProvider({
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY,
      }),
    });
  }
  logger.warn("FCM env not configured — push delivery is log-only");
  return createLogOnlyPushSender();
}
