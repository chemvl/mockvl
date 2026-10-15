import "../setup";

import { describe, expect, test } from "bun:test";
import type { CrudRepo } from "@/admin/registry/crud.repo";
import { createCrudService } from "@/admin/registry/crud.service";
import type { AdminResourceHooks, ResourceRow } from "@/admin/registry/registry";
import { NotFoundError, ValidationError } from "@/lib/errors";

const row: ResourceRow = { id: "id-1", title: "Hello" };

function fakeRepo(overrides: Partial<CrudRepo> = {}): CrudRepo {
  return {
    list: async () => ({ rows: [row], total: 1 }),
    findById: async () => row,
    insert: async (values) => ({ id: "id-1", ...values }),
    update: async (_id, values) => ({ ...row, ...values }),
    delete: async () => row,
    ...overrides,
  };
}

function service(repoOverrides: Partial<CrudRepo> = {}, hooks?: AdminResourceHooks) {
  return createCrudService({ repo: fakeRepo(repoOverrides), hooks });
}

describe("crud service reads", () => {
  test("list passes the query through and returns rows with total", async () => {
    const seen: unknown[] = [];
    const svc = service({
      list: async (query) => {
        seen.push(query);
        return { rows: [row], total: 42 };
      },
    });
    const result = await svc.list({ page: 2, pageSize: 10, sort: [], filters: [] });
    expect(result.total).toBe(42);
    expect(seen).toEqual([{ page: 2, pageSize: 10, sort: [], filters: [] }]);
  });

  test("get throws NotFoundError for a missing row", async () => {
    const svc = service({ findById: async () => undefined });
    await expect(svc.get("nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("crud service mutations and hooks", () => {
  test("create runs beforeCreate transform, inserts, then afterCreate with the row", async () => {
    const calls: string[] = [];
    const svc = service(
      {
        insert: async (values) => {
          calls.push(`insert:${String(values.title)}`);
          return { id: "id-1", ...values };
        },
      },
      {
        beforeCreate: (input) => {
          calls.push("before");
          return { ...input, title: "Transformed" };
        },
        afterCreate: (created) => {
          calls.push(`after:${String(created.id)}`);
        },
      },
    );
    const created = await svc.create({ title: "Hello" });
    expect(created.title).toBe("Transformed");
    expect(calls).toEqual(["before", "insert:Transformed", "after:id-1"]);
  });

  test("create works without hooks", async () => {
    const created = await service().create({ title: "Hello" });
    expect(created.id).toBe("id-1");
  });

  test("update transforms via beforeUpdate and runs afterUpdate", async () => {
    const calls: string[] = [];
    const svc = service(undefined, {
      beforeUpdate: (id, input) => {
        calls.push(`before:${id}`);
        return { ...input, title: "Patched" };
      },
      afterUpdate: (updated) => {
        calls.push(`after:${String(updated.title)}`);
      },
    });
    const updated = await svc.update("id-1", { title: "x" });
    expect(updated.title).toBe("Patched");
    expect(calls).toEqual(["before:id-1", "after:Patched"]);
  });

  test("update throws NotFoundError and skips afterUpdate when the row is missing", async () => {
    let afterRan = false;
    const svc = service(
      { update: async () => undefined },
      {
        afterUpdate: () => {
          afterRan = true;
        },
      },
    );
    await expect(svc.update("nope", { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(afterRan).toBe(false);
  });

  test("update rejects an empty patch", async () => {
    await expect(service().update("id-1", {})).rejects.toBeInstanceOf(ValidationError);
  });

  test("remove runs beforeDelete, deletes, then afterDelete with the deleted row", async () => {
    const calls: string[] = [];
    const svc = service(undefined, {
      beforeDelete: (id) => {
        calls.push(`before:${id}`);
      },
      afterDelete: (deleted) => {
        calls.push(`after:${String(deleted.id)}`);
      },
    });
    const deleted = await svc.remove("id-1");
    expect(deleted).toEqual(row);
    expect(calls).toEqual(["before:id-1", "after:id-1"]);
  });

  test("remove throws NotFoundError and skips afterDelete when the row is missing", async () => {
    let afterRan = false;
    const svc = service(
      { delete: async () => undefined },
      {
        afterDelete: () => {
          afterRan = true;
        },
      },
    );
    await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFoundError);
    expect(afterRan).toBe(false);
  });
});
