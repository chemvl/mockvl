import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { createDefaultAdminRegistry } from "@/admin/registry/resources";
import { ConflictError } from "@/lib/errors";

// The hooks only call countOwners; the rest of the repo surface is never
// touched by the registry, so a cast keeps the fake honest and small.
function fakeAdminUsersRepo(otherOwners: number): AdminUsersRepo {
  return { countOwners: async () => otherOwners } as unknown as AdminUsersRepo;
}

function buildRegistry(otherOwners = 1) {
  return createDefaultAdminRegistry({ adminUsersRepo: fakeAdminUsersRepo(otherOwners) });
}

const TARGET_ID = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";

describe("default registry", () => {
  test("registers users, admins, categories, posts, workspaces, and mocks", () => {
    const registry = buildRegistry();
    expect(registry.list().map((def) => def.name)).toEqual([
      "users",
      "admins",
      "categories",
      "posts",
      "workspaces",
      "mocks",
    ]);
  });

  test("admins def is owner-only with no create", () => {
    const registry = buildRegistry();
    const def = registry.get("admins");
    expect(def?.permissions).toEqual({ list: "owner", update: "owner", delete: "owner" });
    expect(def?.schema.create).toBeUndefined();
    if (!def) throw new Error("admins def missing");
    // Public meta half serializes cleanly (what /admin/meta/resources returns).
    expect(registry.toMeta(def)).toMatchObject({
      name: "admins",
      label: "Admins",
      icon: "SafetyOutlined",
    });
  });
});

describe("admins last-owner guard hooks", () => {
  test("beforeUpdate rejects demoting the last owner", async () => {
    const def = buildRegistry(0).get("admins");
    await expect(def?.hooks?.beforeUpdate?.(TARGET_ID, { role: "editor" })).rejects.toThrow(
      ConflictError,
    );
  });

  test("beforeUpdate allows demotion when another owner exists", async () => {
    const def = buildRegistry(1).get("admins");
    await expect(def?.hooks?.beforeUpdate?.(TARGET_ID, { role: "viewer" })).resolves.toEqual({
      role: "viewer",
    });
  });

  test("beforeUpdate allows promotion to owner even for the last owner", async () => {
    const def = buildRegistry(0).get("admins");
    await expect(def?.hooks?.beforeUpdate?.(TARGET_ID, { role: "owner" })).resolves.toEqual({
      role: "owner",
    });
  });

  test("beforeUpdate passes a role-less patch through untouched", async () => {
    const def = buildRegistry(0).get("admins");
    await expect(def?.hooks?.beforeUpdate?.(TARGET_ID, {})).resolves.toEqual({});
  });

  test("beforeDelete rejects deleting the last owner", async () => {
    const def = buildRegistry(0).get("admins");
    await expect(def?.hooks?.beforeDelete?.(TARGET_ID)).rejects.toThrow(ConflictError);
  });

  test("beforeDelete allows deletion when another owner exists", async () => {
    const def = buildRegistry(1).get("admins");
    await expect(def?.hooks?.beforeDelete?.(TARGET_ID)).resolves.toBeUndefined();
  });
});
