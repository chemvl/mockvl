// TableModel → house-style source text (see packages/schemas/src/post.ts, the
// golden template). Output is roughly formatted; the CLI runs biome afterwards.

import type { ColumnModel, TableModel } from "./introspect";
import { constantCase, kebabCase, pascalCase, pluralize, titleCase } from "./naming";

// Fixed examples keep regeneration byte-identical (post.ts uses the same ids).
const EXAMPLE_ID = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";
const EXAMPLE_RELATION_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";
const EXAMPLE_DATETIME = "2026-07-06T00:00:00.000Z";
const EXAMPLE_EMAIL = "user@example.com";

type EnumColumn = Extract<ColumnModel, { kind: "enum" }>;

function enumConstName(column: EnumColumn): string {
  return constantCase(pluralize(column.enumName));
}

function enumSchemaName(column: EnumColumn): string {
  return `${pascalCase(column.enumName)}Schema`;
}

export function isCreateColumn(column: ColumnModel): boolean {
  if (column.kind === "id") return false;
  if (column.kind === "timestamp" && column.auto) return false;
  return true;
}

/** Zod expression for a Base (create/update) property, plus TODO notes. */
function createExpr(column: ColumnModel): { expr: string; notes: string[] } {
  const notes = column.note ? [column.note] : [];
  let expr: string;
  switch (column.kind) {
    case "enum":
      expr = enumSchemaName(column);
      break;
    case "string":
      expr = "z.string().min(1)";
      notes.push("tune max length");
      break;
    case "text":
    case "richtext":
      expr = "z.string()";
      break;
    case "email":
      expr = "z.email()";
      break;
    case "url":
    case "image":
      expr = "z.url()";
      break;
    case "uuid":
    case "relation":
      expr = "z.uuid()";
      break;
    case "boolean":
      expr = "z.boolean()";
      break;
    case "int":
      expr = "z.number().int()";
      break;
    case "number":
      expr = "z.number()";
      break;
    case "timestamp":
      expr = "z.iso.datetime()";
      break;
    default:
      expr = "z.unknown()";
      notes.push("unmapped column type — refine by hand");
  }
  if (!column.notNull) expr += ".nullable()";
  return { expr, notes };
}

/** Zod expression for the public wire (output) shape. */
function outputExpr(column: ColumnModel): string {
  let expr: string;
  let example: string | undefined;
  switch (column.kind) {
    case "id":
      expr = "z.uuid()";
      example = EXAMPLE_ID;
      break;
    case "enum":
      return enumSchemaName(column);
    case "string":
    case "text":
    case "richtext":
      expr = "z.string()";
      break;
    case "email":
      expr = "z.email()";
      example = EXAMPLE_EMAIL;
      break;
    case "url":
    case "image":
      expr = "z.url()";
      break;
    case "uuid":
    case "relation":
      expr = "z.uuid()";
      example = EXAMPLE_RELATION_ID;
      break;
    case "boolean":
      expr = "z.boolean()";
      break;
    case "int":
      expr = "z.number().int()";
      break;
    case "number":
      expr = "z.number()";
      break;
    case "timestamp":
      expr = "z.iso.datetime()";
      example = EXAMPLE_DATETIME;
      break;
    default:
      expr = "z.unknown()";
  }
  if (!column.notNull) expr += ".nullable()";
  if (example) expr += `.openapi({ example: ${JSON.stringify(example)} })`;
  return expr;
}

/** `.default(...)` overrides for the Create schema, in column order. */
function createDefaultEntries(model: TableModel, createColumns: ColumnModel[]): string[] {
  const baseName = `${model.pascalName}BaseSchema`;
  const entries: string[] = [];
  for (const column of createColumns) {
    if (column.kind === "enum" && typeof column.defaultValue === "string") {
      entries.push(
        `  ${column.name}: ${enumSchemaName(column)}.default(${JSON.stringify(column.defaultValue)}),`,
      );
    } else if (!column.notNull) {
      entries.push(`  ${column.name}: ${baseName}.shape.${column.name}.default(null),`);
    } else if (column.defaultValue !== undefined) {
      entries.push(
        `  ${column.name}: ${baseName}.shape.${column.name}.default(${JSON.stringify(column.defaultValue)}),`,
      );
    }
  }
  return entries;
}

function fieldLines(model: TableModel): string[] {
  const fieldColumns = model.columns.filter(
    (column) =>
      column.kind !== "id" &&
      column.kind !== "unknown" &&
      !(column.kind === "timestamp" && column.auto && column.name === "updatedAt"),
  );
  const firstStringColumn = fieldColumns.find(
    (column) => ["string", "email", "url"].includes(column.kind) && column.notNull,
  );

  const lines: string[] = [];
  for (const column of fieldColumns) {
    const props: string[] = [`    name: ${JSON.stringify(column.name)},`];
    const required = column.notNull && !column.hasDefault;
    const label = titleCase(column.name);

    if (column.kind === "enum") {
      props.push(`    type: "enum",`, `    label: ${JSON.stringify(label)},`);
      props.push(`    options: [...${enumConstName(column)}],`);
      if (required) props.push("    required: true,");
      props.push("    listColumn: true,", "    filterable: true,");
    } else if (column.kind === "relation") {
      lines.push("  // TODO(generator): confirm the resource slug matches its registry name.");
      if (column.displayFieldGuessed) {
        lines.push(
          `  // TODO(generator): ${column.targetTableName} has no name/title/email column — displayField guessed as "id".`,
        );
      }
      props.push(`    type: "relation",`);
      props.push(`    label: ${JSON.stringify(label.replace(/ Id$/, ""))},`);
      props.push(`    resource: ${JSON.stringify(kebabCase(column.targetTableName))},`);
      props.push(`    displayField: ${JSON.stringify(column.displayField)},`);
      if (required) props.push("    required: true,");
      props.push("    listColumn: true,", "    filterable: true,");
    } else if (column.kind === "timestamp") {
      props.push(`    type: "date",`);
      props.push(`    label: ${JSON.stringify(column.auto ? "Created" : label)},`);
      if (column.auto)
        props.push("    listColumn: true,", "    sortable: true,", "    readOnly: true,");
      else if (required) props.push("    required: true,");
    } else {
      const type =
        column.kind === "boolean"
          ? "boolean"
          : column.kind === "int" || column.kind === "number"
            ? "number"
            : column.kind === "richtext"
              ? "richtext"
              : column.kind === "image"
                ? "image"
                : column.kind === "text"
                  ? "text"
                  : "string";
      props.push(`    type: ${JSON.stringify(type)},`, `    label: ${JSON.stringify(label)},`);
      if (required) props.push("    required: true,");
      // Image columns render as small avatars — always table-friendly.
      if (column === firstStringColumn || column.kind === "image")
        props.push("    listColumn: true,");
      if (column === firstStringColumn || column.kind === "email")
        props.push("    searchable: true,");
    }

    lines.push("  {", ...props, "  },");
  }
  return lines;
}

export function emitModelFile(model: TableModel): string {
  const name = model.pascalName;
  const idColumn = model.columns.find((column) => column.kind === "id");
  const createColumns = model.columns.filter(isCreateColumn);
  const outputColumns = idColumn ? model.columns : model.columns.filter((c) => c.kind !== "id");

  const lines: string[] = [
    "// Generated by scripts/generate-schemas.ts — review the TODO(generator)",
    "// comments and hand-tune labels, limits, and field flags before shipping.",
    "// Regenerating with --force discards hand edits.",
    "",
    'import { z } from "@hono/zod-openapi";',
    'import type { ResourceField } from "./resource";',
    "",
  ];

  const seenEnums = new Set<string>();
  for (const column of model.columns) {
    if (column.kind !== "enum" || seenEnums.has(column.enumName)) continue;
    seenEnums.add(column.enumName);
    const constName = enumConstName(column);
    const typeName = pascalCase(column.enumName);
    lines.push(
      `export const ${constName} = [${column.values.map((value) => JSON.stringify(value)).join(", ")}] as const;`,
      `export const ${typeName}Schema = z.enum(${constName}).openapi(${JSON.stringify(typeName)});`,
      `export type ${typeName} = z.infer<typeof ${typeName}Schema>;`,
      "",
    );
  }

  if (createColumns.length > 0) {
    lines.push("// Shared property shapes; create adds defaults, update goes fully partial.");
    lines.push(`const ${name}BaseSchema = z.object({`);
    for (const column of createColumns) {
      const { expr, notes } = createExpr(column);
      const comment = notes.length > 0 ? ` // TODO(generator): ${notes.join("; ")}` : "";
      lines.push(`  ${column.name}: ${expr},${comment}`);
    }
    lines.push("});", "");

    const defaults = createDefaultEntries(model, createColumns);
    if (defaults.length > 0) {
      lines.push(`export const ${name}CreateSchema = ${name}BaseSchema.extend({`);
      lines.push(...defaults);
      lines.push(`}).openapi(${JSON.stringify(`${name}Create`)});`);
    } else {
      lines.push(
        `export const ${name}CreateSchema = ${name}BaseSchema.openapi(${JSON.stringify(`${name}Create`)});`,
      );
    }
    lines.push("");
    lines.push(
      `export const ${name}UpdateSchema = ${name}BaseSchema.partial().openapi(${JSON.stringify(`${name}Update`)});`,
      "",
    );
  }

  lines.push("// Public wire shape — dates cross as ISO strings.");
  lines.push(`export const ${name}Schema = z`, "  .object({");
  for (const column of outputColumns) {
    lines.push(`    ${column.name}: ${outputExpr(column)},`);
  }
  lines.push("  })", `  .openapi(${JSON.stringify(name)});`, "");

  lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`);
  if (createColumns.length > 0) {
    lines.push(
      `export type ${name}Create = z.infer<typeof ${name}CreateSchema>;`,
      `export type ${name}Update = z.infer<typeof ${name}UpdateSchema>;`,
    );
  }
  lines.push("");

  lines.push("// Drives the generic admin list/form rendering.");
  lines.push(`export const ${model.fieldsConstName}: ResourceField[] = [`);
  lines.push(...fieldLines(model));
  lines.push("];", "");

  return lines.join("\n");
}
