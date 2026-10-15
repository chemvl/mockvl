import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Role ordering is viewer < editor < owner; the ordering itself lives in
// admin/auth (roleAtLeast) — the enum only fixes the set of valid values.
export const adminRole = pgEnum("admin_role", ["viewer", "editor", "owner"]);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    role: adminRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive uniqueness, same pattern as users: lookups must
    // compare with lower(email) to hit this index.
    uniqueIndex("admin_users_email_lower_idx").on(sql`lower(${table.email})`),
  ],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
