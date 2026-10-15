// Pure name derivations for the module generator: TableModel → every
// identifier and path the emitted module uses. Mirrors schema-gen/naming.ts's
// role — no I/O, no drizzle.

import type { TableModel } from "../schema-gen/introspect";
import { camelCase, kebabCase, pascalCase, singularize, titleCase } from "../schema-gen/naming";

// Route segments mounted outside modules/index.ts (system routes, admin,
// docs) — a module on one of these would shadow or collide at runtime.
export const RESERVED_MODULE_SEGMENTS = new Set([
  "admin",
  "health",
  "ready",
  "docs",
  "openapi.json",
]);

export interface ModuleNames {
  /** Route segment, module dir name, and OpenAPI tag (e.g. "categories", "admin-users"). */
  moduleName: string;
  /** Plural PascalCase stem for factories/types (e.g. "Categories"). */
  pluralPascal: string;
  /** Singular PascalCase model name, same as TableModel.pascalName (e.g. "Category"). */
  modelType: string;
  /** Singular camelCase local variable (e.g. "category"). */
  singularCamel: string;
  /** Human singular for summaries/messages (e.g. "category", "admin user"). */
  singularLabel: string;
  /** db/schema export key (e.g. "categories"). */
  tableKey: string;
  /** packages/schemas file base (e.g. "category"). */
  fileBase: string;
  schemaName: string;
  publicFieldsName: string;
  serviceKey: string;
  repoKey: string;
  repoFactory: string;
  repoType: string;
  serviceFactory: string;
  serviceType: string;
  routesFactory: string;
  serializerName: string;
  /** Repo-relative paths of every file the generator writes. */
  paths: {
    dir: string;
    repo: string;
    service: string;
    routes: string;
    unitTest: string;
    e2eTest: string;
  };
}

export function buildModuleNames(model: TableModel): ModuleNames {
  const moduleName = kebabCase(model.tableName);
  const pluralPascal = pascalCase(model.tableKey);
  const pluralCamel = camelCase(model.tableKey);
  const singular = singularize(model.tableKey);
  const dir = `apps/api/src/modules/${moduleName}`;

  return {
    moduleName,
    pluralPascal,
    modelType: model.pascalName,
    singularCamel: camelCase(singular),
    singularLabel: titleCase(singular).toLowerCase(),
    tableKey: model.tableKey,
    fileBase: model.fileBase,
    schemaName: `${model.pascalName}Schema`,
    publicFieldsName: `public${model.pascalName}Fields`,
    serviceKey: `${pluralCamel}Service`,
    repoKey: `${pluralCamel}Repo`,
    repoFactory: `create${pluralPascal}Repo`,
    repoType: `${pluralPascal}Repo`,
    serviceFactory: `create${pluralPascal}Service`,
    serviceType: `${pluralPascal}Service`,
    routesFactory: `create${pluralPascal}Routes`,
    serializerName: `serialize${model.pascalName}`,
    paths: {
      dir,
      repo: `${dir}/${moduleName}.repo.ts`,
      service: `${dir}/${moduleName}.service.ts`,
      routes: `${dir}/${moduleName}.routes.ts`,
      unitTest: `apps/api/tests/unit/${moduleName}-service.test.ts`,
      e2eTest: `apps/api/tests/e2e/${moduleName}-e2e.test.ts`,
    },
  };
}
