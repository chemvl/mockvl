import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { prepareTestDatabase } from "../helpers/test-db";

const { adminUsers } = schema;

// Integration tests — they require the compose Postgres from docker-compose.yml
// to be up (docker compose up -d); the test database itself is created and
// migrated by prepareTestDatabase().
await prepareTestDatabase();

// Own pool so closing it can't break other test files sharing the process.
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

const adminUsersRepo = createAdminUsersRepo(db);
const adminSessionsRepo = createAdminSessionsRepo(db);

const createdAdminIds: string[] = [];

async function insertAdmin(
  overrides: { email?: string; role?: "viewer" | "editor" | "owner" } = {},
) {
  const admin = await adminUsersRepo.insert({
    email: overrides.email ?? `phase9-${crypto.randomUUID()}@example.com`,
    name: "Test Admin",
    avatarUrl: null,
    ...(overrides.role && { role: overrides.role }),
  });
  createdAdminIds.push(admin.id);
  return admin;
}

function insertSession(adminUserId: string) {
  return adminSessionsRepo.insert({
    adminUserId,
    tokenHash: `hash-${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

afterAll(async () => {
  // Deleting admin users cascades to their sessions.
  for (const id of createdAdminIds) {
    await db.delete(adminUsers).where(eq(adminUsers.id, id));
  }
  await pool.end({ timeout: 5 });
});

describe("adminUsersRepo", () => {
  test("insert returns the created row with viewer as the default role", async () => {
    const admin = await insertAdmin();

    expect(admin.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(admin.role).toBe("viewer");
    expect(admin.createdAt).toBeInstanceOf(Date);
  });

  test("findByEmail is case-insensitive", async () => {
    const email = `phase9-${crypto.randomUUID()}@Example.com`;
    const admin = await insertAdmin({ email });

    const found = await adminUsersRepo.findByEmail(email.toUpperCase());

    expect(found?.id).toBe(admin.id);
  });

  test("rejects duplicate emails differing only by case", async () => {
    const email = `phase9-${crypto.randomUUID()}@example.com`;
    await insertAdmin({ email });

    let error: unknown;
    try {
      await adminUsersRepo.insert({ email: email.toUpperCase(), name: "Dup", avatarUrl: null });
    } catch (caught) {
      error = caught;
    }

    // Drizzle wraps the driver error; the Postgres unique violation (23505 on
    // the lower(email) index) is the cause.
    const cause = error instanceof Error ? (error.cause as { code?: string }) : undefined;
    expect(cause?.code).toBe("23505");
  });

  test("updateProfile changes name and avatar but not the role", async () => {
    const admin = await insertAdmin({ role: "editor" });

    const updated = await adminUsersRepo.updateProfile(admin.id, {
      name: "Renamed",
      avatarUrl: "https://example.com/a.png",
    });

    expect(updated?.name).toBe("Renamed");
    expect(updated?.avatarUrl).toBe("https://example.com/a.png");
    expect(updated?.role).toBe("editor");
  });

  test("updateRole promotes the user", async () => {
    const admin = await insertAdmin();

    const updated = await adminUsersRepo.updateRole(admin.id, "owner");

    expect(updated?.role).toBe("owner");
  });

  test("countOwners counts owners other than the excluded id", async () => {
    // The shared test DB may hold owner rows from other suites, so assert
    // deltas against a baseline instead of absolute counts.
    const unrelatedId = crypto.randomUUID();
    const baseline = await adminUsersRepo.countOwners(unrelatedId);

    const ownerA = await insertAdmin({ role: "owner" });
    // Excluding A hides exactly A; excluding an unrelated id counts A.
    expect(await adminUsersRepo.countOwners(ownerA.id)).toBe(baseline);
    expect(await adminUsersRepo.countOwners(unrelatedId)).toBe(baseline + 1);

    // Non-owner roles never count.
    await insertAdmin({ role: "editor" });
    expect(await adminUsersRepo.countOwners(unrelatedId)).toBe(baseline + 1);

    // A second owner: excluding A now finds B.
    const ownerB = await insertAdmin({ role: "owner" });
    expect(await adminUsersRepo.countOwners(ownerA.id)).toBe(baseline + 1);
    expect(await adminUsersRepo.countOwners(ownerB.id)).toBe(baseline + 1);
    expect(await adminUsersRepo.countOwners(unrelatedId)).toBe(baseline + 2);
  });
});

describe("adminSessionsRepo", () => {
  test("findWithUserByTokenHash returns the session joined with its admin user", async () => {
    const admin = await insertAdmin();
    const session = await insertSession(admin.id);

    const found = await adminSessionsRepo.findWithUserByTokenHash(session.tokenHash);

    expect(found?.session.id).toBe(session.id);
    expect(found?.adminUser.id).toBe(admin.id);
  });

  test("findWithUserByTokenHash returns undefined for an unknown hash", async () => {
    expect(await adminSessionsRepo.findWithUserByTokenHash("nope")).toBeUndefined();
  });

  test("updateExpiry persists the new expiry", async () => {
    const admin = await insertAdmin();
    const session = await insertSession(admin.id);
    const later = new Date(Date.now() + 120_000);

    await adminSessionsRepo.updateExpiry(session.id, later);

    const found = await adminSessionsRepo.findWithUserByTokenHash(session.tokenHash);
    expect(found?.session.expiresAt.getTime()).toBe(later.getTime());
  });

  test("deleteByTokenHash removes the session and is idempotent", async () => {
    const admin = await insertAdmin();
    const session = await insertSession(admin.id);

    await adminSessionsRepo.deleteByTokenHash(session.tokenHash);
    await adminSessionsRepo.deleteByTokenHash(session.tokenHash);

    expect(await adminSessionsRepo.findWithUserByTokenHash(session.tokenHash)).toBeUndefined();
  });

  test("deleting the admin user cascades to their sessions", async () => {
    const admin = await insertAdmin();
    const session = await insertSession(admin.id);

    await db.delete(adminUsers).where(eq(adminUsers.id, admin.id));

    expect(await adminSessionsRepo.findWithUserByTokenHash(session.tokenHash)).toBeUndefined();
  });
});
