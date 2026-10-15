import type { OperationMethod } from "@starter/schemas";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mockResponseOverrides as overrides, users } from "@/db/schema";
import { type UserRefRow, userRef } from "./mocks.repo";

// One endpoint + status code of a mock (overrides spec Decision 1).
export interface OverrideKey {
  method: OperationMethod;
  path: string;
  code: number;
}

export interface OverrideRecord extends OverrideKey {
  updatedAt: Date;
  updatedBy: UserRefRow | null;
}

interface OverrideRow extends OverrideKey {
  updatedAt: Date;
  updaterId: string | null;
  updaterName: string | null;
  updaterEmail: string | null;
}

function toRecord({ updaterId, updaterName, updaterEmail, ...row }: OverrideRow): OverrideRecord {
  return { ...row, updatedBy: userRef(updaterId, updaterName, updaterEmail) };
}

function byKey(mockId: string, key: OverrideKey) {
  return and(
    eq(overrides.mockId, mockId),
    eq(overrides.method, key.method),
    eq(overrides.path, key.path),
    eq(overrides.statusCode, key.code),
  );
}

export function createOverridesRepo(db: Db) {
  const selection = {
    method: overrides.method,
    path: overrides.path,
    code: overrides.statusCode,
    updatedAt: overrides.updatedAt,
    updaterId: users.id,
    updaterName: users.name,
    updaterEmail: users.email,
  };

  return {
    // Every row of the mock, dormant ones included. Bodies are never listed.
    async list(mockId: string): Promise<OverrideRecord[]> {
      const rows = await db
        .select(selection)
        .from(overrides)
        .leftJoin(users, eq(users.id, overrides.updatedBy))
        .where(eq(overrides.mockId, mockId))
        .orderBy(asc(overrides.path), asc(overrides.method), asc(overrides.statusCode));
      return rows.map(toRecord);
    },

    async upsert(
      mockId: string,
      key: OverrideKey,
      body: string,
      userId: string,
    ): Promise<OverrideRecord> {
      await db
        .insert(overrides)
        .values({
          mockId,
          method: key.method,
          path: key.path,
          statusCode: key.code,
          body,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [overrides.mockId, overrides.method, overrides.path, overrides.statusCode],
          set: { body, updatedBy: userId, updatedAt: new Date() },
        });
      const [row] = await db
        .select(selection)
        .from(overrides)
        .leftJoin(users, eq(users.id, overrides.updatedBy))
        .where(byKey(mockId, key))
        .limit(1);
      if (!row) throw new Error("override upsert left no row");
      return toRecord(row);
    },

    // The mock runtime's lookup (mock-runtime/override-store.ts).
    async findBody(mockId: string, key: OverrideKey): Promise<string | null> {
      const [row] = await db
        .select({ body: overrides.body })
        .from(overrides)
        .where(byKey(mockId, key))
        .limit(1);
      return row?.body ?? null;
    },

    async delete(mockId: string, key: OverrideKey): Promise<void> {
      await db.delete(overrides).where(byKey(mockId, key));
    },
  };
}

export type OverridesRepo = ReturnType<typeof createOverridesRepo>;
