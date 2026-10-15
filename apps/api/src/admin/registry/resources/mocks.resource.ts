import { MockAdminSchema, mockFields } from "@starter/schemas";
import { mocks } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

// Read-only: schema import, live versions, and route-cache invalidation live
// in modules/mocks; the generic engine would bypass them. No
// create/update/delete permissions → those routes are never mounted.
export const mocksResource: AdminResourceDef = {
  name: "mocks",
  label: "Mocks",
  icon: "ApiOutlined",
  table: mocks,
  schema: { output: MockAdminSchema },
  fields: mockFields,
  permissions: { list: "viewer" },
};
