import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type User, users } from "@/db/schema";

export interface NewUserInput {
  email: string;
  passwordHash: string | null;
  googleSub?: string | null;
  // Set at creation for Google accounts (Google asserts email_verified).
  // Legacy password accounts may still be null until they link Google.
  emailVerifiedAt?: Date | null;
  // Google profile; refreshed at every sign-in by updateProfile.
  name?: string | null;
  avatarUrl?: string | null;
}

export function createUserRepo(db: Db) {
  return {
    // lower(email) = lower($1) so the case-insensitive unique index is used.
    async findByEmail(email: string): Promise<User | undefined> {
      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      return user;
    },

    async findById(id: string): Promise<User | undefined> {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user;
    },

    async findByGoogleSub(googleSub: string): Promise<User | undefined> {
      const [user] = await db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);
      return user;
    },

    // Links a Google identity to an existing account. A unique violation
    // (the sub already linked elsewhere) propagates for the service to resolve.
    async setGoogleSub(id: string, googleSub: string): Promise<User | undefined> {
      const [user] = await db.update(users).set({ googleSub }).where(eq(users.id, id)).returning();
      return user;
    },

    // Conditional on still-unverified so a concurrent link can't move the
    // recorded timestamp; verifying twice is otherwise harmless.
    async setEmailVerifiedAt(id: string, when: Date): Promise<void> {
      await db
        .update(users)
        .set({ emailVerifiedAt: when })
        .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)));
    },

    // Google profile sync at sign-in; skips the write when nothing changed.
    async updateProfile(
      id: string,
      profile: { name: string | null; avatarUrl: string | null },
    ): Promise<void> {
      await db
        .update(users)
        .set(profile)
        .where(
          and(
            eq(users.id, id),
            sql`(${users.name} is distinct from ${profile.name} or ${users.avatarUrl} is distinct from ${profile.avatarUrl})`,
          ),
        );
    },

    // Called on every scoped request; skips the write when already current.
    async setLastWorkspace(userId: string, workspaceId: string): Promise<void> {
      await db
        .update(users)
        .set({ lastWorkspaceId: workspaceId })
        .where(
          and(eq(users.id, userId), sql`${users.lastWorkspaceId} is distinct from ${workspaceId}`),
        );
    },

    // Of the given ids, the ones that belong to an existing user. Used by the
    // push fan-out so a stale target id cannot FK-fail the whole job.
    async listExistingIds(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
      return rows.map((row) => row.id);
    },

    async insert(input: NewUserInput): Promise<User> {
      const [user] = await db.insert(users).values(input).returning();
      if (!user) throw new Error("user insert returned no row");
      return user;
    },
  };
}

export type UserRepo = ReturnType<typeof createUserRepo>;
