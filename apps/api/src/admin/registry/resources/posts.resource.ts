// Generated scaffold — a static def. Convert to a factory taking deps as
// params if the resource ever needs them (see admins.resource.ts).
import { PostCreateSchema, PostSchema, PostUpdateSchema, postFields } from "@starter/schemas";
import { posts } from "@/db/schema";
import { sanitizeRichTextFields } from "@/lib/sanitize";
import type { AdminResourceDef } from "../registry";

// Richtext fields carry editor-authored HTML — sanitize on every write.
// Derived from metadata so a future richtext field is covered automatically.
const richTextFieldNames = postFields
  .filter((field) => field.type === "richtext")
  .map((field) => field.name);

export const postsResource: AdminResourceDef = {
  name: "posts",
  label: "Posts",
  // TODO(generator): pick a real antd icon name.
  icon: "FileTextOutlined",
  table: posts,
  schema: {
    create: PostCreateSchema,
    update: PostUpdateSchema,
    output: PostSchema,
  },
  fields: postFields,
  // TODO(generator): review permissions before shipping.
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
  hooks: {
    beforeCreate: (input) => sanitizeRichTextFields(input, richTextFieldNames),
    beforeUpdate: (_id, input) => sanitizeRichTextFields(input, richTextFieldNames),
  },
};
