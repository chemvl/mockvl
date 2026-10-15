import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { userNotifications } from "@/db/schema";

// Rows the DB can hand back are inserted in chunks this size.
const INSERT_CHUNK_SIZE = 1000;

export function createUserNotificationsRepo(db: Db) {
  return {
    // Fan-out insert. onConflictDoNothing on (notificationId, userId) makes a
    // job retry a no-op instead of a duplicate inbox entry.
    async insertMany(notificationId: string, userIds: string[]): Promise<void> {
      for (let i = 0; i < userIds.length; i += INSERT_CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + INSERT_CHUNK_SIZE);
        await db
          .insert(userNotifications)
          .values(chunk.map((userId) => ({ notificationId, userId })))
          .onConflictDoNothing({
            target: [userNotifications.notificationId, userNotifications.userId],
          });
      }
    },

    // Delivery stats for the admin console.
    async countByNotification(
      notificationId: string,
    ): Promise<{ inboxCount: number; readCount: number }> {
      const [counted] = await db
        .select({
          inboxCount: count(),
          readCount: sql<number>`count(${userNotifications.readAt})::int`,
        })
        .from(userNotifications)
        .where(eq(userNotifications.notificationId, notificationId));
      return { inboxCount: counted?.inboxCount ?? 0, readCount: counted?.readCount ?? 0 };
    },
  };
}

export type UserNotificationsRepo = ReturnType<typeof createUserNotificationsRepo>;
