// Scaffolds a public API module (repo → service → routes → tests → wiring)
// from a Drizzle table + its packages/schemas model file, following
// docs/GUIDE-api-development.md Section 1.
//
//   bun run module:generate categories               # public GET list + GET /:id
//   bun run module:generate posts --protected        # same, behind JWT bearer auth
//   bun run module:generate posts --force            # overwrite (discards hand edits!)
//
// The endpoints work immediately after generation; add write endpoints and
// visibility rules by hand (see the TODO(generator) comments).

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import * as wireSchemas from "@starter/schemas";
import * as dbSchema from "../src/db/schema";
import {
  emitE2eTestFile,
  emitPublicFieldsBlock,
  emitRepoFile,
  emitRoutesFile,
  emitServiceFile,
  emitUnitTestFile,
  selectPublicColumns,
} from "./module-gen/emit";
import { buildModuleNames, RESERVED_MODULE_SEGMENTS } from "./module-gen/names";
import {
  appendPublicFields,
  isMounted,
  ModuleWireError,
  wireAppDefaults,
  wireModulesIndex,
} from "./module-gen/wire";
import { detectDrift } from "./schema-gen/drift";
import { buildTableModel, discoverTables, EXCLUDED_TABLES } from "./schema-gen/introspect";
import { matchesArg } from "./schema-gen/naming";

const REPO_ROOT = join(import.meta.dir, "../../..");
const SCHEMAS_DIR = join(REPO_ROOT, "packages/schemas/src");
const MODULES_INDEX_PATH = join(REPO_ROOT, "apps/api/src/modules/index.ts");
const APP_DEFAULTS_PATH = join(REPO_ROOT, "apps/api/src/app.defaults.ts");

function usage(validNames: string[]): never {
  console.error("Usage: bun run module:generate <model> [--protected] [--force]");
  console.error(`Models: ${validNames.join(", ")}`);
  process.exit(1);
}

const args = Bun.argv.slice(2);
const force = args.includes("--force");
const isProtected = args.includes("--protected");
const positional = args.filter((arg) => !arg.startsWith("--"));
const unknownFlags = args.filter(
  (arg) => arg.startsWith("--") && arg !== "--force" && arg !== "--protected",
);

const tables = discoverTables(dbSchema as Record<string, unknown>);
const models = [...tables.entries()]
  .map(([tableKey, table]) => buildTableModel(tableKey, table))
  .sort((a, b) => a.tableKey.localeCompare(b.tableKey));
const validNames = models
  .filter((model) => !EXCLUDED_TABLES.has(model.tableName))
  .map((model) => model.fileBase);

if (unknownFlags.length > 0 || positional.length !== 1) usage(validNames);

const modelArg = positional[0] as string;
const model = models.find((candidate) => matchesArg(candidate, modelArg));
if (!model) {
  console.error(`Unknown model "${modelArg}".`);
  usage(validNames);
}
if (EXCLUDED_TABLES.has(model.tableName)) {
  console.error(
    `"${model.tableName}" is internal auth plumbing (EXCLUDED_TABLES) and is never exposed on the wire.`,
  );
  process.exit(1);
}
if (!model.columns.some((column) => column.kind === "id")) {
  console.error(
    `"${model.tableName}" has no uuid \`id\` primary key — the generated GET /{id} route and the pagination tiebreaker require one. Write this module by hand.`,
  );
  process.exit(1);
}

const names = buildModuleNames(model);
if (RESERVED_MODULE_SEGMENTS.has(names.moduleName)) {
  console.error(
    `route segment "/${names.moduleName}" is reserved (system/admin/docs routes) — rename the table or write the module by hand.`,
  );
  process.exit(1);
}

// Model-file gate: the module reuses the wire schema; generate it first.
const modelFilePath = join(SCHEMAS_DIR, `${names.fileBase}.ts`);
const outputSchema = (wireSchemas as Record<string, unknown>)[names.schemaName];
const shape =
  outputSchema !== null && typeof outputSchema === "object" && "shape" in outputSchema
    ? (outputSchema as { shape: Record<string, unknown> }).shape
    : undefined;
if (!existsSync(modelFilePath) || !shape) {
  console.error(
    `No ${names.fileBase}.ts model file / ${names.schemaName} export found in packages/schemas — run \`bun run schemas:generate ${modelArg}\` first, review its TODOs, then re-run.`,
  );
  process.exit(1);
}

// The module dir is the collision unit: 5 generated files live under it or in
// tests/, and --force overwrites all of them (hand edits are lost). Wiring is
// idempotent either way.
const moduleDirPath = join(REPO_ROOT, names.paths.dir);
if (existsSync(moduleDirPath) && !force) {
  console.error(
    `${relative(REPO_ROOT, moduleDirPath)} already exists. Re-run with --force to overwrite (hand edits will be lost).`,
  );
  process.exit(1);
}
if (existsSync(moduleDirPath) && force) {
  console.warn(
    `⚠ overwriting ${relative(REPO_ROOT, moduleDirPath)} — hand edits are being discarded`,
  );
}

const drift = detectDrift(model, wireSchemas as Record<string, unknown>);
if (drift && drift.missingInSchema.length > 0) {
  console.warn(
    `⚠ ${model.tableKey}: ${names.schemaName} is missing table column(s): ${drift.missingInSchema.join(", ")} — they will not be exposed by the module`,
  );
}

const publicColumns = selectPublicColumns(model, Object.keys(shape));
for (const skipped of publicColumns.skipped) {
  console.warn(
    `⚠ ${model.tableKey}: column "${skipped}" looks sensitive and is excluded from the module even though ${names.schemaName} exposes it — reconcile by hand`,
  );
}
for (const extra of publicColumns.extraInSchema) {
  console.warn(
    `⚠ ${model.tableKey}: ${names.schemaName} key "${extra}" has no table column — the generated serializer leaves a TODO that fails typecheck until you map it`,
  );
}
for (const warning of model.warnings) {
  console.warn(`⚠ ${model.tableKey}: ${warning}`);
}

// 1. Write the five generated files.
const generated: { path: string; contents: string }[] = [
  { path: names.paths.repo, contents: emitRepoFile(names, publicColumns) },
  { path: names.paths.service, contents: emitServiceFile(names) },
  { path: names.paths.routes, contents: emitRoutesFile(names, publicColumns, { isProtected }) },
  { path: names.paths.unitTest, contents: emitUnitTestFile(names) },
  { path: names.paths.e2eTest, contents: emitE2eTestFile(names, { isProtected }) },
];
for (const file of generated) {
  await Bun.write(join(REPO_ROOT, file.path), file.contents);
  console.log(`generated ${file.path}`);
}

// 2. Wiring edits — non-fatal: the module files are already written, and each
// warning carries the exact by-hand fix.
const touched = generated.map((file) => join(REPO_ROOT, file.path));

function applyWire(
  filePath: string,
  edit: (source: string) => { source: string; status: "inserted" | "already-wired" },
  label: string,
): Promise<void> {
  return Bun.file(filePath)
    .text()
    .then(async (source) => {
      const result = edit(source);
      if (result.status === "already-wired") {
        console.log(`skip: ${relative(REPO_ROOT, filePath)} is already wired (${label})`);
        return;
      }
      await Bun.write(filePath, result.source);
      touched.push(filePath);
      console.log(`wired ${relative(REPO_ROOT, filePath)} (${label})`);
    });
}

if (
  isMounted(await Bun.file(MODULES_INDEX_PATH).text(), names.moduleName) &&
  !existsSync(moduleDirPath)
) {
  // Defensive: a mount without a module dir means a half-deleted module; the
  // files above restore it and the wire calls below no-op.
  console.warn(
    `⚠ "/${names.moduleName}" was already mounted — restored the module files around it`,
  );
}

try {
  await applyWire(
    MODULES_INDEX_PATH,
    (source) => wireModulesIndex(source, names),
    "mount + ModuleServices",
  );
} catch (error) {
  if (!(error instanceof ModuleWireError)) throw error;
  console.warn(`⚠ modules/index.ts auto-wire failed — ${error.message}`);
}
try {
  await applyWire(APP_DEFAULTS_PATH, (source) => wireAppDefaults(source, names), "default wiring");
} catch (error) {
  if (!(error instanceof ModuleWireError)) throw error;
  console.warn(`⚠ app.defaults.ts auto-wire failed — ${error.message}`);
}
try {
  await applyWire(
    modelFilePath,
    (source) =>
      appendPublicFields(
        source,
        names.publicFieldsName,
        emitPublicFieldsBlock(names, publicColumns),
      ),
    "public allow-list",
  );
} catch (error) {
  if (!(error instanceof ModuleWireError)) throw error;
  console.warn(`⚠ ${relative(REPO_ROOT, modelFilePath)} auto-wire failed — ${error.message}`);
}

// 3. `check --write`, not `format --write`: the appended imports need Biome's
// assist (organizeImports) to land in canonical sorted order.
const check = Bun.spawnSync(["bun", "x", "biome", "check", "--write", ...touched], {
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
if (check.exitCode !== 0) {
  console.error("biome check failed — generated files are written but may be unformatted");
  process.exit(1);
}

console.log("\nnext steps:");
console.log(
  `  1. review the TODO(generator) comments: visibility rules in ${names.paths.repo}, and trim the ${names.publicFieldsName} allow-list in packages/schemas/src/${names.fileBase}.ts`,
);
console.log("  2. bun run typecheck && bun run lint && bun test apps/api");
console.log(
  `  3. bun run dev, then GET /api/${names.moduleName} — docs at /api/docs under the "${names.moduleName}" tag`,
);
