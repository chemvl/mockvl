export type CurlOperation = { method: string; path: string; codes: readonly string[] };

const STATUS_CODE = /^\d{3}$/;

/** "/pets/{petId}" → "/pets/1" so the snippet is runnable as-is. */
export function examplePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "1");
}

/** The runnable request URL the curl snippet targets. */
export function exampleUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${examplePath(path)}`;
}

function preferredCode(codes: readonly string[]): string | null {
  const numeric = codes.filter((code) => STATUS_CODE.test(code));
  return numeric.find((code) => code.startsWith("2")) ?? numeric[0] ?? null;
}

export function buildCurl(baseUrl: string, op: CurlOperation): string {
  const method = op.method.toUpperCase();
  const head = method === "GET" ? "curl" : `curl -X ${method}`;
  const url = exampleUrl(baseUrl, op.path);
  const code = preferredCode(op.codes);
  return code ? `${head} ${url} \\\n  -H 'Prefer: code=${code}'` : `${head} ${url}`;
}

/** Numeric status codes the endpoint defines ("default", "2XX" are skipped). */
export function statusCodes(op: { codes: readonly string[] }): string[] {
  return op.codes.filter((code) => STATUS_CODE.test(code));
}

/** Prefer values besides `code=…`: every named example, then dynamic=true. */
export function preferOptions(op: { examples: readonly string[] }): string[] {
  return [...op.examples.map((example) => `example=${example}`), "dynamic=true"];
}

/** Chips under PREFER: every status code, every named example, then dynamic=true. */
export function preferValues(op: { codes: readonly string[]; examples: readonly string[] }): string[] {
  return [...statusCodes(op).map((code) => `code=${code}`), ...preferOptions(op)];
}

/** The New-mock aside snippet (reference 1c), rooted at the future mock URL. */
export function buildAsideCurl(baseUrl: string): string {
  return `curl ${baseUrl}/orders/42 \\\n  -H 'Prefer: code=404'\n\ncurl …/orders \\\n  -H 'Prefer: example=empty'`;
}
