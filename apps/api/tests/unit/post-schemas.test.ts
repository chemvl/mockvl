import "../setup";

import { describe, expect, test } from "bun:test";
import {
  PostCreateSchema,
  PostSchema,
  PostUpdateSchema,
  postFields,
  ResourceFieldSchema,
  userFields,
} from "@starter/schemas";
import { z } from "zod";

describe("post schemas", () => {
  test("PostCreateSchema accepts a minimal post (status defaults to draft)", () => {
    const parsed = PostCreateSchema.parse({
      title: "Hello",
      authorId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
    });
    expect(parsed.status).toBe("draft");
    expect(parsed.content).toBeNull();
  });

  test("PostCreateSchema rejects a missing title", () => {
    expect(() =>
      PostCreateSchema.parse({ authorId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a" }),
    ).toThrow();
  });

  test("PostCreateSchema rejects an unknown status", () => {
    expect(() =>
      PostCreateSchema.parse({
        title: "Hello",
        authorId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
        status: "archived",
      }),
    ).toThrow();
  });

  test("PostUpdateSchema accepts a partial update", () => {
    const parsed = PostUpdateSchema.parse({ status: "published" });
    expect(parsed).toEqual({ status: "published" });
  });

  test("PostSchema describes the wire shape (ISO dates)", () => {
    const parsed = PostSchema.parse({
      id: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f",
      title: "Hello",
      status: "draft",
      content: null,
      coverImageUrl: null,
      categoryId: null,
      authorId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });
    expect(parsed.title).toBe("Hello");
  });
});

describe("fields metadata (no-drift rule: fields live beside their Zod schema)", () => {
  test("postFields are valid ResourceFields and name only PostSchema properties", () => {
    const outputKeys = Object.keys(PostSchema.shape);
    for (const field of postFields) {
      ResourceFieldSchema.parse(field);
      expect(outputKeys).toContain(field.name);
    }
  });

  test("postFields match the PLAN 9b worked example", () => {
    const byName = new Map(postFields.map((field) => [field.name, field]));
    expect(byName.get("title")).toMatchObject({ type: "string", required: true, listColumn: true });
    expect(byName.get("status")).toMatchObject({
      type: "enum",
      options: ["draft", "published"],
      filterable: true,
    });
    expect(byName.get("authorId")).toMatchObject({
      type: "relation",
      resource: "users",
      displayField: "email",
    });
    expect(byName.get("coverImageUrl")).toMatchObject({ type: "image", listColumn: true });
    expect(byName.get("createdAt")).toMatchObject({ type: "date", sortable: true, readOnly: true });
  });

  test("userFields are valid and read-only flavored", () => {
    const parsed = z.array(ResourceFieldSchema).parse(userFields);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.some((field) => field.name === "email")).toBe(true);
  });
});
