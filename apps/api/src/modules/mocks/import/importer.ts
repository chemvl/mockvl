import type { OperationSummary, SchemaFormat, SchemaSource } from "@starter/schemas";
import { mockErrors } from "../mocks.errors";
import { loadOperations } from "./operations";
import { assertSchemaSize, detectFormat, parseSchemaContent } from "./parse";
import { assertNoExternalRefs } from "./refs";
import { sha256Hex, summarizeOperations } from "./summarize";

export interface ImportedSchema {
  format: SchemaFormat;
  specVersion: string;
  content: string;
  sha256: string;
  sizeBytes: number;
  operations: OperationSummary[];
  endpointCount: number;
  exampleCount: number;
  sourceLabel: string;
}

export interface ImportOptions {
  // Custom mocks start with no endpoints (custom mocks spec § Empty mocks).
  allowEmpty?: boolean;
}

// Spec pipeline steps 2–7 (size → parse → detect → refs → operations →
// summarize). Step 1 (URL fetch) is the importer's job; step 8 (diff) is the
// service's, because only it knows the previous live version.
export async function importSchemaContent(
  content: string,
  sourceLabel: string,
  options: ImportOptions = {},
): Promise<ImportedSchema> {
  const sizeBytes = assertSchemaSize(content, sourceLabel);
  const doc = parseSchemaContent(content, sourceLabel);
  const { format, specVersion } = detectFormat(doc);
  assertNoExternalRefs(doc);
  const operations = await loadOperations(doc, sourceLabel);
  if (operations.length === 0 && !options.allowEmpty) throw mockErrors.schemaNoPaths();
  const summary = summarizeOperations(operations);
  return {
    format,
    specVersion,
    content,
    sha256: sha256Hex(content),
    sizeBytes,
    ...summary,
    sourceLabel,
  };
}

export interface SchemaImporter {
  import(source: SchemaSource): Promise<ImportedSchema>;
}

export interface SchemaImporterDeps {
  // SSRF-safe fetcher (import/fetch-url.ts in production); resolves to text.
  fetchUrl: (url: string) => Promise<string>;
}

export function createSchemaImporter(deps: SchemaImporterDeps): SchemaImporter {
  return {
    async import(source: SchemaSource): Promise<ImportedSchema> {
      if (source.type === "file") return importSchemaContent(source.content, source.filename);
      return importSchemaContent(await deps.fetchUrl(source.url), source.url);
    },
  };
}
