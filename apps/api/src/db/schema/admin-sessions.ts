import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    // HMAC-SHA256 of the raw session token keyed by ADMIN_SESSION_SECRET;
    // the raw value lives only in the httpOnly cookie.
    tokenHash: text("token_hash").notNull(),
    // Sliding: renewed when less than half the lifetime remains.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_idx").on(table.tokenHash),
    index("admin_sessions_admin_user_id_idx").on(table.adminUserId),
  ],
);

export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
