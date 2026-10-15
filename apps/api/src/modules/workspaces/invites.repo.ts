import type { InviteRole } from "@starter/schemas";
import { and, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  users,
  workspaceAuditEvents,
  workspaceInvites,
  workspaceMemberExits,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { memberCount, mockCount } from "./workspaces.repo";

export interface InviteRow {
  id: string;
  workspaceId: string;
  email: string;
  role: InviteRole;
  sentAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

// An invite resolved from its token, with what the accept page shows.
export interface TokenInvite extends InviteRow {
  workspace: { name: string; slug: string; mockCount: number; memberCount: number };
  // Null when the inviting user has since been deleted.
  inviter: { name: string | null; email: string } | null;
}

// What the invite-email worker needs to decide whether to send, and what.
export interface InviteEmailContext {
  email: string;
  tokenHash: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  workspaceName: string;
  inviterName: string | null;
  inviterEmail: string | null;
}

// Fresh token and dates: a new invite or a resend.
export interface InviteIssue {
  role: InviteRole;
  tokenHash: string;
  sentAt: Date;
  expiresAt: Date;
}

export interface NewInvite extends InviteIssue {
  workspaceId: string;
  email: string;
  invitedBy: string;
}

export interface InviteRefresh extends InviteIssue {
  inviteId: string;
  workspaceId: string;
  actorId: string;
}

export interface InviteAcceptance {
  inviteId: string;
  workspaceId: string;
  userId: string;
  role: InviteRole;
  at: Date;
}

export interface InvitesRepo {
  // Open = neither accepted nor revoked (expired ones included). Newest first.
  listOpen(workspaceId: string): Promise<InviteRow[]>;
  countOpen(workspaceId: string): Promise<number>;
  findOpen(workspaceId: string, inviteId: string): Promise<InviteRow | undefined>;
  findOpenByEmails(workspaceId: string, emails: string[]): Promise<InviteRow[]>;
  // Which of `emails` (lowercased) already belong to a member.
  memberEmails(workspaceId: string, emails: string[]): Promise<string[]>;
  // Insert + `invite_sent` audit. A second open invite for the same email
  // is a unique violation, propagated for the service to resolve.
  create(invite: NewInvite): Promise<InviteRow>;
  // New token/dates/role + `invite_resent` audit; undefined when the invite
  // is no longer open.
  refresh(input: InviteRefresh): Promise<InviteRow | undefined>;
  // Sets revoked_at + `invite_revoked` audit; false when not open.
  revoke(workspaceId: string, inviteId: string, actorId: string, at: Date): Promise<boolean>;
  // Skips invites of soft-deleted workspaces.
  findByTokenHash(tokenHash: string): Promise<TokenInvite | undefined>;
  isMember(workspaceId: string, userId: string): Promise<boolean>;
  // False (and no writes) when the invite stopped being open meanwhile.
  accept(input: InviteAcceptance): Promise<boolean>;
  decline(inviteId: string, at: Date): Promise<void>;
  findEmailContext(inviteId: string): Promise<InviteEmailContext | undefined>;
}

const inviteColumns = {
  id: workspaceInvites.id,
  workspaceId: workspaceInvites.workspaceId,
  email: workspaceInvites.email,
  role: workspaceInvites.role,
  sentAt: workspaceInvites.sentAt,
  expiresAt: workspaceInvites.expiresAt,
  acceptedAt: workspaceInvites.acceptedAt,
  revokedAt: workspaceInvites.revokedAt,
};

type SelectedInvite = Omit<InviteRow, "role"> & { role: string };

// workspace_invites_role_check keeps 'owner' out of the table.
function toInvite<T extends SelectedInvite>(row: T): Omit<T, "role"> & { role: InviteRole } {
  return { ...row, role: row.role as InviteRole };
}

const isOpen = and(isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt));

export function createInvitesRepo(db: Db): InvitesRepo {
  function selectOpen(...conditions: (SQL | undefined)[]) {
    return db
      .select(inviteColumns)
      .from(workspaceInvites)
      .where(and(isOpen, ...conditions));
  }

  const invite = (workspaceId: string, inviteId: string) =>
    and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.id, inviteId));

  return {
    async listOpen(workspaceId) {
      const rows = await selectOpen(eq(workspaceInvites.workspaceId, workspaceId)).orderBy(
        desc(workspaceInvites.sentAt),
      );
      return rows.map(toInvite);
    },

    async countOpen(workspaceId) {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(workspaceInvites)
        .where(and(isOpen, eq(workspaceInvites.workspaceId, workspaceId)));
      return row?.total ?? 0;
    },

    async findOpen(workspaceId, inviteId) {
      const [row] = await selectOpen(invite(workspaceId, inviteId)).limit(1);
      return row && toInvite(row);
    },

    async findOpenByEmails(workspaceId, emails) {
      if (emails.length === 0) return [];
      const rows = await selectOpen(
        eq(workspaceInvites.workspaceId, workspaceId),
        inArray(workspaceInvites.email, emails),
      );
      return rows.map(toInvite);
    },

    async memberEmails(workspaceId, emails) {
      if (emails.length === 0) return [];
      const lowerEmail = sql<string>`lower(${users.email})`;
      const rows = await db
        .select({ email: lowerEmail })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(lowerEmail, emails)));
      return rows.map((row) => row.email);
    },

    async create({ workspaceId, email, role, tokenHash, invitedBy, sentAt, expiresAt }) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(workspaceInvites)
          .values({ workspaceId, email, role, tokenHash, invitedBy, sentAt, expiresAt })
          .returning(inviteColumns);
        if (!row) throw new Error("invite insert returned no row");
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId: invitedBy,
          action: "invite_sent",
          details: { email, role },
        });
        return toInvite(row);
      });
    },

    async refresh({ inviteId, workspaceId, actorId, role, tokenHash, sentAt, expiresAt }) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceInvites)
          .set({ role, tokenHash, sentAt, expiresAt })
          .where(and(isOpen, invite(workspaceId, inviteId)))
          .returning(inviteColumns);
        if (!row) return undefined;
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "invite_resent",
          details: { email: row.email, role },
        });
        return toInvite(row);
      });
    },

    async revoke(workspaceId, inviteId, actorId, at) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceInvites)
          .set({ revokedAt: at })
          .where(and(isOpen, invite(workspaceId, inviteId)))
          .returning({ email: workspaceInvites.email });
        if (!row) return false;
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "invite_revoked",
          details: { email: row.email },
        });
        return true;
      });
    },

    async findByTokenHash(tokenHash) {
      const [row] = await db
        .select({
          ...inviteColumns,
          workspaceName: workspaces.name,
          workspaceSlug: workspaces.slug,
          mockCount,
          memberCount,
          inviterName: users.name,
          inviterEmail: users.email,
        })
        .from(workspaceInvites)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
        .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
        .where(and(eq(workspaceInvites.tokenHash, tokenHash), isNull(workspaces.deletedAt)))
        .limit(1);
      if (!row) return undefined;
      const {
        workspaceName,
        workspaceSlug,
        mockCount: mocks,
        memberCount: members,
        inviterName,
        inviterEmail,
        ...rest
      } = row;
      return {
        ...toInvite(rest),
        workspace: {
          name: workspaceName,
          slug: workspaceSlug,
          mockCount: mocks,
          memberCount: members,
        },
        inviter: inviterEmail === null ? null : { name: inviterName, email: inviterEmail },
      };
    },

    async isMember(workspaceId, userId) {
      const [row] = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        )
        .limit(1);
      return row !== undefined;
    },

    // An accepted invite supersedes an earlier leave or removal, so its
    // workspace_member_exits row goes too.
    async accept({ inviteId, workspaceId, userId, role, at }) {
      return db.transaction(async (tx) => {
        const [accepted] = await tx
          .update(workspaceInvites)
          .set({ acceptedAt: at })
          .where(and(isOpen, invite(workspaceId, inviteId)))
          .returning({ id: workspaceInvites.id });
        if (!accepted) return false;
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId, userId, role })
          .onConflictDoNothing();
        await tx
          .delete(workspaceMemberExits)
          .where(
            and(
              eq(workspaceMemberExits.workspaceId, workspaceId),
              eq(workspaceMemberExits.userId, userId),
            ),
          );
        return true;
      });
    },

    async decline(inviteId, at) {
      await db
        .update(workspaceInvites)
        .set({ revokedAt: at })
        .where(and(isOpen, eq(workspaceInvites.id, inviteId)));
    },

    async findEmailContext(inviteId) {
      const [row] = await db
        .select({
          email: workspaceInvites.email,
          tokenHash: workspaceInvites.tokenHash,
          acceptedAt: workspaceInvites.acceptedAt,
          revokedAt: workspaceInvites.revokedAt,
          workspaceName: workspaces.name,
          inviterName: users.name,
          inviterEmail: users.email,
        })
        .from(workspaceInvites)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
        .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
        .where(eq(workspaceInvites.id, inviteId))
        .limit(1);
      return row;
    },
  };
}
