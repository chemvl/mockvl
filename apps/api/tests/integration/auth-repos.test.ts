import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { prepareTestDatabase } from "../helpers/test-db";

const { users } = schema;

// Integration tests — they require the compose Postgres from docker-compose.yml
// to be up (docker compose up -d); the test database itself is created and
// migrated by prepareTestDatabase().
await prepareTestDatabase();

// Own pool so closing it can't break other test files sharing the process.
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

const userRepo = createUserRepo(db);
const refreshTokenRepo = createRefreshTokenRepo(db);

const createdUserIds: string[] = [];

async function insertUser() {
  const user = await userRepo.insert({
    email: `phase3-${crypto.randomUUID()}@example.com`,
    passwordHash: "not-a-real-hash",
  });
  createdUserIds.push(user.id);
  return user;
}

function insertToken(userId: string, familyId: string) {
  return refreshTokenRepo.insert({
    userId,
    familyId,
    tokenHash: `hash-${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

afterAll(async () => {
  // Deleting users cascades to their refresh tokens.
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end({ timeout: 5 });
});

describe("userRepo", () => {
  test("insert returns the created row with generated defaults", async () => {
    const user = await insertUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  test("findByEmail is case-insensitive", async () => {
    const user = await insertUser();
    const found = await userRepo.findByEmail(user.email.toUpperCase());
    expect(found?.id).toBe(user.id);
  });

  test("findByEmail returns undefined for unknown emails", async () => {
    const found = await userRepo.findByEmail(`missing-${crypto.randomUUID()}@example.com`);
    expect(found).toBeUndefined();
  });

  test("findById round-trips", async () => {
    const user = await insertUser();
    const found = await userRepo.findById(user.id);
    expect(found?.email).toBe(user.email);
  });

  test("insert accepts a Google-only user (null passwordHash, googleSub set)", async () => {
    const googleSub = `sub-${crypto.randomUUID()}`;
    const user = await userRepo.insert({
      email: `google-${crypto.randomUUID()}@example.com`,
      passwordHash: null,
      googleSub,
    });
    createdUserIds.push(user.id);

    const found = await userRepo.findById(user.id);
    expect(found?.passwordHash).toBeNull();
    expect(found?.googleSub).toBe(googleSub);
  });

  test("findByGoogleSub round-trips and misses cleanly", async () => {
    const googleSub = `sub-${crypto.randomUUID()}`;
    const user = await userRepo.insert({
      email: `google-${crypto.randomUUID()}@example.com`,
      passwordHash: null,
      googleSub,
    });
    createdUserIds.push(user.id);

    expect((await userRepo.findByGoogleSub(googleSub))?.id).toBe(user.id);
    expect(await userRepo.findByGoogleSub(`missing-${crypto.randomUUID()}`)).toBeUndefined();
  });

  test("setGoogleSub links a password account and returns the updated row", async () => {
    const user = await insertUser();
    const googleSub = `sub-${crypto.randomUUID()}`;

    const updated = await userRepo.setGoogleSub(user.id, googleSub);
    expect(updated?.id).toBe(user.id);
    expect(updated?.googleSub).toBe(googleSub);
    expect(updated?.passwordHash).toBe(user.passwordHash);
  });

  test("duplicate googleSub surfaces the Postgres unique violation", async () => {
    const googleSub = `sub-${crypto.randomUUID()}`;
    const first = await userRepo.insert({
      email: `google-${crypto.randomUUID()}@example.com`,
      passwordHash: null,
      googleSub,
    });
    createdUserIds.push(first.id);

    const error = await userRepo
      .insert({
        email: `google-${crypto.randomUUID()}@example.com`,
        passwordHash: null,
        googleSub,
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { cause?: { code?: string } }).cause?.code).toBe("23505");
  });
});

describe("refreshTokenRepo", () => {
  test("insert + findByTokenHash round-trip", async () => {
    const user = await insertUser();
    const familyId = crypto.randomUUID();
    const token = await insertToken(user.id, familyId);

    const found = await refreshTokenRepo.findByTokenHash(token.tokenHash);
    expect(found?.id).toBe(token.id);
    expect(found?.familyId).toBe(familyId);
    expect(found?.revokedAt).toBeNull();
  });

  test("findByTokenHash returns undefined for unknown hashes", async () => {
    const found = await refreshTokenRepo.findByTokenHash(`missing-${crypto.randomUUID()}`);
    expect(found).toBeUndefined();
  });

  test("revoke transitions active → revoked exactly once", async () => {
    const user = await insertUser();
    const token = await insertToken(user.id, crypto.randomUUID());

    expect(await refreshTokenRepo.revoke(token.id)).toBe(true);
    // Second attempt: the row is already revoked, so nothing transitions.
    expect(await refreshTokenRepo.revoke(token.id)).toBe(false);

    const found = await refreshTokenRepo.findByTokenHash(token.tokenHash);
    expect(found?.revokedAt).toBeInstanceOf(Date);
  });

  test("revokeFamily revokes the whole family and nothing else", async () => {
    const user = await insertUser();
    const family = crypto.randomUUID();
    const otherFamily = crypto.randomUUID();
    const a = await insertToken(user.id, family);
    const b = await insertToken(user.id, family);
    const other = await insertToken(user.id, otherFamily);

    await refreshTokenRepo.revokeFamily(family);

    expect((await refreshTokenRepo.findByTokenHash(a.tokenHash))?.revokedAt).toBeInstanceOf(Date);
    expect((await refreshTokenRepo.findByTokenHash(b.tokenHash))?.revokedAt).toBeInstanceOf(Date);
    expect((await refreshTokenRepo.findByTokenHash(other.tokenHash))?.revokedAt).toBeNull();
  });
});
