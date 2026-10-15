// Auto-registration of generated models: each new model gets its own
// src/admin/registry/resources/<name>.resource.ts scaffold, wired into
// resources.ts (the index) with an import + registry.register() line.
// Pure functions over source text (no I/O, mirrors drift.ts) — string/regex
// edits with resilient anchors. Every mutating function either returns a fully
// edited copy or throws RegistryEditError; the file is never half-edited.

import { isCreateColumn } from "./emit";
import type { TableModel } from "./introspect";
import { kebabCase, titleCase } from "./naming";

// Kept in sync with RESERVED_RESOURCE_NAMES in src/admin/registry/registry.ts —
// registering either would crash the API at boot.
const RESERVED_RESOURCE_NAMES = new Set(["auth", "meta"]);

/** An anchor is missing or the file shape is unrecognized — register by hand. */
export class RegistryEditError extends Error {}

export interface ResourceModule {
  /** Registry slug, e.g. "admin-users" — kebab of the DB table name, matching emit.ts relation slugs. */
  resourceName: string;
  /** Exported const, e.g. "adminUsersResource" — the db/schema barrel key + "Resource". */
  constName: string;
  /** File name under src/admin/registry/resources/, e.g. "admin-users.resource.ts". */
  fileName: string;
  /** Full source of the .resource.ts file, trailing newline included. */
  contents: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a resource def already claims the resource name OR the table.
 * `source` is the index plus every existing .resource.ts concatenated — the
 * defs (and their name:/table: lines) live in the resource files. The table
 * check matters when a resource is registered under a hand-picked name
 * (adminUsers ships as "admins", not "admin-users") — without it a
 * regeneration would register the same table twice and crash at boot.
 */
export function isRegistered(source: string, resourceName: string, tableKey: string): boolean {
  const namePattern = new RegExp(`name:\\s*["']${escapeRegExp(resourceName)}["']`);
  const tablePattern = new RegExp(`table:\\s*${escapeRegExp(tableKey)}\\s*[,}\\n]`);
  return namePattern.test(source) || tablePattern.test(source);
}

/**
 * Adds `import { <constName> } from "<modulePath>";` after the last top-level
 * import. Idempotent (returns the source unchanged when the module is already
 * imported). Appends without sorting — the CLI runs `biome check --write`
 * afterwards, and this repo's Biome assist (organizeImports) canonicalizes
 * the order.
 */
export function upsertResourceImport(
  source: string,
  constName: string,
  modulePath: string,
): string {
  if (source.includes(`from "${modulePath}"`)) return source;
  let lastImportEnd = -1;
  for (const match of source.matchAll(/^import\b[^;]*;/gm)) {
    lastImportEnd = match.index + match[0].length;
  }
  if (lastImportEnd === -1) {
    throw new RegistryEditError(
      "resources.ts has no import statements — add the import and register() call by hand",
    );
  }
  const statement = `\nimport { ${constName} } from "${modulePath}";`;
  return source.slice(0, lastImportEnd) + statement + source.slice(lastImportEnd);
}

/** Splices the block onto its own line right before `return registry;`. */
export function insertRegisterCall(source: string, block: string): string {
  const fnIdx = source.indexOf("createDefaultAdminRegistry(");
  if (fnIdx === -1) {
    throw new RegistryEditError(
      "resources.ts has no createDefaultAdminRegistry() — add the register() call by hand",
    );
  }
  const anchorIdx = source.indexOf("return registry;", fnIdx);
  if (anchorIdx === -1) {
    throw new RegistryEditError(
      "could not find `return registry;` inside createDefaultAdminRegistry — add the register() call by hand",
    );
  }
  const lineStart = source.lastIndexOf("\n", anchorIdx) + 1;
  return `${source.slice(0, lineStart)}${block}\n\n${source.slice(lineStart)}`;
}

/** Everything derived from the model: slug, const/file names, the .resource.ts source. */
export function buildResourceModule(model: TableModel): ResourceModule {
  const resourceName = kebabCase(model.tableName);
  const constName = `${model.tableKey}Resource`;
  const name = model.pascalName;
  // Tables with no writable columns get no Create/Update schemas from emit.ts,
  // so the def must ship read-only or typecheck/boot would fail.
  const hasCreate = model.columns.some(isCreateColumn);

  const schemaImports = hasCreate
    ? [`${name}CreateSchema`, `${name}Schema`, `${name}UpdateSchema`, model.fieldsConstName]
    : [`${name}Schema`, model.fieldsConstName];
  const schemaLines = hasCreate
    ? [
        "  schema: {",
        `    create: ${name}CreateSchema,`,
        `    update: ${name}UpdateSchema,`,
        `    output: ${name}Schema,`,
        "  },",
      ]
    : [`  schema: { output: ${name}Schema },`];
  const permissions = hasCreate
    ? '{ list: "viewer", create: "editor", update: "editor", delete: "owner" }'
    : '{ list: "viewer" }';

  const contents = [
    "// Generated scaffold — a static def. Convert to a factory taking deps as",
    "// params if the resource ever needs them (see admins.resource.ts).",
    "import {",
    ...schemaImports.map((specifier) => `  ${specifier},`),
    '} from "@starter/schemas";',
    `import { ${model.tableKey} } from "@/db/schema";`,
    'import type { AdminResourceDef } from "../registry";',
    "",
    `export const ${constName}: AdminResourceDef = {`,
    `  name: ${JSON.stringify(resourceName)},`,
    `  label: ${JSON.stringify(titleCase(model.tableName))},`,
    "  // TODO(generator): pick a real antd icon name.",
    '  icon: "TableOutlined",',
    `  table: ${model.tableKey},`,
    ...schemaLines,
    `  fields: ${model.fieldsConstName},`,
    "  // TODO(generator): review permissions before shipping.",
    `  permissions: ${permissions},`,
    "};",
    "",
  ].join("\n");

  return { resourceName, constName, fileName: `${resourceName}.resource.ts`, contents };
}

/** Orchestrator: detect → build file → wire index. Never partially edits. */
export function registerResource(
  indexSource: string,
  registeredSources: string,
  model: TableModel,
): {
  status: "inserted" | "already-registered";
  resourceName: string;
  indexSource: string;
  resourceFile?: { fileName: string; contents: string };
} {
  const module = buildResourceModule(model);
  if (RESERVED_RESOURCE_NAMES.has(module.resourceName)) {
    throw new RegistryEditError(
      `resource name "${module.resourceName}" is reserved (see registry.ts) — rename the table`,
    );
  }
  if (isRegistered(`${indexSource}\n${registeredSources}`, module.resourceName, model.tableKey)) {
    return { status: "already-registered", resourceName: module.resourceName, indexSource };
  }
  let next = upsertResourceImport(
    indexSource,
    module.constName,
    `./resources/${module.resourceName}.resource`,
  );
  next = insertRegisterCall(next, `  registry.register(${module.constName});`);
  return {
    status: "inserted",
    resourceName: module.resourceName,
    indexSource: next,
    resourceFile: { fileName: module.fileName, contents: module.contents },
  };
}
