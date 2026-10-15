import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // Null for accounts created via Google sign-in (the only sign-in path);
    // legacy password accounts keep their hash but can no longer use it.
    passwordHash: text("password_hash"),
    // Google OIDC subject; the stable identity key for Google sign-in.
    googleSub: text("google_sub"),
    // When the mailbox was proven (timestamp, not boolean — null/not-null is
    // the gate). Set at Google sign-in or when a legacy account links Google.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // Google profile, refreshed at each sign-in.
    name: text("name"),
    avatarUrl: text("avatar_url"),
    // Last workspace the user opened; orders GET /workspaces. No FK (avoids a
    // circular schema import); a stale id only affects ordering.
    lastWorkspaceId: uuid("last_workspace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Case-insensitive uniqueness without the citext extension; lookups must
    // compare with lower(email) to hit this index.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`),
    // Unique per Google account; Postgres unique indexes allow multiple NULLs.
    uniqueIndex("users_google_sub_idx").on(table.googleSub),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
