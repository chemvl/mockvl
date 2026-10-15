import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

// Valid values live here; wire-level validation uses the matching schemas from
// packages/schemas (same value sets — the notification-schemas test pins them together).
export const notificationSource = pgEnum("notification_source", ["admin", "system"]);
export const notificationAudience = pgEnum("notification_audience", ["all", "users"]);
export const notificationStatus = pgEnum("notification_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "canceled",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "admin" = composed in the admin console; "system" = reserved for
    // backend-triggered sends (no producer in this codebase today).
    source: notificationSource("source").notNull().default("admin"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    // App route the mobile client navigates to on tap, e.g. "/posts/123".
    deepLink: text("deep_link"),
    // String→string map merged into the FCM data payload.
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    audience: notificationAudience("audience").notNull().default("all"),
    // Target user ids; null unless audience = "users".
    userIds: jsonb("user_ids").$type<string[]>(),
    status: notificationStatus("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    // pg-boss job id for a scheduled send; used for best-effort cancel.
    bossJobId: text("boss_job_id"),
    // Null for source = "system".
    createdByAdminId: uuid("created_by_admin_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("notifications_status_idx").on(table.status),
    index("notifications_created_at_idx").on(table.createdAt),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
