import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Same value set as PersonalAccessTokenScopeSchema in packages/schemas.
export const personalAccessTokenScope = pgEnum("personal_access_token_scope", [
  "mocks:read",
  "mocks:write",
]);

export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: personalAccessTokenScope("scope").notNull(),
    // SHA-256 of the full plaintext (prefix included); the plaintext is returned once and never stored.
    tokenHash: text("token_hash").notNull(),
    // Last 4 characters of the plaintext, for display only.
    tokenHint: text("token_hint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("personal_access_tokens_token_hash_idx").on(table.tokenHash),
    index("personal_access_tokens_workspace_user_idx").on(table.workspaceId, table.userId),
  ],
);

export type PersonalAccessTokenRow = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessTokenRow = typeof personalAccessTokens.$inferInsert;
