import "../setup";

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { detectDrift, upsertBarrelLine } from "../../scripts/schema-gen/drift";
import { buildTableModel } from "../../scripts/schema-gen/introspect";
import { posts, users } from "../../src/db/schema";

describe("detectDrift", () => {
  test("returns null when the module exports no output schema for the model", () => {
    const model = buildTableModel("posts", posts);
    expect(detectDrift(model, {})).toBeNull();
    expect(detectDrift(model, { PostSchema: "not a schema" })).toBeNull();
  });

  test("reports table columns missing from the schema", () => {
    const model = buildTableModel("posts", posts);
    const staleModule = {
      // PostSchema frozen before categoryId was added to the table.
      PostSchema: z.object({
        id: z.uuid(),
        title: z.string(),
        status: z.string(),
        content: z.string().nullable(),
        coverImageUrl: z.url().nullable(),
        authorId: z.uuid(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      }),
    };
    const drift = detectDrift(model, staleModule);
    expect(drift).toEqual({ missingInSchema: ["categoryId"], extraInSchema: [] });
  });

  test("reports schema keys that no longer exist on the table", () => {
    const model = buildTableModel("posts", posts);
    const aheadModule = {
      PostSchema: z.object({
        id: z.uuid(),
        title: z.string(),
        status: z.string(),
        content: z.string().nullable(),
        coverImageUrl: z.url().nullable(),
        categoryId: z.uuid().nullable(),
        authorId: z.uuid(),
        legacySlug: z.string(), // column was dropped from the table
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      }),
    };
    const drift = detectDrift(model, aheadModule);
    expect(drift).toEqual({ missingInSchema: [], extraInSchema: ["legacySlug"] });
  });

  test("DRIFT_IGNORE hides deliberately off-wire user columns", () => {
    const model = buildTableModel("users", users);
    const publicModule = {
      // Mirrors the real UserSchema: no passwordHash, no updatedAt, no
      // lastWorkspaceId.
      UserSchema: z.object({
        id: z.uuid(),
        email: z.email(),
        name: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    };
    expect(detectDrift(model, publicModule)).toEqual({ missingInSchema: [], extraInSchema: [] });
  });
});

describe("upsertBarrelLine", () => {
  const barrel = `export * from "./admin-user";
export * from "./post";
export * from "./user";
`;

  test("inserts a new export in sorted order", () => {
    expect(upsertBarrelLine(barrel, "category")).toBe(`export * from "./admin-user";
export * from "./category";
export * from "./post";
export * from "./user";
`);
  });

  test("is idempotent", () => {
    const once = upsertBarrelLine(barrel, "category");
    expect(upsertBarrelLine(once, "category")).toBe(once);
  });

  test("preserves non-export lines (comments) ahead of the sorted exports", () => {
    const withComment = `// keystone barrel\n${barrel}`;
    const result = upsertBarrelLine(withComment, "category");
    expect(result.startsWith("// keystone barrel\n")).toBe(true);
    expect(result).toContain('export * from "./category";');
  });
});
