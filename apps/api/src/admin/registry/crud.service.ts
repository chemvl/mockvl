import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import type { CrudRepo } from "./crud.repo";
import type { AdminResourceHooks, ResourceRow } from "./registry";

export interface CreateCrudServiceDeps {
  repo: CrudRepo;
  hooks?: AdminResourceHooks;
}

// Generic business logic shared by every registered resource. Hooks are the
// per-resource escape hatch: before* may transform the (already validated)
// input, after* observe the affected row — cache invalidation goes there.
//
// Ordering (deliberate): before* hooks run ahead of the row's existence
// check — one DB round-trip, and a before* hook must not assume the row
// exists. after* hooks only run for rows that were actually affected.
export function createCrudService({ repo, hooks = {} }: CreateCrudServiceDeps) {
  return {
    async list(query: ListQuery): Promise<{ rows: ResourceRow[]; total: number }> {
      return repo.list(query);
    },

    async get(id: string): Promise<ResourceRow> {
      const row = await repo.findById(id);
      if (!row) throw new NotFoundError("Record not found");
      return row;
    },

    async create(input: ResourceRow): Promise<ResourceRow> {
      const values = hooks.beforeCreate ? await hooks.beforeCreate(input) : input;
      const row = await repo.insert(values);
      await hooks.afterCreate?.(row);
      return row;
    },

    async update(id: string, input: ResourceRow): Promise<ResourceRow> {
      if (Object.keys(input).length === 0) {
        throw new ValidationError("No fields to update");
      }
      const values = hooks.beforeUpdate ? await hooks.beforeUpdate(id, input) : input;
      const row = await repo.update(id, values);
      if (!row) throw new NotFoundError("Record not found");
      await hooks.afterUpdate?.(row);
      return row;
    },

    async remove(id: string): Promise<ResourceRow> {
      await hooks.beforeDelete?.(id);
      const row = await repo.delete(id);
      if (!row) throw new NotFoundError("Record not found");
      await hooks.afterDelete?.(row);
      return row;
    },
  };
}

export type CrudService = ReturnType<typeof createCrudService>;
