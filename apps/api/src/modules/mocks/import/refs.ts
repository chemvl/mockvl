import { mockErrors } from "../mocks.errors";
import { isPlainObject } from "./parse";

// Prism dereferences with $RefParser, which resolves file: and http(s): refs —
// a user schema with `$ref: /etc/passwd` would be a local file read, and
// `$ref: http://169.254.169.254/…` an SSRF. Only document-local refs (#…)
// may reach getHttpOperationsFromSpec. Iterative walk with a visited set:
// YAML aliases can share (or even cycle) nodes.
export function assertNoExternalRefs(doc: unknown): void {
  const visited = new Set<object>();
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null || visited.has(node)) continue;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (!isPlainObject(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string" && !value.startsWith("#")) {
        throw mockErrors.schemaExternalRef();
      }
      stack.push(value);
    }
  }
}
