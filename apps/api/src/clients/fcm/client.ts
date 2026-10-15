// FCM HTTP v1 sender: one POST per message (the legacy batch endpoint was
// removed in June 2024). Uses fetch directly instead of clients/http.ts
// because per-token FCM errors are expected data for the send pipeline —
// they must map to PushSendResult, never throw.

import type { FcmTokenProvider } from "./auth";
import type { PushFailureReason, PushMessage, PushSender, PushSendResult } from "./types";

const FCM_BASE_URL = "https://fcm.googleapis.com";

interface FcmErrorPayload {
  error?: {
    status?: string;
    details?: { errorCode?: string }[];
  };
}

// google.firebase.fcm.v1.FcmError errorCode / google.rpc status → reason.
function mapFcmError(httpStatus: number, payload: FcmErrorPayload): PushFailureReason {
  const status = payload.error?.status ?? "";
  const errorCode = payload.error?.details?.find((detail) => detail.errorCode)?.errorCode ?? "";
  if (errorCode === "UNREGISTERED" || status === "NOT_FOUND" || httpStatus === 404) {
    return "unregistered";
  }
  if (errorCode === "INVALID_ARGUMENT" || status === "INVALID_ARGUMENT") {
    return "invalid-token";
  }
  if (errorCode === "QUOTA_EXCEEDED" || status === "RESOURCE_EXHAUSTED" || httpStatus === 429) {
    return "rate-limited";
  }
  if (status === "UNAVAILABLE" || status === "INTERNAL" || httpStatus >= 500) {
    return "server";
  }
  return "unknown";
}

export interface FcmClientOptions {
  projectId: string;
  tokenProvider: FcmTokenProvider;
  fetchFn?: typeof fetch;
}

export function createFcmClient(options: FcmClientOptions): PushSender {
  const { projectId, tokenProvider, fetchFn = fetch } = options;
  const sendUrl = `${FCM_BASE_URL}/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  return {
    async send(message: PushMessage): Promise<PushSendResult> {
      const accessToken = await tokenProvider.getToken();
      const response = await fetchFn(sendUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: {
              title: message.title,
              body: message.body,
              ...(message.imageUrl ? { image: message.imageUrl } : {}),
            },
            data: message.data,
            android: { priority: "HIGH" },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      });
      if (response.ok) {
        return { ok: true };
      }
      let payload: FcmErrorPayload = {};
      try {
        payload = (await response.json()) as FcmErrorPayload;
      } catch {
        // Non-JSON error body — fall through to the HTTP-status mapping.
      }
      return { ok: false, reason: mapFcmError(response.status, payload) };
    },
  };
}
