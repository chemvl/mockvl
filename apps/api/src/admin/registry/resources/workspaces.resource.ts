import { WorkspaceAdminSchema, workspaceFields } from "@starter/schemas";
import { workspaces } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

// Read-only: Mockyard invariants (owner trigger, slug history, audit rows,
// mock route cache) live in modules/workspaces; the generic engine would
// bypass them. No create/update/delete permissions → those routes are never
// mounted.
export const workspacesResource: AdminResourceDef = {
  name: "workspaces",
  label: "Workspaces",
  icon: "ApartmentOutlined",
  table: workspaces,
  schema: { output: WorkspaceAdminSchema },
  fields: workspaceFields,
  permissions: { list: "viewer" },
};
