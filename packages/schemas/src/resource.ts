import { z } from "@hono/zod-openapi";
import { AdminRoleSchema } from "./admin-user";

// The public half of an admin resource definition (PLAN 9b): what the meta
// endpoint serializes and the Refine frontend renders from. Drizzle tables,
// Zod schemas, and hooks stay server-side — this file describes only wire data.

export const RESOURCE_ACTIONS = ["list", "create", "update", "delete"] as const;
export type ResourceAction = (typeof RESOURCE_ACTIONS)[number];

const FieldFlagsSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
  // Rendering hints for the generic list/form pages.
  listColumn: z.boolean().optional(),
  searchable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  readOnly: z.boolean().optional(),
});

// Discriminated on `type` so type-specific requirements hold at parse time:
// an enum field must carry its options, a relation must name its target.
export const ResourceFieldSchema = z
  .discriminatedUnion("type", [
    FieldFlagsSchema.extend({
      // "richtext" carries HTML strings — sanitized server-side on write.
      // "image" carries an image URL — rendered as an avatar in lists and a
      // URL input with preview in forms.
      type: z.enum(["string", "text", "boolean", "date", "number", "richtext", "image"]),
    }),
    FieldFlagsSchema.extend({
      type: z.literal("enum"),
      options: z.array(z.string().min(1)).min(1),
    }),
    FieldFlagsSchema.extend({
      type: z.literal("relation"),
      resource: z.string().min(1),
      displayField: z.string().min(1),
    }),
  ])
  .openapi("ResourceField");

export type ResourceField = z.infer<typeof ResourceFieldSchema>;

// Minimum role per action; an absent action is disabled — its route is never
// mounted and it never reaches the meta payload. `list` is mandatory: a
// resource nobody can list would be invisible dead weight in the registry.
export const ResourcePermissionsSchema = z
  .object({
    list: AdminRoleSchema,
    create: AdminRoleSchema.optional(),
    update: AdminRoleSchema.optional(),
    delete: AdminRoleSchema.optional(),
  })
  .openapi("ResourcePermissions");

export type ResourcePermissions = z.infer<typeof ResourcePermissionsSchema>;

export const ResourceMetaSchema = z
  .object({
    // URL segment and Refine resource name — must be a url-safe slug.
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string().min(1),
    // antd icon name as a string, looked up by the frontend.
    icon: z.string().min(1).optional(),
    fields: z.array(ResourceFieldSchema).min(1),
    permissions: ResourcePermissionsSchema,
  })
  .openapi("ResourceMeta");

export type ResourceMeta = z.infer<typeof ResourceMetaSchema>;
