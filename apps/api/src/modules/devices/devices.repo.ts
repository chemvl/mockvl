import { and, asc, count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { devices } from "@/db/schema";

type DeviceRow = typeof devices.$inferSelect;

export interface DeviceTokenPageParams {
  // null = all users (broadcast); otherwise restrict to these user ids.
  userIds: string[] | null;
  // Keyset cursor: the last id of the previous page, null for the first page.
  afterId: string | null;
  limit: number;
}

export function createDevicesRepo(db: Db) {
  // Push targeting always excludes opted-out devices; the inbox does not.
  function pushTargetWhere(userIds: string[] | null) {
    return and(
      eq(devices.pushEnabled, true),
      ...(userIds ? [inArray(devices.userId, userIds)] : []),
    );
  }

  return {
    async listTokensPage(
      params: DeviceTokenPageParams,
    ): Promise<Pick<DeviceRow, "id" | "token" | "userId">[]> {
      return db
        .select({ id: devices.id, token: devices.token, userId: devices.userId })
        .from(devices)
        .where(
          and(
            pushTargetWhere(params.userIds),
            ...(params.afterId ? [gt(devices.id, params.afterId)] : []),
          ),
        )
        .orderBy(asc(devices.id))
        .limit(params.limit);
    },

    // Users who currently have the app installed (any device, opted out or
    // not) — the inbox audience for a broadcast.
    async distinctUserIds(userIds: string[] | null): Promise<string[]> {
      const rows = await db
        .selectDistinct({ userId: devices.userId })
        .from(devices)
        .where(userIds ? inArray(devices.userId, userIds) : undefined);
      return rows.map((row) => row.userId);
    },

    async countPushTargets(userIds: string[] | null): Promise<number> {
      const [counted] = await db
        .select({ total: count() })
        .from(devices)
        .where(pushTargetWhere(userIds));
      return counted?.total ?? 0;
    },

    // Stale-token cleanup: FCM said these tokens no longer exist.
    async deleteByTokens(tokens: string[]): Promise<void> {
      if (tokens.length === 0) return;
      await db.delete(devices).where(inArray(devices.token, tokens));
    },

    async listEnabledByUser(userId: string): Promise<DeviceRow[]> {
      return db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.pushEnabled, true)));
    },
  };
}

export type DevicesRepo = ReturnType<typeof createDevicesRepo>;
