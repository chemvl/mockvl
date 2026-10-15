// Generated scaffold — a static def. Convert to a factory taking deps as
// params if the resource ever needs them (see admins.resource.ts).
import {
  CategoryCreateSchema,
  CategorySchema,
  CategoryUpdateSchema,
  categoryFields,
} from "@starter/schemas";
import { categories } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

export const categoriesResource: AdminResourceDef = {
  name: "categories",
  label: "Categories",
  // TODO(generator): pick a real antd icon name.
  icon: "FolderOpenOutlined",
  table: categories,
  schema: {
    create: CategoryCreateSchema,
    update: CategoryUpdateSchema,
    output: CategorySchema,
  },
  fields: categoryFields,
  // TODO(generator): review permissions before shipping.
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
};
