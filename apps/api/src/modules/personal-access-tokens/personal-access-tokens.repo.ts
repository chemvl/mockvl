import type { PersonalAccessTokenScope } from "@starter/schemas";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  type NewPersonalAccessTokenRow,
  type PersonalAccessTokenRow,
  personalAccessTokens,
  workspaces,
} from "@/db/schema";
import { LAST_ACTIVE_THROTTLE_MINUTES } from "@/modules/workspaces/workspaces.constants";

export interface ActivePersonalAccessToken {
  id: string;
  userId: string;
  scope: PersonalAccessTokenScope;
  expiresAt: Date;
  workspaceSlug: string;
}

export interface PersonalAccessTokensRepo {
  insert(values: NewPersonalAccessTokenRow): Promise<PersonalAccessTokenRow>;
  listForUser(workspaceId: string, userId: string): Promise<PersonalAccessTokenRow[]>;
  countActive(workspaceId: string, userId: string, now: Date): Promise<number>;
  revoke(id: string, workspaceId: string, userId: string): Promise<boolean>;
  findActiveByHash(tokenHash: string, now: Date): Promise<ActivePersonalAccessToken | null>;
  touchLastUsed(id: string): Promise<void>;
}

export function createPersonalAccessTokensRepo(db: Db): PersonalAccessTokensRepo {
  return {
    async insert(values: NewPersonalAccessTokenRow): Promise<PersonalAccessTokenRow> {
      const [row] = await db.insert(personalAccessTokens).values(values).returning();
      if (!row) throw new Error("personal access token insert returned no row");
      return row;
    },

    // Expired tokens stay listed (the UI marks them); revoked ones are hidden.
    async listForUser(workspaceId: string, userId: string): Promise<PersonalAccessTokenRow[]> {
      return db
        .select()
        .from(personalAccessTokens)
        .where(
          and(
            eq(personalAccessTokens.workspaceId, workspaceId),
            eq(personalAccessTokens.userId, userId),
            isNull(personalAccessTokens.revokedAt),
          ),
        )
        .orderBy(desc(personalAccessTokens.createdAt));
    },

    async countActive(workspaceId: string, userId: string, now: Date): Promise<number> {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(personalAccessTokens)
        .where(
          and(
            eq(personalAccessTokens.workspaceId, workspaceId),
            eq(personalAccessTokens.userId, userId),
            isNull(personalAccessTokens.revokedAt),
            gt(personalAccessTokens.expiresAt, now),
          ),
        );
      return row?.total ?? 0;
    },

    // True when the caller owns the row in this workspace, already revoked or not.
    async revoke(id: string, workspaceId: string, userId: string): Promise<boolean> {
      const updated = await db
        .update(personalAccessTokens)
        .set({ revokedAt: sql`coalesce(${personalAccessTokens.revokedAt}, now())` })
        .where(
          and(
            eq(personalAccessTokens.id, id),
            eq(personalAccessTokens.workspaceId, workspaceId),
            eq(personalAccessTokens.userId, userId),
          ),
        )
        .returning({ id: personalAccessTokens.id });
      return updated.length > 0;
    },

    // The membership-age condition is the revival guard: removing and re-adding
    // a member creates a newer membership row, so tokens minted before it die.
    async findActiveByHash(
      tokenHash: string,
      now: Date,
    ): Promise<ActivePersonalAccessToken | null> {
      const [row] = await db
        .select({
          id: personalAccessTokens.id,
          userId: personalAccessTokens.userId,
          scope: personalAccessTokens.scope,
          expiresAt: personalAccessTokens.expiresAt,
          workspaceSlug: workspaces.slug,
        })
        .from(personalAccessTokens)
        .innerJoin(workspaces, eq(workspaces.id, personalAccessTokens.workspaceId))
        .where(
          and(
            eq(personalAccessTokens.tokenHash, tokenHash),
            isNull(personalAccessTokens.revokedAt),
            gt(personalAccessTokens.expiresAt, now),
            isNull(workspaces.deletedAt),
            sql`exists (
              select 1 from workspace_members m
              where m.workspace_id = ${personalAccessTokens.workspaceId}
                and m.user_id = ${personalAccessTokens.userId}
                and m.created_at <= ${personalAccessTokens.createdAt}
            )`,
          ),
        )
        .limit(1);
      return row ?? null;
    },

    // Throttled: at most one write per token per LAST_ACTIVE_THROTTLE_MINUTES.
    async touchLastUsed(id: string): Promise<void> {
      await db
        .update(personalAccessTokens)
        .set({ lastUsedAt: sql`now()` })
        .where(
          and(
            eq(personalAccessTokens.id, id),
            sql`(${personalAccessTokens.lastUsedAt} is null or ${personalAccessTokens.lastUsedAt} < now() - make_interval(mins => ${LAST_ACTIVE_THROTTLE_MINUTES}))`,
          ),
        );
    },
  };
}
