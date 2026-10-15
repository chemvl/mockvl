import type { AdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { type AdminRegistry, createAdminRegistry } from "./registry";
import { createAdminsResource } from "./resources/admins.resource";
import { categoriesResource } from "./resources/categories.resource";
import { mocksResource } from "./resources/mocks.resource";
import { postsResource } from "./resources/posts.resource";
import { usersResource } from "./resources/users.resource";
import { workspacesResource } from "./resources/workspaces.resource";

export interface DefaultRegistryDeps {
  // Backs the admins resource's last-owner guard. Injected (not the shared db
  // singleton) so tests can wire the registry to their own pool or a fake.
  adminUsersRepo: AdminUsersRepo;
}

// The index: one import + one register() call per resource. The defs live in
// ./resources/<name>.resource.ts — full-CRUD posts, read-only users (PLAN 9b),
// owner-managed admins (role management, the deferred 9b follow-up), and
// read-only Mockvl workspaces and mocks.
//
// Adding an admin resource is four steps:
//   1. Drizzle table in db/schema.
//   2. Zod schemas + fields metadata in packages/schemas (one file).
//   3. A resources/<name>.resource.ts file exporting the def — a const, or a
//      factory when it needs deps (see admins.resource.ts).
//   4. An import + register() call here — CRUD routes, OpenAPI docs, the meta
//      entry, and (Phase 10) the admin sidebar item all follow from it.
// `bun run schemas:generate` automates steps 2–4 for a new table.
export function createDefaultAdminRegistry({ adminUsersRepo }: DefaultRegistryDeps): AdminRegistry {
  const registry = createAdminRegistry();

  registry.register(usersResource);
  registry.register(createAdminsResource({ adminUsersRepo }));
  registry.register(categoriesResource);

  registry.register(postsResource);
  registry.register(workspacesResource);
  registry.register(mocksResource);

  return registry;
}
