import { type ConstructorOptions, PgBoss, type SendOptions } from "pg-boss";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { CancelJob, Enqueue } from "./types";

// The minimal surface createEnqueue needs — a real PgBoss instance satisfies
// it, and unit tests satisfy it with a recording mock.
export interface BossSender {
  send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>;
}

export function createBoss(
  databaseUrl: string,
  overrides: Omit<ConstructorOptions, "connectionString"> = {},
): PgBoss {
  const instance = new PgBoss({ connectionString: databaseUrl, ...overrides });
  // pg-boss is an EventEmitter: an unhandled "error" event would crash the
  // process, so route it into structured logging instead.
  const schema = overrides.schema ?? "pgboss";
  instance.on("error", (err) => logger.error({ err, schema }, "pg-boss error"));
  return instance;
}

export function createEnqueue(boss: BossSender): Enqueue {
  return (name, data, options) => boss.send(name, data, options);
}

// --- process-wide singleton, started once during bootstrap ---

// Memoizing the startup PROMISE (not just the instance) makes concurrent
// startBoss() calls share one startup: a second caller awaits the same
// start() instead of receiving an instance that has not finished starting.
let bossStartup: Promise<PgBoss> | null = null;
let boss: PgBoss | null = null;

export function startBoss(databaseUrl: string = env.DATABASE_URL): Promise<PgBoss> {
  bossStartup ??= (async () => {
    const instance = createBoss(databaseUrl);
    try {
      await instance.start();
    } catch (err) {
      bossStartup = null; // a failed boot may be retried
      throw err;
    }
    boss = instance;
    logger.info("pg-boss started");
    return instance;
  })();
  return bossStartup;
}

export function getBoss(): PgBoss {
  if (!boss) {
    throw new Error("pg-boss is not started — call startBoss() during bootstrap first");
  }
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  const stopping = boss;
  boss = null;
  bossStartup = null;
  // graceful: let active jobs finish (up to timeout); close: end the pool.
  await stopping.stop({ graceful: true, close: true, timeout: 10_000 });
  logger.info("pg-boss stopped");
}

// Lazy singleton-backed enqueue: resolves the boss at call time, so app
// wiring can be constructed before startBoss() runs during bootstrap.
export const enqueue: Enqueue = (name, data, options) => getBoss().send(name, data, options);

// Lazy singleton-backed cancel, same rationale as enqueue.
export const cancelJob: CancelJob = async (name, jobId) => {
  await getBoss().cancel(name, jobId);
};
