import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type RefreshToken, refreshTokens } from "@/db/schema";

export interface NewRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export function createRefreshTokenRepo(db: Db) {
  return {
    async insert(input: NewRefreshTokenInput): Promise<RefreshToken> {
      const [token] = await db.insert(refreshTokens).values(input).returning();
      if (!token) throw new Error("refresh token insert returned no row");
      return token;
    },

    async findByTokenHash(tokenHash: string): Promise<RefreshToken | undefined> {
      const [token] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);
      return token;
    },

    // Conditional update: returns whether the row transitioned active → revoked.
    // A `false` on a row we just loaded as active means someone else revoked or
    // rotated it concurrently — the service treats that as token reuse.
    async revoke(id: string): Promise<boolean> {
      const updated = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      return updated.length > 0;
    },

    async revokeFamily(familyId: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
    },
  };
}

export type RefreshTokenRepo = ReturnType<typeof createRefreshTokenRepo>;
