import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Email verification tokens, modeled on refresh_tokens: the raw value is
// returned once (via the verification email) and stored only as a hash.
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the raw token; the raw value transits the email link only.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Single-use: set on redemption, and on invalidation when a resend
    // replaces a user's outstanding tokens.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Verification lookups are by hash; uniqueness also guards against duplicates.
    uniqueIndex("email_verification_tokens_token_hash_idx").on(table.tokenHash),
    // Resend invalidates a user's outstanding tokens in one update.
    index("email_verification_tokens_user_id_idx").on(table.userId),
  ],
);

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;
