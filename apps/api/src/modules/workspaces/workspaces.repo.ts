import type { Workspace, WorkspaceRole } from "@starter/schemas";
import { and, asc, eq, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  mocks,
  users,
  workspaceAuditEvents,
  workspaceInvites,
  workspaceMemberExits,
  workspaceMembers,
  workspaceSlugHistory,
  workspaces,
} from "@/db/schema";
import {
  isConsumerEmailDomain,
  LAST_ACTIVE_THROTTLE_MINUTES,
  MAX_MEMBERS_PER_WORKSPACE,
  SLUG_RESERVATION_DAYS,
} from "./workspaces.constants";

export const mockCount = sql<number>`(
  select count(*)::int from ${mocks} where ${mocks.workspaceId} = ${workspaces.id}
)`;

// Raw alias: the membership queries already join workspace_members.
export const memberCount = sql<number>`(
  select count(*)::int from workspace_members m2 where m2.workspace_id = ${workspaces.id}
)`;

const membershipColumns = {
  id: workspaces.id,
  slug: workspaces.slug,
  name: workspaces.name,
  role: workspaceMembers.role,
  personalOwnerId: workspaces.personalOwnerId,
  mockCount,
  memberCount,
  domain: workspaces.domain,
  domainJoinEnabled: workspaces.domainJoinEnabled,
  defaultValidate: workspaces.defaultValidate,
  defaultCors: workspaces.defaultCors,
};

type MembershipRow = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  personalOwnerId: string | null;
  mockCount: number;
  memberCount: number;
  domain: string;
  domainJoinEnabled: boolean;
  defaultValidate: boolean;
  defaultCors: boolean;
};

function toWorkspace(row: MembershipRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    personal: row.personalOwnerId !== null,
    mockCount: row.mockCount,
    memberCount: row.memberCount,
    domain: row.domain,
    domainJoinAvailable: !isConsumerEmailDomain(row.domain),
    domainJoinEnabled: row.domainJoinEnabled,
    defaultValidate: row.defaultValidate,
    defaultCors: row.defaultCors,
  };
}

export interface NewWorkspaceInput {
  slug: string;
  name: string;
  ownerId: string;
  // Email domain of the owner; the domain-join match key.
  domain: string;
  personal: boolean;
}

// Plain settings columns; a slug change also records history and audit.
export interface WorkspaceChanges {
  name?: string;
  slug?: { from: string; to: string };
  domainJoinEnabled?: boolean;
  defaultValidate?: boolean;
  defaultCors?: boolean;
}

export interface TransferInput {
  workspaceId: string;
  fromUserId: string;
  toUserId: string;
  // Email domain of the new owner; becomes the domain-join match key.
  toDomain: string;
}

export interface WorkspacesRepo {
  listForUser(userId: string, lastWorkspaceId: string | null): Promise<Workspace[]>;
  findMembership(slug: string, userId: string): Promise<Workspace | undefined>;
  findPersonal(userId: string): Promise<Workspace | undefined>;
  countActiveMemberships(userId: string): Promise<number>;
  touchMembership(workspaceId: string, userId: string): Promise<void>;
  slugTaken(slug: string, exceptWorkspaceId: string | null): Promise<boolean>;
  insertWorkspace(input: NewWorkspaceInput): Promise<Workspace>;
  domainJoinCandidates(domain: string, userId: string): Promise<string[]>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<boolean>;
  findMember(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: WorkspaceRole; email: string } | undefined>;
  updateWorkspace(workspaceId: string, actorId: string, changes: WorkspaceChanges): Promise<void>;
  softDelete(workspaceId: string, actorId: string): Promise<void>;
  transferOwnership(input: TransferInput): Promise<void>;
  leave(workspaceId: string, userId: string): Promise<void>;
  purgeDeleted(cutoff: Date): Promise<number>;
}

export function createWorkspacesRepo(db: Db): WorkspacesRepo {
  // Memberships in live (not soft-deleted) workspaces.
  function memberships(...conditions: SQL[]) {
    return db
      .select(membershipColumns)
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(isNull(workspaces.deletedAt), ...conditions));
  }

  return {
    // Last-used first, then most recently active, then personal, then name.
    async listForUser(userId: string, lastWorkspaceId: string | null): Promise<Workspace[]> {
      const order: SQL[] = [
        sql`${workspaceMembers.lastActiveAt} desc nulls last`,
        sql`${workspaces.personalOwnerId} is null`,
        asc(workspaces.name),
      ];
      if (lastWorkspaceId !== null) {
        order.unshift(sql`${workspaces.id} = ${lastWorkspaceId} desc nulls last`);
      }
      const rows = await memberships(eq(workspaceMembers.userId, userId)).orderBy(...order);
      return rows.map(toWorkspace);
    },

    async findMembership(slug: string, userId: string): Promise<Workspace | undefined> {
      const [row] = await memberships(
        eq(workspaces.slug, slug),
        eq(workspaceMembers.userId, userId),
      ).limit(1);
      return row && toWorkspace(row);
    },

    async findPersonal(userId: string): Promise<Workspace | undefined> {
      const [row] = await memberships(
        eq(workspaces.personalOwnerId, userId),
        eq(workspaceMembers.userId, userId),
      ).limit(1);
      return row && toWorkspace(row);
    },

    async countActiveMemberships(userId: string): Promise<number> {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
      return row?.total ?? 0;
    },

    // Throttled: at most one write per member per LAST_ACTIVE_THROTTLE_MINUTES.
    async touchMembership(workspaceId: string, userId: string): Promise<void> {
      await db
        .update(workspaceMembers)
        .set({ lastActiveAt: sql`now()` })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
            sql`(${workspaceMembers.lastActiveAt} is null or ${workspaceMembers.lastActiveAt} < now() - make_interval(mins => ${LAST_ACTIVE_THROTTLE_MINUTES}))`,
          ),
        );
    },

    // Deleted workspaces keep their slug until the purge; a renamed
    // workspace's old slug stays reserved for SLUG_RESERVATION_DAYS, except
    // for that workspace itself (exceptWorkspaceId) so it can switch back.
    async slugTaken(slug: string, exceptWorkspaceId: string | null): Promise<boolean> {
      const [current] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);
      if (current) return true;
      const [reserved] = await db
        .select({ id: workspaceSlugHistory.id })
        .from(workspaceSlugHistory)
        .where(
          and(
            eq(workspaceSlugHistory.oldSlug, slug),
            sql`${workspaceSlugHistory.changedAt} > now() - make_interval(days => ${SLUG_RESERVATION_DAYS})`,
            sql`${workspaceSlugHistory.workspaceId} is distinct from ${exceptWorkspaceId}`,
          ),
        )
        .limit(1);
      return reserved !== undefined;
    },

    // Workspace + owner membership in one transaction: the deferred
    // single-owner trigger rejects a workspace committed without its owner.
    // A unique violation (slug taken, or this user's personal workspace
    // created concurrently) propagates for the service to resolve.
    async insertWorkspace(input: NewWorkspaceInput): Promise<Workspace> {
      return db.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(workspaces)
          .values({
            slug: input.slug,
            name: input.name,
            ownerId: input.ownerId,
            domain: input.domain,
            personalOwnerId: input.personal ? input.ownerId : null,
          })
          .returning();
        if (!workspace) throw new Error("workspace insert returned no row");
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: input.ownerId, role: "owner" });
        return toWorkspace({ ...workspace, role: "owner", mockCount: 0, memberCount: 1 });
      });
    },

    // Live domain-join workspaces the user could join: not already a member,
    // never left or removed, and below the member cap. Oldest first.
    async domainJoinCandidates(domain: string, userId: string): Promise<string[]> {
      const rows = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.domainJoinEnabled, true),
            eq(workspaces.domain, domain),
            isNull(workspaces.deletedAt),
            sql`not exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaces.id} and ${workspaceMembers.userId} = ${userId})`,
            sql`not exists (select 1 from ${workspaceMemberExits} where ${workspaceMemberExits.workspaceId} = ${workspaces.id} and ${workspaceMemberExits.userId} = ${userId})`,
            sql`${memberCount} < ${MAX_MEMBERS_PER_WORKSPACE}`,
          ),
        )
        .orderBy(asc(workspaces.createdAt));
      return rows.map((row) => row.id);
    },

    // False when the user was already a member.
    async addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<boolean> {
      const inserted = await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId, role })
        .onConflictDoNothing()
        .returning({ userId: workspaceMembers.userId });
      return inserted.length > 0;
    },

    async findMember(workspaceId, userId) {
      const [row] = await db
        .select({ role: workspaceMembers.role, email: users.email })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        )
        .limit(1);
      return row;
    },

    // One transaction so a slug change never lands without its history row
    // (which keeps the old slug reserved) and audit event. A unique violation
    // on the new slug propagates for the service to map.
    async updateWorkspace(workspaceId, actorId, changes) {
      const { slug, ...settings } = changes;
      await db.transaction(async (tx) => {
        await tx
          .update(workspaces)
          .set({ ...settings, ...(slug && { slug: slug.to }) })
          .where(eq(workspaces.id, workspaceId));
        if (!slug) return;
        await tx.insert(workspaceSlugHistory).values({ workspaceId, oldSlug: slug.from });
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "slug_changed",
          details: { from: slug.from, to: slug.to },
        });
      });
    },

    // Soft delete: the purge job removes the row (and its cascade) later.
    // personal_owner_id is cleared so the personal workspace is not recreated
    // while the user still belongs to others.
    async softDelete(workspaceId, actorId) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaces)
          .set({ deletedAt: sql`now()`, personalOwnerId: null })
          .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
          .returning({ slug: workspaces.slug, name: workspaces.name });
        if (!row) return;
        await tx
          .update(workspaceInvites)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(workspaceInvites.workspaceId, workspaceId),
              isNull(workspaceInvites.acceptedAt),
              isNull(workspaceInvites.revokedAt),
            ),
          );
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "workspace_deleted",
          details: { slug: row.slug, name: row.name },
        });
      });
    },

    // Demote before promote: the one-owner partial unique index is checked
    // per statement; the deferred trigger checks owner_id at commit.
    async transferOwnership({ workspaceId, fromUserId, toUserId, toDomain }) {
      await db.transaction(async (tx) => {
        const member = (userId: string) =>
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));
        await tx.update(workspaceMembers).set({ role: "admin" }).where(member(fromUserId));
        await tx.update(workspaceMembers).set({ role: "owner" }).where(member(toUserId));
        // SET expressions read the pre-update row, so domain join survives
        // only when the domain stays the same.
        await tx
          .update(workspaces)
          .set({
            ownerId: toUserId,
            personalOwnerId: null,
            domain: toDomain,
            domainJoinEnabled: sql`${workspaces.domainJoinEnabled} and ${workspaces.domain} = ${toDomain}`,
          })
          .where(eq(workspaces.id, workspaceId));
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId: fromUserId,
          action: "ownership_transferred",
          details: { from: fromUserId, to: toUserId },
        });
      });
    },

    // The exit row keeps domain join from re-adding the user.
    async leave(workspaceId, userId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(workspaceMembers)
          .where(
            and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
          );
        await tx
          .insert(workspaceMemberExits)
          .values({ workspaceId, userId })
          .onConflictDoUpdate({
            target: [workspaceMemberExits.workspaceId, workspaceMemberExits.userId],
            set: { exitedAt: sql`now()` },
          });
      });
    },

    // Hard-deletes workspaces soft-deleted before `cutoff` (mocks, members,
    // invites, exits and slug history cascade; audit rows have no FK and
    // stay) and releases slug reservations older than `cutoff`.
    async purgeDeleted(cutoff) {
      return db.transaction(async (tx) => {
        const purged = await tx
          .delete(workspaces)
          .where(lt(workspaces.deletedAt, cutoff))
          .returning({ id: workspaces.id });
        await tx.delete(workspaceSlugHistory).where(lt(workspaceSlugHistory.changedAt, cutoff));
        return purged.length;
      });
    },
  };
}
