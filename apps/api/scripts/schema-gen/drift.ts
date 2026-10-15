// Drift detection between Drizzle tables and the hand-maintained output
// schemas in @starter/schemas, plus the barrel-file upsert.

import type { TableModel } from "./introspect";

// Columns deliberately kept off the wire — never report them as drift.
export const DRIFT_IGNORE: Record<string, readonly string[]> = {
  // Public user shape is minimal: the hash and Google identity key must never
  // leave the server and updatedAt is intentionally not exposed. The raw
  // emailVerifiedAt timestamp stays off the public wire too — the schema
  // carries the derived emailVerified boolean instead
  // (see packages/schemas/src/user.ts). lastWorkspaceId only orders
  // GET /workspaces server-side.
  users: [
    "passwordHash",
    "updatedAt",
    "googleSub",
    "emailVerifiedAt",
    "emailVerified",
    "lastWorkspaceId",
  ],
};

export interface DriftReport {
  missingInSchema: string[];
  extraInSchema: string[];
}

/**
 * Compares the table's columns against the model's `XxxSchema` output shape.
 * Returns null when the schema doesn't exist yet (i.e. the file needs
 * generating, not drift-checking).
 */
export function detectDrift(
  model: TableModel,
  schemasModule: Record<string, unknown>,
): DriftReport | null {
  const schema = schemasModule[`${model.pascalName}Schema`];
  if (schema === null || typeof schema !== "object" || !("shape" in schema)) return null;
  const shape = (schema as { shape: Record<string, unknown> }).shape;
  if (shape === null || typeof shape !== "object") return null;

  const ignored = new Set(DRIFT_IGNORE[model.tableKey] ?? []);
  const schemaKeys = new Set(Object.keys(shape));
  const tableKeys = new Set(model.columns.map((column) => column.name));

  return {
    missingInSchema: [...tableKeys].filter((key) => !schemaKeys.has(key) && !ignored.has(key)),
    // Ignored keys are exempt both ways: a deliberately derived schema field
    // (users.emailVerified) is not drift any more than a hidden column is.
    extraInSchema: [...schemaKeys].filter((key) => !tableKeys.has(key) && !ignored.has(key)),
  };
}

/** Idempotently inserts `export * from "./<fileBase>";` keeping exports sorted. */
export function upsertBarrelLine(barrelSource: string, fileBase: string): string {
  const exportPattern = /^export \* from "\.\/(.+)";$/;
  const others: string[] = [];
  const moduleNames = new Set<string>();
  for (const line of barrelSource.split("\n")) {
    const moduleName = line.match(exportPattern)?.[1];
    if (moduleName) moduleNames.add(moduleName);
    else if (line.trim() !== "") others.push(line);
  }
  moduleNames.add(fileBase);
  const exports = [...moduleNames].sort().map((name) => `export * from "./${name}";`);
  return `${[...others, ...exports].join("\n")}\n`;
}
