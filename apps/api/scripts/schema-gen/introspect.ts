// Drizzle table → TableModel intermediate representation. All drizzle-orm
// introspection is confined to this file; emit.ts only sees the IR.

import { getTableColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { kebabCase, pascalCase, singularize } from "./naming";

/** Internal auth plumbing — never wire-exposed, so never scaffolded (schemas or modules). */
export const EXCLUDED_TABLES = new Set(["refresh_tokens", "admin_sessions"]);

/** Column names that read as long-form text regardless of nullability. */
const TEXT_LIKE_NAMES = new Set(["content", "description", "body", "notes"]);
/**
 * Columns edited with the admin rich text editor (HTML strings), keyed by
 * tableKey. Listed here so `--force` regeneration keeps emitting the
 * "richtext" kind instead of reverting the field to plain "text".
 */
const RICHTEXT_COLUMNS: Record<string, readonly string[]> = {
  posts: ["content"],
};
/**
 * Columns holding image URLs (avatar in lists, URL input + preview in forms),
 * keyed by tableKey. Explicit opt-in — a `*Url` name alone stays plain "url".
 */
const IMAGE_COLUMNS: Record<string, readonly string[]> = {
  adminUsers: ["avatarUrl"],
  posts: ["coverImageUrl"],
};
const AUTO_TIMESTAMP_NAMES = new Set(["createdAt", "updatedAt"]);
const DISPLAY_FIELD_CANDIDATES = ["name", "title", "email"] as const;

interface ColumnBase {
  /** TS property key on the table — also the wire/JSON name. */
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  /** Literal default when drizzle holds a plain value (enum "draft", boolean true, …). */
  defaultValue?: string | number | boolean;
  /** Generator uncertainty, surfaced as a TODO comment in the emitted source. */
  note?: string;
}

export type ColumnModel = ColumnBase &
  (
    | { kind: "id" }
    | { kind: "enum"; enumName: string; values: readonly string[] }
    | {
        kind:
          | "string"
          | "text"
          | "richtext"
          | "email"
          | "url"
          | "image"
          | "boolean"
          | "int"
          | "number"
          | "uuid";
      }
    | {
        kind: "relation";
        targetTableName: string;
        displayField: string;
        displayFieldGuessed: boolean;
      }
    | { kind: "timestamp"; auto: boolean }
    | { kind: "unknown"; columnType: string }
  );

export interface TableModel {
  /** Export key in db/schema (e.g. "adminUsers"). */
  tableKey: string;
  /** Database name (e.g. "admin_users"). */
  tableName: string;
  /** Singular PascalCase model name (e.g. "AdminUser"). */
  pascalName: string;
  /** Basename of the generated file (e.g. "admin-user"). */
  fileBase: string;
  /** Name of the fields metadata const (e.g. "adminUserFields"). */
  fieldsConstName: string;
  columns: ColumnModel[];
  warnings: string[];
}

// Drizzle's column class doesn't expose these uniformly in its public types.
interface IntrospectedColumn {
  name: string;
  columnType: string;
  notNull: boolean;
  hasDefault: boolean;
  primary: boolean;
  default?: unknown;
  enumValues?: string[];
  enum?: { enumName: string };
}

/** All PgTable exports of a schema barrel, keyed by export name. */
export function discoverTables(mod: Record<string, unknown>): Map<string, PgTable> {
  const tables = new Map<string, PgTable>();
  for (const [key, value] of Object.entries(mod)) {
    if (is(value, PgTable)) tables.set(key, value);
  }
  return tables;
}

function guessDisplayField(target: PgTable): { displayField: string; guessed: boolean } {
  const targetKeys = Object.keys(getTableColumns(target));
  for (const candidate of DISPLAY_FIELD_CANDIDATES) {
    if (targetKeys.includes(candidate)) return { displayField: candidate, guessed: false };
  }
  return { displayField: "id", guessed: true };
}

/** FK lookups keyed by the referencing column's *database* name. */
function buildForeignKeyMap(table: PgTable, warnings: string[]): Map<string, PgTable> {
  const fkByDbName = new Map<string, PgTable>();
  for (const fk of getTableConfig(table).foreignKeys) {
    const ref = fk.reference();
    const referencingColumn = ref.columns.length === 1 ? ref.columns[0] : undefined;
    if (!referencingColumn) {
      warnings.push("composite foreign key skipped — wire it up by hand");
      continue;
    }
    fkByDbName.set(referencingColumn.name, ref.foreignTable as PgTable);
  }
  return fkByDbName;
}

function classifyColumn(
  key: string,
  column: IntrospectedColumn,
  fkByDbName: Map<string, PgTable>,
): ColumnModel {
  const base: ColumnBase = { name: key, notNull: column.notNull, hasDefault: column.hasDefault };
  const defaultType = typeof column.default;
  if (defaultType === "string" || defaultType === "number" || defaultType === "boolean") {
    base.defaultValue = column.default as string | number | boolean;
  } else if (column.hasDefault && column.columnType !== "PgTimestamp" && !column.primary) {
    base.note = "non-literal default in drizzle — Create schema omits .default(...)";
  }

  if (column.primary && column.columnType === "PgUUID" && key === "id") {
    return { ...base, kind: "id" };
  }

  const target = fkByDbName.get(column.name);
  if (target && column.columnType === "PgUUID") {
    const { displayField, guessed } = guessDisplayField(target);
    return {
      ...base,
      kind: "relation",
      targetTableName: getTableName(target),
      displayField,
      displayFieldGuessed: guessed,
    };
  }

  if (column.columnType === "PgEnumColumn" && column.enumValues && column.enum) {
    return { ...base, kind: "enum", enumName: column.enum.enumName, values: column.enumValues };
  }

  switch (column.columnType) {
    case "PgTimestamp":
      return { ...base, kind: "timestamp", auto: AUTO_TIMESTAMP_NAMES.has(key) };
    case "PgUUID":
      return { ...base, kind: "uuid" };
    case "PgText":
    case "PgVarchar": {
      if (key === "email") return { ...base, kind: "email" };
      if (key.endsWith("Url")) return { ...base, kind: "url" };
      if (!column.notNull || TEXT_LIKE_NAMES.has(key)) return { ...base, kind: "text" };
      return { ...base, kind: "string" };
    }
    case "PgBoolean":
      return { ...base, kind: "boolean" };
    case "PgInteger":
    case "PgSmallInt":
    case "PgSerial":
    case "PgSmallSerial":
    case "PgBigInt53":
    case "PgBigSerial53":
      return { ...base, kind: "int" };
    case "PgReal":
    case "PgDoublePrecision":
      return { ...base, kind: "number" };
    case "PgNumeric":
      return {
        ...base,
        kind: "number",
        note: "drizzle returns numeric as string at runtime — verify before trusting z.number()",
      };
    default:
      return { ...base, kind: "unknown", columnType: column.columnType };
  }
}

export function buildTableModel(tableKey: string, table: PgTable): TableModel {
  const warnings: string[] = [];
  const singular = singularize(tableKey);
  const fkByDbName = buildForeignKeyMap(table, warnings);
  const richTextNames = RICHTEXT_COLUMNS[tableKey] ?? [];
  const imageNames = IMAGE_COLUMNS[tableKey] ?? [];
  const columns = Object.entries(getTableColumns(table)).map(([key, column]) => {
    const model = classifyColumn(key, column as unknown as IntrospectedColumn, fkByDbName);
    // Upgrade after classification so classifyColumn stays tableKey-agnostic.
    if (richTextNames.includes(key) && (model.kind === "text" || model.kind === "string")) {
      return { ...model, kind: "richtext" as const };
    }
    if (
      imageNames.includes(key) &&
      (model.kind === "url" || model.kind === "text" || model.kind === "string")
    ) {
      return { ...model, kind: "image" as const };
    }
    return model;
  });

  const config = getTableConfig(table);
  const primaryColumns = columns.filter((column) => column.kind === "id");
  if (config.primaryKeys.length > 0) {
    warnings.push("composite primary key — generated file skips the uuid id convention");
  } else if (primaryColumns.length === 0) {
    warnings.push("no uuid `id` primary key found — generated file skips the id convention");
  }
  for (const column of columns) {
    if (column.kind === "unknown") {
      warnings.push(
        `column "${column.name}" has unmapped type ${column.columnType} — emitted as z.unknown()`,
      );
    }
  }

  return {
    tableKey,
    tableName: getTableName(table),
    pascalName: pascalCase(singular),
    fileBase: kebabCase(singular),
    fieldsConstName: `${singular}Fields`,
    columns,
    warnings,
  };
}
