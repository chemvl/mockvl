import "../setup";

import { describe, expect, test } from "bun:test";
import { ResourceMetaSchema } from "@starter/schemas";

// The wire shape of GET /admin/meta/resources entries (PLAN 9b). The schema
// is also what registerAdminResource uses to validate a def's public half,
// so a def that would confuse the Refine frontend is rejected at registration.

const validMeta = {
  name: "posts",
  label: "Posts",
  icon: "FileTextOutlined",
  fields: [
    { name: "title", type: "string", label: "Title", required: true, listColumn: true },
    { name: "status", type: "enum", label: "Status", options: ["draft", "published"] },
    {
      name: "authorId",
      type: "relation",
      label: "Author",
      resource: "users",
      displayField: "email",
    },
    { name: "createdAt", type: "date", label: "Created", sortable: true, readOnly: true },
  ],
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
};

describe("ResourceMetaSchema", () => {
  test("accepts a valid resource meta entry", () => {
    const parsed = ResourceMetaSchema.parse(validMeta);
    expect(parsed.name).toBe("posts");
    expect(parsed.fields).toHaveLength(4);
  });

  test("accepts a read-only resource (only list permission)", () => {
    const parsed = ResourceMetaSchema.parse({
      ...validMeta,
      name: "users",
      permissions: { list: "viewer" },
    });
    expect(parsed.permissions.create).toBeUndefined();
  });

  test("rejects an enum field without options", () => {
    const meta = {
      ...validMeta,
      fields: [{ name: "status", type: "enum", label: "Status" }],
    };
    expect(() => ResourceMetaSchema.parse(meta)).toThrow();
  });

  test("rejects a relation field without a target resource", () => {
    const meta = {
      ...validMeta,
      fields: [{ name: "authorId", type: "relation", label: "Author" }],
    };
    expect(() => ResourceMetaSchema.parse(meta)).toThrow();
  });

  test("rejects permissions without list (every resource must be listable by some role)", () => {
    const meta = { ...validMeta, permissions: { create: "editor" } };
    expect(() => ResourceMetaSchema.parse(meta)).toThrow();
  });

  test("rejects a resource name that is not a url-safe slug", () => {
    expect(() => ResourceMetaSchema.parse({ ...validMeta, name: "Blog Posts" })).toThrow();
  });

  test("rejects an unknown field type", () => {
    const meta = {
      ...validMeta,
      fields: [{ name: "blob", type: "binary", label: "Blob" }],
    };
    expect(() => ResourceMetaSchema.parse(meta)).toThrow();
  });
});
