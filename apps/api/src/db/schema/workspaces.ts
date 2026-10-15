import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// Same value set as WorkspaceRoleSchema in packages/schemas.
export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "editor", "viewer"]);

export const workspaceAuditAction = pgEnum("workspace_audit_action", [
  "invite_sent",
  "invite_resent",
  "invite_revoked",
  "member_role_changed",
  "member_removed",
  "slug_changed",
  "ownership_transferred",
  "workspace_deleted",
]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // Set only for a user's auto-created personal workspace; unique so a
    // concurrent first visit cannot create two. Cleared on transfer and delete.
    personalOwnerId: uuid("personal_owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    // Mirrors the single owner membership; the deferred single-owner trigger
    // (migration 0011) keeps the two in sync at commit.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Email domain of the owner; the domain-join match key.
    domain: text("domain").notNull(),
    domainJoinEnabled: boolean("domain_join_enabled").notNull().default(false),
    defaultValidate: boolean("default_validate").notNull().default(true),
    defaultCors: boolean("default_cors").notNull().default(true),
    // Soft delete; the purge job removes rows 30 days later. The slug stays
    // reserved until then.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspaces_slug_idx").on(table.slug),
    uniqueIndex("workspaces_personal_owner_idx").on(table.personalOwnerId),
    index("workspaces_domain_join_idx")
      .on(table.domain)
      .where(sql`${table.domainJoinEnabled} and ${table.deletedAt} is null`),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull(),
    // Exposed as joinedAt.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Throttled touch on scoped requests; null until the member's first visit.
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    uniqueIndex("workspace_members_one_owner_idx")
      .on(table.workspaceId)
      .where(sql`${table.role} = 'owner'`),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Always lowercased by the service.
    email: text("email").notNull(),
    role: workspaceRole("role").notNull(),
    // SHA-256 of the opaque token; the raw token only travels in the email job.
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("workspace_invites_role_check", sql`${table.role} <> 'owner'`),
    uniqueIndex("workspace_invites_token_hash_idx").on(table.tokenHash),
    // One open invite per email per workspace; a re-invite resends it.
    uniqueIndex("workspace_invites_open_idx")
      .on(table.workspaceId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
  ],
);

// Old slugs stay reserved for 30 days after a rename.
export const workspaceSlugHistory = pgTable(
  "workspace_slug_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    oldSlug: text("old_slug").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workspace_slug_history_old_slug_idx").on(table.oldSlug)],
);

// Users who left or were removed; domain join never re-adds them. Accepting an
// invite deletes the row.
export const workspaceMemberExits = pgTable(
  "workspace_member_exits",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exitedAt: timestamp("exited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const workspaceAuditEvents = pgTable(
  "workspace_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No FK: audit rows outlive the workspace purge.
    workspaceId: uuid("workspace_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: workspaceAuditAction("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workspace_audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type WorkspaceSlugHistoryRow = typeof workspaceSlugHistory.$inferSelect;
export type WorkspaceMemberExitRow = typeof workspaceMemberExits.$inferSelect;
export type WorkspaceAuditEventRow = typeof workspaceAuditEvents.$inferSelect;
