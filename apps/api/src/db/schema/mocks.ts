import type {
  CustomEndpoint,
  OperationMethod,
  OperationSummary,
  VersionDiff,
} from "@starter/schemas";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Value sets mirror MOCK_* / SCHEMA_FORMATS in packages/schemas/src/mock.ts.
export const mockStatus = pgEnum("mock_status", ["running", "paused"]);
export const mockResponseMode = pgEnum("mock_response_mode", ["static", "dynamic"]);
export const mockSourceType = pgEnum("mock_source_type", ["file", "url", "custom"]);
export const mockVersionAction = pgEnum("mock_version_action", [
  "create",
  "replace",
  "resync",
  "restore",
  "edit",
]);
export const schemaFormat = pgEnum("schema_format", ["openapi3", "postman2"]);

export const mocks = pgTable(
  "mocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // FK is DEFERRABLE INITIALLY DEFERRED via hand-written migration 0010
    // (drizzle-kit can't express it): deleting a workspace owner otherwise
    // fails when created_by/updated_by SET NULL re-check a cascaded workspace.
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 40 }).notNull(),
    status: mockStatus("status").notNull().default("running"),
    responseMode: mockResponseMode("response_mode").notNull().default("static"),
    validateRequests: boolean("validate_requests").notNull().default(true),
    cors: boolean("cors").notNull().default(true),
    sourceType: mockSourceType("source_type").notNull(),
    sourceUrl: text("source_url"),
    // Circular with mock_versions.mock_id; AnyPgColumn breaks the type cycle.
    liveVersionId: uuid("live_version_id").references((): AnyPgColumn => mockVersions.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("mocks_workspace_slug_idx").on(table.workspaceId, table.slug),
    index("mocks_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ],
);

export const mockVersions = pgTable(
  "mock_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mockId: uuid("mock_id")
      .notNull()
      .references(() => mocks.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    action: mockVersionAction("action").notNull(),
    // Filename or URL the content came from.
    sourceLabel: text("source_label").notNull(),
    restoredFrom: integer("restored_from"),
    format: schemaFormat("format").notNull(),
    specVersion: text("spec_version").notNull(),
    // Raw original text; re-parsed by the mock runtime on cache miss.
    content: text("content").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    endpointCount: integer("endpoint_count").notNull(),
    exampleCount: integer("example_count").notNull(),
    operations: jsonb("operations").$type<OperationSummary[]>().notNull(),
    // Null for v1 (nothing to diff against).
    diff: jsonb("diff").$type<VersionDiff>(),
    // Custom mocks only (spec 2026-10-15): the endpoint list the editor reads
    // and writes; `content` is generated from it. Null for imported mocks.
    customEndpoints: jsonb("custom_endpoints").$type<CustomEndpoint[]>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mock_versions_mock_number_idx").on(table.mockId, table.number)],
);

// Hourly request counters flushed from Redis (jobs/workers/flush-mock-usage.ts).
export const mockUsageHourly = pgTable(
  "mock_usage_hourly",
  {
    mockId: uuid("mock_id")
      .notNull()
      .references(() => mocks.id, { onDelete: "cascade" }),
    // Truncated to the hour, UTC.
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    requests: integer("requests").notNull().default(0),
    clientErrors: integer("client_errors").notNull().default(0),
    serverErrors: integer("server_errors").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.mockId, table.hour] })],
);

// Saved response bodies (spec 2026-10-08-mock-response-overrides). Owned by
// the mock, not a version: replace / re-sync / restore never touch them. A row
// whose endpoint or code is absent from the live version is dormant — kept,
// listed, never served.
export const mockResponseOverrides = pgTable(
  "mock_response_overrides",
  {
    mockId: uuid("mock_id")
      .notNull()
      .references(() => mocks.id, { onDelete: "cascade" }),
    // Lowercase; same value set as OperationSummary.method.
    method: text("method").$type<OperationMethod>().notNull(),
    // Path template, e.g. /pets/{id}.
    path: text("path").notNull(),
    // 100–599, enforced by the API schema.
    statusCode: smallint("status_code").notNull(),
    // The saved text byte for byte (formatting kept).
    body: text("body").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.mockId, table.method, table.path, table.statusCode] })],
);

export type MockRow = typeof mocks.$inferSelect;
export type NewMockRow = typeof mocks.$inferInsert;
export type MockVersionRow = typeof mockVersions.$inferSelect;
export type NewMockVersionRow = typeof mockVersions.$inferInsert;
export type MockResponseOverrideRow = typeof mockResponseOverrides.$inferSelect;
