import "../setup";

import { describe, expect, test } from "bun:test";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  emitE2eTestFile,
  emitPublicFieldsBlock,
  emitRepoFile,
  emitRoutesFile,
  emitServiceFile,
  emitUnitTestFile,
  listableColumns,
  selectPublicColumns,
} from "../../scripts/module-gen/emit";
import { buildModuleNames } from "../../scripts/module-gen/names";
import { buildTableModel } from "../../scripts/schema-gen/introspect";
import { posts } from "../../src/db/schema";

// A users-like table: the schema shape below deliberately exposes
// passwordHash to prove the emitter refuses to serialize it anyway.
const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const accountsModel = buildTableModel("accounts", accounts);
const accountsNames = buildModuleNames(accountsModel);
const accountsPublic = selectPublicColumns(accountsModel, [
  "id",
  "email",
  "passwordHash",
  "createdAt",
  "ghostField",
]);

const postsModel = buildTableModel("posts", posts);
const postsNames = buildModuleNames(postsModel);
// The real PostSchema shape keys, in schema order.
const postsPublic = selectPublicColumns(postsModel, [
  "id",
  "title",
  "status",
  "content",
  "coverImageUrl",
  "categoryId",
  "authorId",
  "createdAt",
  "updatedAt",
]);

describe("buildModuleNames", () => {
  test("derives the full identifier set from the table model", () => {
    expect(accountsNames).toMatchObject({
      moduleName: "accounts",
      pluralPascal: "Accounts",
      modelType: "Account",
      singularCamel: "account",
      schemaName: "AccountSchema",
      publicFieldsName: "publicAccountFields",
      serviceKey: "accountsService",
      repoKey: "accountsRepo",
      repoFactory: "createAccountsRepo",
      serviceType: "AccountsService",
      routesFactory: "createAccountsRoutes",
      serializerName: "serializeAccount",
    });
    expect(accountsNames.paths.repo).toBe("apps/api/src/modules/accounts/accounts.repo.ts");
    expect(accountsNames.paths.e2eTest).toBe("apps/api/tests/e2e/accounts-e2e.test.ts");
  });
});

describe("selectPublicColumns", () => {
  test("drops sensitive columns and reports schema keys with no table column", () => {
    expect(accountsPublic.columns.map((column) => column.name)).toEqual([
      "id",
      "email",
      "createdAt",
    ]);
    expect(accountsPublic.skipped).toEqual(["passwordHash"]);
    expect(accountsPublic.extraInSchema).toEqual(["ghostField"]);
  });

  test("keeps schema-shape order for the serializer", () => {
    expect(postsPublic.columns.map((column) => column.name)).toEqual([
      "id",
      "title",
      "status",
      "content",
      "coverImageUrl",
      "categoryId",
      "authorId",
      "createdAt",
      "updatedAt",
    ]);
    expect(postsPublic.extraInSchema).toEqual([]);
  });
});

describe("emitRepoFile", () => {
  const source = emitRepoFile(postsNames, postsPublic);

  test("columns map holds id plus exactly the listable columns", () => {
    const listable = listableColumns(postsPublic).map((column) => column.name);
    // updatedAt is an auto timestamp and plain uuids aren't listable.
    expect(listable).toEqual([
      "title",
      "status",
      "content",
      "coverImageUrl",
      "categoryId",
      "authorId",
      "createdAt",
    ]);
    for (const name of listable) {
      expect(source).toContain(`${name}: posts.${name},`);
    }
    expect(source).toContain("id: posts.id,");
  });

  test("never exposes a sensitive column even when the schema does", () => {
    const accountsSource = emitRepoFile(accountsNames, accountsPublic);
    expect(accountsSource).not.toContain("passwordHash");
  });

  test("carries the guide's list machinery and the id tiebreaker", () => {
    expect(source).toContain("asc(posts.id),");
    expect(source).toContain("count(*)::int");
    expect(source).toContain("function escapeLike");
    expect(source).toContain('return value.replace(/[\\\\%_]/g, "\\\\$&");');
    expect(source).toContain("export type PostsRepo = ReturnType<typeof createPostsRepo>;");
  });
});

describe("emitServiceFile", () => {
  const source = emitServiceFile(postsNames);

  test("throws NotFoundError from getById and never imports Hono", () => {
    expect(source).toContain('new NotFoundError("Post not found")');
    expect(source).not.toContain("hono");
    expect(source).toContain("export type PostsService = ReturnType<typeof createPostsService>;");
  });
});

describe("emitRoutesFile", () => {
  const publicSource = emitRoutesFile(postsNames, postsPublic, { isProtected: false });
  const protectedSource = emitRoutesFile(postsNames, postsPublic, { isProtected: true });

  test("serializer maps timestamps through toISOString", () => {
    expect(publicSource).toContain("createdAt: row.createdAt.toISOString(),");
    expect(publicSource).toContain("updatedAt: row.updatedAt.toISOString(),");
    expect(publicSource).toContain("title: row.title,");
  });

  test("nullable timestamps serialize conditionally", () => {
    const deleted = pgTable("archived_notes", {
      id: uuid("id").primaryKey().defaultRandom(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    });
    const model = buildTableModel("archivedNotes", deleted);
    const names = buildModuleNames(model);
    const source = emitRoutesFile(names, selectPublicColumns(model, ["id", "deletedAt"]), {
      isProtected: false,
    });
    expect(source).toContain("deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,");
  });

  test("schema keys with no table column become a deliberate typecheck TODO", () => {
    const source = emitRoutesFile(accountsNames, accountsPublic, { isProtected: false });
    expect(source).toContain('"ghostField" is in the output schema');
  });

  test("public variant has no auth; --protected wires middleware + docs + 401", () => {
    expect(publicSource).not.toContain("authMiddleware");
    expect(publicSource).not.toContain("bearerAuth");
    expect(protectedSource).toContain("router.use(authMiddleware());");
    expect(protectedSource).toContain("security: [{ bearerAuth: [] }],");
    expect(protectedSource).toContain(
      '401: errorResponse("Missing, invalid, or expired access token"),',
    );
  });

  test("list parses the query against the public allow-list", () => {
    expect(publicSource).toContain("parseListQuery(c.req.query(), publicPostFields)");
  });
});

describe("emitPublicFieldsBlock", () => {
  const block = emitPublicFieldsBlock(postsNames, postsPublic);

  test("flags follow the column kinds", () => {
    expect(block).toContain("export const publicPostFields: ResourceField[] = [");
    // strings search, enums/relations filter, createdAt sorts.
    expect(block).toContain('{ name: "title", type: "string", label: "Title", searchable: true }');
    expect(block).toContain('type: "enum"');
    expect(block).toContain('options: ["draft", "published"]');
    expect(block).toContain(
      '{ name: "categoryId", type: "relation", label: "Category", resource: "categories", displayField: "name", filterable: true }',
    );
    expect(block).toContain(
      '{ name: "createdAt", type: "date", label: "Created", sortable: true }',
    );
    expect(block).not.toContain('"updatedAt"');
  });
});

describe("emitted tests", () => {
  test("unit test uses a fake repo and asserts the NotFoundError contract", () => {
    const source = emitUnitTestFile(postsNames);
    expect(source).toContain("const fakeRepo: PostsRepo = {");
    expect(source).toContain("rejects.toBeInstanceOf(NotFoundError)");
  });

  test("e2e test is seed-free and wires the service through CreateAppOptions", () => {
    const source = emitE2eTestFile(postsNames, { isProtected: false });
    expect(source).toContain(
      "postsService: createPostsService({ postsRepo: createPostsRepo(db) })",
    );
    expect(source).toContain("prepareTestDatabase()");
    expect(source).toContain('"/api/posts"');
    expect(source).not.toContain("sign(");
  });

  test("protected e2e mints an access token and asserts the 401 envelope", () => {
    const source = emitE2eTestFile(postsNames, { isProtected: true });
    expect(source).toContain('import { sign } from "hono/jwt";');
    expect(source).toContain('type: "access"');
    expect(source).toContain('expect(body.error.code).toBe("UNAUTHORIZED");');
    expect(source).toContain("{ headers: AUTH }");
  });
});
