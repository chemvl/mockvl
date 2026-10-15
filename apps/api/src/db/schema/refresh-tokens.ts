import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the raw token; the raw value is returned once and never stored.
    tokenHash: text("token_hash").notNull(),
    // One family per login; rotations inherit it. Reuse of a rotated/revoked
    // token revokes the whole family. defaultRandom() only backfills old rows —
    // the auth service always supplies the family explicitly.
    familyId: uuid("family_id").notNull().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // Refresh lookups are by hash; uniqueness also guards against duplicates.
    uniqueIndex("refresh_tokens_token_hash_idx").on(table.tokenHash),
    index("refresh_tokens_user_id_idx").on(table.userId),
    // Reuse detection revokes every active token in a family at once.
    index("refresh_tokens_family_id_idx").on(table.familyId),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
