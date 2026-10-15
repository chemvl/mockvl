// Wiring edits for generated modules: modules/index.ts, app.defaults.ts, and
// the packages/schemas model file. Pure functions over source text (no I/O,
// mirrors schema-gen/register.ts) — string edits with resilient anchors. Every
// mutating function either returns a fully edited copy or throws
// ModuleWireError; a file is never half-edited. All edits are idempotent, so
// --force re-runs never duplicate lines.

import type { ModuleNames } from "./names";

/** An anchor is missing or the file shape is unrecognized — wire by hand. */
export class ModuleWireError extends Error {}

export interface WireResult {
  source: string;
  status: "inserted" | "already-wired";
}

/** True when modules/index.ts already mounts this route segment. */
export function isMounted(source: string, moduleName: string): boolean {
  return source.includes(`app.route("/${moduleName}"`);
}

/**
 * Adds `import ...;` after the last top-level import. Idempotent on the module
 * path. Appends without sorting — the CLI runs `biome check --write`
 * afterwards, and Biome's organizeImports assist canonicalizes the order.
 */
function upsertImport(source: string, statement: string, modulePath: string): string {
  if (source.includes(`from "${modulePath}"`)) return source;
  let lastImportEnd = -1;
  for (const match of source.matchAll(/^import\b[^;]*;/gm)) {
    lastImportEnd = match.index + match[0].length;
  }
  if (lastImportEnd === -1) {
    throw new ModuleWireError(`no import statements found — add \`${statement}\` by hand`);
  }
  return `${source.slice(0, lastImportEnd)}\n${statement}${source.slice(lastImportEnd)}`;
}

/** Inserts `line` before the first `\n  };`-style block close after `anchor`. */
function insertBeforeBlockClose(
  source: string,
  anchor: string,
  line: string,
  close: string,
): string {
  const anchorIdx = source.indexOf(anchor);
  if (anchorIdx === -1) {
    throw new ModuleWireError(
      `could not find \`${anchor.trim()}\` — add \`${line.trim()}\` by hand`,
    );
  }
  const closeIdx = source.indexOf(close, anchorIdx);
  if (closeIdx === -1) {
    throw new ModuleWireError(
      `no closing \`${close.trim()}\` after \`${anchor.trim()}\` — add \`${line.trim()}\` by hand`,
    );
  }
  return `${source.slice(0, closeIdx)}\n${line}${source.slice(closeIdx)}`;
}

/**
 * modules/index.ts: import the routes factory + service type, extend
 * ModuleServices, and mount the router after the last app.route() call.
 */
export function wireModulesIndex(source: string, names: ModuleNames): WireResult {
  if (isMounted(source, names.moduleName)) return { source, status: "already-wired" };

  let next = upsertImport(
    source,
    `import { ${names.routesFactory} } from "@/modules/${names.moduleName}/${names.moduleName}.routes";`,
    `@/modules/${names.moduleName}/${names.moduleName}.routes`,
  );
  next = upsertImport(
    next,
    `import type { ${names.serviceType} } from "@/modules/${names.moduleName}/${names.moduleName}.service";`,
    `@/modules/${names.moduleName}/${names.moduleName}.service`,
  );

  const interfaceField = `  ${names.serviceKey}: ${names.serviceType};`;
  if (!next.includes(interfaceField)) {
    next = insertBeforeBlockClose(next, "export interface ModuleServices {", interfaceField, "\n}");
  }

  const mountLine = `  app.route("/${names.moduleName}", ${names.routesFactory}(services.${names.serviceKey}));`;
  const lastMount = next.lastIndexOf('\n  app.route("');
  if (lastMount === -1) {
    throw new ModuleWireError(`no app.route() calls found — add \`${mountLine.trim()}\` by hand`);
  }
  const lineEnd = next.indexOf("\n", lastMount + 1);
  if (lineEnd === -1) {
    throw new ModuleWireError(
      `unterminated app.route() line — add \`${mountLine.trim()}\` by hand`,
    );
  }
  next = `${next.slice(0, lineEnd)}\n${mountLine}${next.slice(lineEnd)}`;
  return { source: next, status: "inserted" };
}

/**
 * app.defaults.ts: import repo + service factories, build the default in
 * createDefaultServices, and resolve injected-vs-default in the
 * `const modules: ModuleServices = {` block.
 */
export function wireAppDefaults(source: string, names: ModuleNames): WireResult {
  const defaultLine = `    ${names.serviceKey}: ${names.serviceFactory}({ ${names.repoKey}: ${names.repoFactory}(db) }),`;
  const resolveLine = `    ${names.serviceKey}: options.${names.serviceKey} ?? defaults.${names.serviceKey},`;
  if (source.includes(`options.${names.serviceKey} ??`)) {
    return { source, status: "already-wired" };
  }

  let next = upsertImport(
    source,
    `import { ${names.repoFactory} } from "@/modules/${names.moduleName}/${names.moduleName}.repo";`,
    `@/modules/${names.moduleName}/${names.moduleName}.repo`,
  );
  next = upsertImport(
    next,
    `import { ${names.serviceFactory} } from "@/modules/${names.moduleName}/${names.moduleName}.service";`,
    `@/modules/${names.moduleName}/${names.moduleName}.service`,
  );

  const defaultsFnIdx = next.indexOf("function createDefaultServices");
  if (defaultsFnIdx === -1) {
    throw new ModuleWireError(`no createDefaultServices() — add \`${defaultLine.trim()}\` by hand`);
  }
  const returnIdx = next.indexOf("return {", defaultsFnIdx);
  if (returnIdx === -1) {
    throw new ModuleWireError(
      `no \`return {\` inside createDefaultServices — add \`${defaultLine.trim()}\` by hand`,
    );
  }
  const returnClose = next.indexOf("\n  };", returnIdx);
  if (returnClose === -1) {
    throw new ModuleWireError(
      `could not find the end of createDefaultServices' return — add \`${defaultLine.trim()}\` by hand`,
    );
  }
  next = `${next.slice(0, returnClose)}\n${defaultLine}${next.slice(returnClose)}`;

  next = insertBeforeBlockClose(next, "const modules: ModuleServices = {", resolveLine, "\n  };");
  return { source: next, status: "inserted" };
}

/**
 * packages/schemas/src/<fileBase>.ts: append the public allow-list export.
 * The block references `ResourceField`, which every model file already imports
 * for its admin fields const.
 */
export function appendPublicFields(
  modelSource: string,
  publicFieldsName: string,
  block: string,
): WireResult {
  if (modelSource.includes(`export const ${publicFieldsName}`)) {
    return { source: modelSource, status: "already-wired" };
  }
  const trimmed = modelSource.replace(/\n+$/, "\n");
  return { source: `${trimmed}${block.replace(/\n+$/, "\n")}`, status: "inserted" };
}
