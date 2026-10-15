import { withReplicas } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

export function createPool(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: env.DATABASE_POOL_MAX,
    // Fail readiness checks fast instead of hanging for the 30s driver default.
    connect_timeout: 5,
  });
}

export type Pool = ReturnType<typeof createPool>;

export const pool = createPool(env.DATABASE_URL);
const primaryDb = drizzle(pool, { schema });

// `Db` is the plain database type: repos and tests keep accepting/building
// plain drizzle instances. The replica-aware `db` below is assignable to it.
export type Db = typeof primaryDb;

export const replicaPool = env.DATABASE_REPLICA_URL ? createPool(env.DATABASE_REPLICA_URL) : null;
const replicaDb = replicaPool ? drizzle(replicaPool, { schema }) : primaryDb;

// Read/write split: select/query go to the replica; insert/update/delete/
// execute/transaction go to the primary. `db.$primary` pins lag-sensitive
// reads (auth, sessions) to the primary — see app.defaults.ts for the policy.
// With no DATABASE_REPLICA_URL both roles point at the primary.
export const db = withReplicas(primaryDb, [replicaDb]);

export async function pingDatabase(client: Pool = pool): Promise<void> {
  await client`select 1`;
}

export async function closeDatabase(): Promise<void> {
  // Waits up to 5s for in-flight queries, then terminates connections.
  await Promise.all([pool.end({ timeout: 5 }), replicaPool?.end({ timeout: 5 })]);
}
