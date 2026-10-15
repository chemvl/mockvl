import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { notifications } from "./notifications";
import { users } from "./users";

// Per-user inbox record. One row per (notification, user) — the unique index
// makes the send worker's fan-out insert idempotent across job retries.
export const userNotifications = pgTable(
  "user_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Null = unread.
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_notifications_notification_user_idx").on(table.notificationId, table.userId),
    index("user_notifications_user_created_idx").on(table.userId, table.createdAt),
    // Partial index on unread rows (served the removed user inbox API; kept
    // with the table).
    index("user_notifications_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
  ],
);

export type UserNotificationRow = typeof userNotifications.$inferSelect;
export type NewUserNotificationRow = typeof userNotifications.$inferInsert;
