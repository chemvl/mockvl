import type { z } from "@hono/zod-openapi";
import type { ResourceField, ResourceMeta, ResourcePermissions } from "@starter/schemas";
import { ResourceMetaSchema } from "@starter/schemas";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

// The resource registry (PLAN 9b): registering a def mounts generic CRUD under
// /admin/<name>, adds a meta entry, and (Phase 10) a Refine sidebar item with
// zero frontend changes. Registration happens once at app assembly, so every
// validation failure here throws a plain Error — a broken def should crash
// boot, not surface as a request-time envelope.

// Rows flow through the engine untyped; the def's Zod schemas are the
// boundary: create/update validate input, output strips + validates output.
export type ResourceRow = Record<string, unknown>;

// Service-level escape hatch. before* hooks may transform the validated
// input; after* hooks observe the affected row — this is where a project
// wires cache invalidation (invalidate("cache:query:<name>:*"), PLAN 8.5c).
export interface AdminResourceHooks {
  beforeCreate?: (input: ResourceRow) => ResourceRow | Promise<ResourceRow>;
  afterCreate?: (row: ResourceRow) => void | Promise<void>;
  beforeUpdate?: (id: string, input: ResourceRow) => ResourceRow | Promise<ResourceRow>;
  afterUpdate?: (row: ResourceRow) => void | Promise<void>;
  beforeDelete?: (id: string) => void | Promise<void>;
  afterDelete?: (row: ResourceRow) => void | Promise<void>;
}

export interface AdminResourceDef {
  // URL segment + Refine resource name.
  name: string;
  label: string;
  // antd icon name as a string (frontend looks it up by name).
  icon?: string;
  table: PgTable;
  // create/update are optional so read-only resources (list/get only) don't
  // carry dead schemas — but a def granting a mutating permission must supply
  // the matching schema (enforced at registration).
  schema: {
    create?: z.ZodType<ResourceRow>;
    update?: z.ZodType<ResourceRow>;
    output: z.ZodObject<z.ZodRawShape>;
  };
  fields: ResourceField[];
  permissions: ResourcePermissions;
  hooks?: AdminResourceHooks;
}

// The def's public half — exactly what the meta endpoint serializes. Parsing
// through ResourceMetaSchema both validates it and strips everything else
// (table, schemas, hooks — Drizzle internals never reach the wire).
function toMeta(def: AdminResourceDef): ResourceMeta {
  return ResourceMetaSchema.parse({
    name: def.name,
    label: def.label,
    ...(def.icon !== undefined && { icon: def.icon }),
    fields: def.fields,
    permissions: def.permissions,
  });
}

// /admin/auth and /admin/meta are mounted by the app itself — a resource
// with either name would silently shadow (or be shadowed by) them.
const RESERVED_RESOURCE_NAMES = ["auth", "meta", "notifications"];

export function createAdminRegistry() {
  const resources = new Map<string, AdminResourceDef>();

  function register(def: AdminResourceDef): void {
    if (resources.has(def.name)) {
      throw new Error(`Admin resource already registered: ${def.name}`);
    }
    if (RESERVED_RESOURCE_NAMES.includes(def.name)) {
      throw new Error(`Admin resource name is reserved: ${def.name}`);
    }

    // The public half must be a valid meta entry — if the frontend couldn't
    // render it, fail at boot.
    toMeta(def);

    // A permitted mutation without its request schema would mount a route
    // that can't validate its body.
    if (def.permissions.create && !def.schema.create) {
      throw new Error(`Resource ${def.name}: create permission requires a create schema`);
    }
    if (def.permissions.update && !def.schema.update) {
      throw new Error(`Resource ${def.name}: update permission requires an update schema`);
    }

    // The engine addresses rows by an `id` column (get/update/delete lookups
    // and the list tiebreaker) — assert it here so a bad table fails at
    // registration, not on the first request through a custom service.
    const columns = getTableColumns(def.table);
    if (!("id" in columns)) {
      throw new Error(`Resource ${def.name}: table has no id column`);
    }

    // Every field must be backed by a real column (sort/filter target it by
    // name) and appear in the output schema (the list/detail wire contract).
    const outputKeys = def.schema.output.keyof().options as string[];
    for (const field of def.fields) {
      if (!(field.name in columns)) {
        throw new Error(`Resource ${def.name}: field is not a table column: ${field.name}`);
      }
      if (!outputKeys.includes(field.name)) {
        throw new Error(`Resource ${def.name}: field missing from output schema: ${field.name}`);
      }
    }

    resources.set(def.name, def);
  }

  return {
    register,
    toMeta,
    get: (name: string) => resources.get(name),
    list: () => [...resources.values()],
  };
}

export type AdminRegistry = ReturnType<typeof createAdminRegistry>;
