import { getHttpOperationsFromSpec } from "@stoplight/prism-http";
import type { IHttpOperation } from "@stoplight/types";
import { MAX_OPERATIONS } from "../mocks.constants";
import { mockErrors } from "../mocks.errors";
import { assertNoExternalRefs } from "./refs";

// The single entry point to Prism's spec loader — used by the import
// pipeline AND the mock runtime's operations cache, so the external-$ref
// guard and the callback strip can never be skipped by a new caller. Zero
// operations are allowed here (stored custom mocks may be empty);
// importSchemaContent rejects them for file/URL imports.
export async function loadOperations(
  doc: Record<string, unknown>,
  label: string,
): Promise<IHttpOperation[]> {
  assertNoExternalRefs(doc);
  let operations: IHttpOperation[];
  try {
    operations = await getHttpOperationsFromSpec(doc);
  } catch {
    throw mockErrors.schemaParseFailed(label);
  }
  if (operations.length > MAX_OPERATIONS) throw mockErrors.schemaTooManyOperations();
  // Prism sends a real request to every OpenAPI callback URL on each mocked
  // response — an SSRF any anonymous mock caller could trigger. Mocks never
  // run callbacks.
  for (const op of operations) delete op.callbacks;
  return operations;
}
