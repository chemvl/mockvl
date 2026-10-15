// One push message per device token (FCM HTTP v1 has no batch endpoint).
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  // String→string map delivered to the app in the FCM data payload.
  data: Record<string, string>;
}

// Per-token failures are expected data for the send pipeline, not exceptions:
// - "unregistered" / "invalid-token" → the device row should be deleted
// - "rate-limited" / "server" / "unknown" → counted as failed
export type PushFailureReason =
  | "unregistered"
  | "invalid-token"
  | "rate-limited"
  | "server"
  | "unknown";

export type PushSendResult = { ok: true } | { ok: false; reason: PushFailureReason };

export interface PushSender {
  send(message: PushMessage): Promise<PushSendResult>;
}
