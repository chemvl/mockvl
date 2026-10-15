import type { InviteRole, WorkspaceMember } from "@starter/schemas";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users, workspaceAuditEvents, workspaceMemberExits, workspaceMembers } from "@/db/schema";

const memberColumns = {
  userId: workspaceMembers.userId,
  name: users.name,
  email: users.email,
  avatarUrl: users.avatarUrl,
  role: workspaceMembers.role,
  joinedAt: workspaceMembers.createdAt,
  lastActiveAt: workspaceMembers.lastActiveAt,
};

type MemberRow = Omit<WorkspaceMember, "joinedAt" | "lastActiveAt"> & {
  joinedAt: Date;
  lastActiveAt: Date | null;
};

function toMember(row: MemberRow): WorkspaceMember {
  return {
    ...row,
    joinedAt: row.joinedAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
  };
}

export interface RoleChange {
  workspaceId: string;
  actorId: string;
  userId: string;
  from: WorkspaceMember["role"];
  to: InviteRole;
}

export interface MemberRemoval {
  workspaceId: string;
  actorId: string;
  userId: string;
  email: string;
}

export interface MembersRepo {
  list(workspaceId: string): Promise<WorkspaceMember[]>;
  find(workspaceId: string, userId: string): Promise<WorkspaceMember | undefined>;
  updateRole(change: RoleChange): Promise<void>;
  remove(removal: MemberRemoval): Promise<void>;
}

export function createMembersRepo(db: Db): MembersRepo {
  function select(...conditions: SQL[]) {
    return db
      .select(memberColumns)
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(...conditions));
  }

  const member = (workspaceId: string, userId: string) =>
    and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));

  return {
    // Enum declaration order is owner, admin, editor, viewer.
    async list(workspaceId) {
      const rows = await select(eq(workspaceMembers.workspaceId, workspaceId)).orderBy(
        asc(workspaceMembers.role),
        sql`lower(coalesce(${users.name}, ${users.email}))`,
      );
      return rows.map(toMember);
    },

    async find(workspaceId, userId) {
      const [row] = await select(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ).limit(1);
      return row && toMember(row);
    },

    async updateRole({ workspaceId, actorId, userId, from, to }) {
      await db.transaction(async (tx) => {
        await tx.update(workspaceMembers).set({ role: to }).where(member(workspaceId, userId));
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "member_role_changed",
          details: { userId, from, to },
        });
      });
    },

    // The exit row keeps domain join from re-adding the user.
    async remove({ workspaceId, actorId, userId, email }) {
      await db.transaction(async (tx) => {
        await tx.delete(workspaceMembers).where(member(workspaceId, userId));
        await tx
          .insert(workspaceMemberExits)
          .values({ workspaceId, userId })
          .onConflictDoUpdate({
            target: [workspaceMemberExits.workspaceId, workspaceMemberExits.userId],
            set: { exitedAt: sql`now()` },
          });
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: "member_removed",
          details: { userId, email },
        });
      });
    },
  };
}
