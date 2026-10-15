import "../setup";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@/config/env";

const MIGRATIONS_FOLDER = join(import.meta.dir, "../../src/db/migrations");

// CREATE DATABASE cannot take bind parameters, so the name is interpolated —
// restrict it to a safe identifier instead of trusting the URL blindly.
const SAFE_DB_NAME = /^[a-z_][a-z0-9_]*$/;

const TEST_ADMIN_POOL_OPTIONS = {
  max: 1,
  connect_timeout: 5,
  // Re-running migrations emits "already exists, skipping" NOTICEs that
  // postgres.js would otherwise print into the test output.
  onnotice: () => {},
} as const;

async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);
  if (!SAFE_DB_NAME.test(dbName)) {
    throw new Error(`Refusing to create test database with unsafe name "${dbName}"`);
  }

  // Connect to the maintenance DB on the same server to create the test DB.
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = "/postgres";
  const sql = postgres(maintenanceUrl.href, TEST_ADMIN_POOL_OPTIONS);
  try {
    const existing = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (existing.length === 0) {
      await sql.unsafe(`create database "${dbName}"`);
    }
  } finally {
    await sql.end();
  }
}

let prepared: Promise<void> | undefined;

/**
 * Creates the test database if missing and applies all Drizzle migrations.
 * Memoized: test files run sequentially in one process, so integration/e2e
 * suites can each call this from beforeAll and only the first one pays.
 */
export function prepareTestDatabase(): Promise<void> {
  prepared ??= (async () => {
    await createDatabaseIfMissing(env.DATABASE_URL);
    const pool = postgres(env.DATABASE_URL, TEST_ADMIN_POOL_OPTIONS);
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await pool.end();
    }
  })().catch((error) => {
    // Do not cache a failed prep — a later suite may retry once the DB is up.
    prepared = undefined;
    throw error;
  });
  return prepared;
}
