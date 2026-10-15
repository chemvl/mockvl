import "../setup";

import { describe, expect, test } from "bun:test";
import {
  CategoryCreateSchema,
  CategorySchema,
  CategoryUpdateSchema,
  categoryFields,
  ResourceFieldSchema,
} from "@starter/schemas";
import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { emitModelFile } from "../../scripts/schema-gen/emit";
import { buildTableModel, discoverTables } from "../../scripts/schema-gen/introspect";
import { categories } from "../../src/db/schema";

// Fixture exercising every mapping branch: enum with default, required and
// nullable FKs, texty nullable column, boolean/int scalars, an extra
// timestamp, and the auto createdAt/updatedAt pair.
const bookStatus = pgEnum("book_status", ["available", "lent"]);

const shelves = pgTable("shelves", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  status: bookStatus("status").notNull().default("available"),
  notes: text("notes"),
  shelfId: uuid("shelf_id").references(() => shelves.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => shelves.id),
  isFeatured: boolean("is_featured").notNull().default(false),
  pageCount: integer("page_count").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

describe("discoverTables", () => {
  test("finds PgTable exports and ignores everything else", () => {
    const tables = discoverTables({ books, shelves, bookStatus, other: 42 });
    expect([...tables.keys()].sort()).toEqual(["books", "shelves"]);
  });
});

describe("emitModelFile (books fixture)", () => {
  const source = emitModelFile(buildTableModel("books", books));

  test("emits the enum const, schema, and type", () => {
    expect(source).toContain('export const BOOK_STATUSES = ["available", "lent"] as const;');
    expect(source).toContain(
      'export const BookStatusSchema = z.enum(BOOK_STATUSES).openapi("BookStatus");',
    );
    expect(source).toContain("export type BookStatus = z.infer<typeof BookStatusSchema>;");
  });

  test("Base schema maps scalars with TODOs and nullability", () => {
    expect(source).toContain("title: z.string().min(1), // TODO(generator): tune max length");
    expect(source).toContain("notes: z.string().nullable(),");
    expect(source).toContain("shelfId: z.uuid().nullable(),");
    expect(source).toContain("ownerId: z.uuid(),");
    expect(source).toContain("isFeatured: z.boolean(),");
    expect(source).toContain("pageCount: z.number().int(),");
    expect(source).toContain("publishedAt: z.iso.datetime().nullable(),");
  });

  test("Create adds literal, enum, and null defaults; Update is partial", () => {
    expect(source).toContain('status: BookStatusSchema.default("available"),');
    expect(source).toContain("notes: BookBaseSchema.shape.notes.default(null),");
    expect(source).toContain("shelfId: BookBaseSchema.shape.shelfId.default(null),");
    expect(source).toContain("isFeatured: BookBaseSchema.shape.isFeatured.default(false),");
    expect(source).toContain(
      'export const BookUpdateSchema = BookBaseSchema.partial().openapi("BookUpdate");',
    );
  });

  test("output schema uses wire idioms (uuid id, ISO dates) and excludes nothing", () => {
    expect(source).toContain(
      'id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),',
    );
    expect(source).toContain(
      'createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),',
    );
    expect(source).toContain(
      'updatedAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),',
    );
    expect(source).not.toContain("z.string().uuid()"); // zod v4 idiom only
  });

  test("createdAt/updatedAt never reach the Base schema", () => {
    const baseBlock = source.slice(
      source.indexOf("BookBaseSchema"),
      source.indexOf("BookCreateSchema"),
    );
    expect(baseBlock).not.toContain("createdAt");
    expect(baseBlock).not.toContain("updatedAt");
  });

  test("fields metadata: relations, enum options, required flags, no updatedAt", () => {
    expect(source).toContain('resource: "shelves",');
    expect(source).toContain('displayField: "name",');
    // Relation fields ship list-ready (guide Step 5d): nullable shelfId gets
    // the flags without required; notNull ownerId gets required first.
    expect(source).toContain(
      '    displayField: "name",\n    listColumn: true,\n    filterable: true,',
    );
    expect(source).toContain("    required: true,\n    listColumn: true,\n    filterable: true,");
    expect(source).toContain("options: [...BOOK_STATUSES],");
    expect(source).toContain(
      "// TODO(generator): confirm the resource slug matches its registry name.",
    );
    const fieldsBlock = source.slice(source.indexOf("bookFields"));
    expect(fieldsBlock).not.toContain('"updatedAt"');
    // status has a default, so it is not required; ownerId is.
    expect(fieldsBlock).toContain('name: "ownerId"');
  });
});

describe("emitModelFile (posts) — richtext override", () => {
  test("posts.content is upgraded to richtext and stays z.string()", async () => {
    const { posts } = await import("../../src/db/schema");
    const source = emitModelFile(buildTableModel("posts", posts));
    expect(source).toContain('type: "richtext"');
    expect(source).toContain("content: z.string().nullable(),");
    // Only the mapped column is upgraded — title stays a string field.
    expect(source).toContain('type: "string"');
  });

  test("unmapped tables never get the richtext kind (books fixture)", () => {
    const source = emitModelFile(buildTableModel("books", books));
    expect(source).not.toContain("richtext");
  });
});

describe("emitModelFile — image override", () => {
  test("posts.coverImageUrl is upgraded to image with z.url() and listColumn", async () => {
    const { posts } = await import("../../src/db/schema");
    const source = emitModelFile(buildTableModel("posts", posts));
    expect(source).toContain('type: "image"');
    expect(source).toContain("coverImageUrl: z.url().nullable(),");
    const fieldsBlock = source.slice(source.indexOf("postFields"));
    expect(fieldsBlock).toContain(
      '    name: "coverImageUrl",\n    type: "image",\n    label: "Cover Image Url",\n    listColumn: true,',
    );
  });

  test("adminUsers.avatarUrl is upgraded to image", async () => {
    const { adminUsers } = await import("../../src/db/schema");
    const source = emitModelFile(buildTableModel("adminUsers", adminUsers));
    expect(source).toContain("avatarUrl: z.url().nullable(),");
    expect(source).toContain('type: "image"');
  });

  test("unmapped tables never get the image kind (books fixture)", () => {
    const source = emitModelFile(buildTableModel("books", books));
    expect(source).not.toContain('"image"');
  });
});

// Inline snapshot (not a read of the shipped file — that one is a scaffold the
// developer may hand-tune). Documents exactly what a fresh scaffold looks like.
const EXPECTED_CATEGORY_SOURCE = `// Generated by scripts/generate-schemas.ts — review the TODO(generator)
// comments and hand-tune labels, limits, and field flags before shipping.
// Regenerating with --force discards hand edits.

import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

// Shared property shapes; create adds defaults, update goes fully partial.
const CategoryBaseSchema = z.object({
  name: z.string().min(1), // TODO(generator): tune max length
  description: z.string().nullable(),
});

export const CategoryCreateSchema = CategoryBaseSchema.extend({
  description: CategoryBaseSchema.shape.description.default(null),
}).openapi("CategoryCreate");

export const CategoryUpdateSchema = CategoryBaseSchema.partial().openapi("CategoryUpdate");

// Public wire shape — dates cross as ISO strings.
export const CategorySchema = z
  .object({
    id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
  })
  .openapi("Category");

export type Category = z.infer<typeof CategorySchema>;
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof CategoryUpdateSchema>;

// Drives the generic admin list/form rendering.
export const categoryFields: ResourceField[] = [
  {
    name: "name",
    type: "string",
    label: "Name",
    required: true,
    listColumn: true,
    searchable: true,
  },
  {
    name: "description",
    type: "text",
    label: "Description",
  },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
];
`;

describe("emitModelFile (categories) — full-source snapshot", () => {
  test("emits the documented scaffold byte-for-byte (already biome-clean)", () => {
    const source = emitModelFile(buildTableModel("categories", categories));
    expect(source).toBe(EXPECTED_CATEGORY_SOURCE);
  });
});

describe("generated category schemas (artifact sanity, mirrors post-schemas.test.ts)", () => {
  test("CategoryCreateSchema accepts a minimal category (description defaults to null)", () => {
    const parsed = CategoryCreateSchema.parse({ name: "News" });
    expect(parsed.name).toBe("News");
    expect(parsed.description).toBeNull();
  });

  test("CategoryCreateSchema rejects an empty name", () => {
    expect(() => CategoryCreateSchema.parse({ name: "" })).toThrow();
  });

  test("CategoryUpdateSchema accepts a partial update", () => {
    expect(CategoryUpdateSchema.parse({ description: "All the news" })).toEqual({
      description: "All the news",
    });
  });

  test("CategorySchema describes the wire shape (ISO dates)", () => {
    const parsed = CategorySchema.parse({
      id: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f",
      name: "News",
      description: null,
      createdAt: "2026-07-06T00:00:00.000Z",
    });
    expect(parsed.name).toBe("News");
  });

  test("categoryFields are valid ResourceFields naming only CategorySchema properties", () => {
    const outputKeys = Object.keys(CategorySchema.shape);
    for (const field of categoryFields) {
      ResourceFieldSchema.parse(field);
      expect(outputKeys).toContain(field.name);
    }
  });
});
