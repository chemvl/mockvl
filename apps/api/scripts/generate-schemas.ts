// Scaffolds packages/schemas model files from the Drizzle tables.
//
//   bun run schemas:generate                 # write all missing model files; drift-warn existing
//   bun run schemas:generate category        # one model; errors if the file exists
//   bun run schemas:generate posts --force   # overwrite (discards hand edits!)
//
// Generated files are scaffolds: review the TODO(generator) comments and tune
// labels/limits/flags. Newly generated models also get an
// admin/registry/resources/<name>.resource.ts def wired into resources.ts —
// review that file's icon and permissions TODOs.

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import * as wireSchemas from "@starter/schemas";
import * as dbSchema from "../src/db/schema";
import { detectDrift, upsertBarrelLine } from "./schema-gen/drift";
import { emitModelFile } from "./schema-gen/emit";
import {
  buildTableModel,
  discoverTables,
  EXCLUDED_TABLES,
  type TableModel,
} from "./schema-gen/introspect";
import { matchesArg } from "./schema-gen/naming";
import { RegistryEditError, registerResource } from "./schema-gen/register";

const REPO_ROOT = join(import.meta.dir, "../../..");
const SCHEMAS_DIR = join(REPO_ROOT, "packages/schemas/src");
const BARREL_PATH = join(SCHEMAS_DIR, "index.ts");
const RESOURCES_PATH = join(REPO_ROOT, "apps/api/src/admin/registry/resources.ts");
const RESOURCES_DIR = join(REPO_ROOT, "apps/api/src/admin/registry/resources");

/** Every existing .resource.ts concatenated — the dedup corpus for isRegistered(). */
async function readResourceSources(): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(RESOURCES_DIR);
  } catch {
    return ""; // no resources/ dir yet — nothing registered per-file
  }
  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts"))
      .sort()
      .map((entry) => Bun.file(join(RESOURCES_DIR, entry)).text()),
  );
  return sources.join("\n");
}

function usage(validNames: string[]): never {
  console.error("Usage: bun run schemas:generate [model] [--force]");
  console.error(`Models: ${validNames.join(", ")}`);
  process.exit(1);
}

function reportDrift(model: TableModel): void {
  const drift = detectDrift(model, wireSchemas as Record<string, unknown>);
  if (!drift) {
    console.warn(
      `⚠ ${model.tableKey}: ${model.fileBase}.ts exists but exports no ${model.pascalName}Schema — cannot drift-check`,
    );
    return;
  }
  if (drift.missingInSchema.length > 0) {
    console.warn(
      `⚠ ${model.tableKey}: ${model.pascalName}Schema is missing table column(s): ${drift.missingInSchema.join(", ")} — add by hand or regenerate with --force`,
    );
  }
  if (drift.extraInSchema.length > 0) {
    console.warn(
      `⚠ ${model.tableKey}: ${model.pascalName}Schema has key(s) with no table column: ${drift.extraInSchema.join(", ")}`,
    );
  }
}

async function writeModel(model: TableModel): Promise<{ model: TableModel; filePath: string }> {
  const filePath = join(SCHEMAS_DIR, `${model.fileBase}.ts`);
  await Bun.write(filePath, emitModelFile(model));
  for (const warning of model.warnings) {
    console.warn(`⚠ ${model.tableKey}: ${warning}`);
  }
  console.log(`generated ${relative(REPO_ROOT, filePath)}`);
  return { model, filePath };
}

const args = Bun.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((arg) => !arg.startsWith("--"));
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--force");

const tables = discoverTables(dbSchema as Record<string, unknown>);
const models = [...tables.entries()]
  .map(([tableKey, table]) => buildTableModel(tableKey, table))
  .sort((a, b) => a.tableKey.localeCompare(b.tableKey));
const includedModels = models.filter((model) => !EXCLUDED_TABLES.has(model.tableName));
const validNames = includedModels.map((model) => model.fileBase);

if (unknownFlags.length > 0 || positional.length > 1) usage(validNames);

// Duplicate enum consts across models would collide in the barrel — warn once.
const enumOwners = new Map<string, string>();
for (const model of includedModels) {
  for (const column of model.columns) {
    if (column.kind !== "enum") continue;
    const owner = enumOwners.get(column.enumName);
    if (owner && owner !== model.tableKey) {
      console.warn(
        `⚠ enum "${column.enumName}" is shared by ${owner} and ${model.tableKey} — dedupe the generated const by hand (v1 limitation)`,
      );
    } else {
      enumOwners.set(column.enumName, model.tableKey);
    }
  }
}

const written: { model: TableModel; filePath: string }[] = [];

const modelArg = positional[0];
if (modelArg !== undefined) {
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
  const filePath = join(SCHEMAS_DIR, `${model.fileBase}.ts`);
  if ((await Bun.file(filePath).exists()) && !force) {
    console.error(
      `${relative(REPO_ROOT, filePath)} already exists. Re-run with --force to overwrite (hand edits will be lost).`,
    );
    process.exit(1);
  }
  if (force && (await Bun.file(filePath).exists())) {
    console.warn(`⚠ overwriting ${relative(REPO_ROOT, filePath)} — hand edits are being discarded`);
  }
  written.push(await writeModel(model));
} else {
  for (const model of includedModels) {
    const filePath = join(SCHEMAS_DIR, `${model.fileBase}.ts`);
    if (await Bun.file(filePath).exists()) {
      reportDrift(model);
    } else {
      written.push(await writeModel(model));
    }
  }
}

if (written.length === 0) {
  console.log("nothing to generate — all model files exist (drift warnings above, if any)");
} else {
  let barrel = await Bun.file(BARREL_PATH).text();
  for (const { filePath } of written) {
    const fileBase = filePath.slice(filePath.lastIndexOf("/") + 1).replace(/\.ts$/, "");
    barrel = upsertBarrelLine(barrel, fileBase);
  }
  await Bun.write(BARREL_PATH, barrel);

  // Register each newly written model (guide Step 6): emit its
  // resources/<name>.resource.ts and wire it into the resources.ts index. A
  // skip (already registered) or an anchor failure is not fatal — the schema
  // file is written either way and registration falls back to manual.
  let resourcesSource = await Bun.file(RESOURCES_PATH).text();
  let registeredSources = await readResourceSources();
  let resourcesChanged = false;
  const newResourcePaths: string[] = [];
  for (const { model } of written) {
    try {
      const result = registerResource(resourcesSource, registeredSources, model);
      if (result.status === "inserted" && result.resourceFile) {
        resourcesSource = result.indexSource;
        // Feed the new def back into the corpus so two new models generated in
        // one run dedupe against each other.
        registeredSources += `\n${result.resourceFile.contents}`;
        resourcesChanged = true;
        const resourcePath = join(RESOURCES_DIR, result.resourceFile.fileName);
        await Bun.write(resourcePath, result.resourceFile.contents);
        newResourcePaths.push(resourcePath);
        console.log(`generated ${relative(REPO_ROOT, resourcePath)}`);
        console.log(
          `registered "${result.resourceName}" in ${relative(REPO_ROOT, RESOURCES_PATH)}`,
        );
      } else {
        console.log(`skip: "${result.resourceName}" is already registered (name or table found)`);
      }
    } catch (error) {
      if (!(error instanceof RegistryEditError)) throw error;
      console.warn(`⚠ ${model.tableKey}: auto-register failed — ${error.message}`);
    }
  }
  if (resourcesChanged) await Bun.write(RESOURCES_PATH, resourcesSource);

  const format = Bun.spawnSync(
    [
      "bun",
      "x",
      "biome",
      "format",
      "--write",
      ...written.map(({ filePath }) => filePath),
      BARREL_PATH,
    ],
    {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (format.exitCode !== 0) {
    console.error("biome format failed — generated files are written but unformatted");
    process.exit(1);
  }

  if (resourcesChanged) {
    // `check --write`, not `format --write`: the appended index import and the
    // emitted resource files need Biome's assist (organizeImports) to land in
    // canonical sorted order.
    const check = Bun.spawnSync(
      ["bun", "x", "biome", "check", "--write", RESOURCES_PATH, ...newResourcePaths],
      {
        cwd: REPO_ROOT,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (check.exitCode !== 0) {
      console.error(
        "biome check failed on the registry files — the register() wiring is written; review by hand",
      );
      process.exit(1);
    }
  }

  console.log("\nnext steps:");
  console.log(
    "  1. review the generated resources/<name>.resource.ts (icon, permissions) and its register() line in apps/api/src/admin/registry/resources.ts",
  );
  console.log("  2. review TODO(generator) comments and tune labels/limits/flags");
  console.log("  3. bun run typecheck && bun run lint && bun test");
}
