import "../setup";
import { describe, expect, test } from "bun:test";
import { withReplicas } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { db } from "@/db/client";

// Documents the read/write routing contract the app relies on: reads go to
// the replica, writes and transactions to the primary, `$primary` pins reads.
// Stubs stand in for drizzle instances — only dispatch is under test here,
// so the string-returning stub shape is cast through the drizzle types.
interface StubDb {
  select: () => string;
  insert: (table: never) => string;
  update: (table: never) => string;
  delete: (table: never) => string;
  execute: (query: string) => string;
  transaction: (fn: () => Promise<void>) => string;
}

type RoutedStub = StubDb & { $primary: StubDb };

function createStubDb(name: string): StubDb {
  return {
    select: () => `${name}:select`,
    insert: () => `${name}:insert`,
    update: () => `${name}:update`,
    delete: () => `${name}:delete`,
    execute: () => `${name}:execute`,
    transaction: () => `${name}:transaction`,
  };
}

describe("withReplicas routing", () => {
  const primary = createStubDb("primary");
  const replica = createStubDb("replica");
  const routed = withReplicas(primary as unknown as Db, [
    replica as unknown as Db,
  ]) as unknown as RoutedStub;

  test("routes reads to the replica", () => {
    expect(routed.select()).toBe("replica:select");
  });

  test("routes writes, execute, and transactions to the primary", () => {
    expect(routed.insert({} as never)).toBe("primary:insert");
    expect(routed.update({} as never)).toBe("primary:update");
    expect(routed.delete({} as never)).toBe("primary:delete");
    expect(routed.execute("")).toBe("primary:execute");
    expect(routed.transaction(async () => {})).toBe("primary:transaction");
  });

  test("$primary pins reads to the primary", () => {
    expect(routed.$primary.select()).toBe("primary:select");
  });
});

describe("db client fallback", () => {
  test("without DATABASE_REPLICA_URL the replica role is the primary instance", () => {
    // tests/setup.ts guarantees DATABASE_REPLICA_URL is unset, so the exported
    // db must route every read to the primary — single-database fallback.
    expect(db.$replicas).toHaveLength(1);
    expect(db.$replicas[0]).toBe(db.$primary);
  });
});
