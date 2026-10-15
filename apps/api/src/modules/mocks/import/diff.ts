import type { OperationSummary, VersionDiff } from "@starter/schemas";

function operationKey(op: OperationSummary): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

// Diff of a new version against the previous live one, keyed by "METHOD path".
export function diffOperations(
  previous: readonly OperationSummary[],
  next: readonly OperationSummary[],
): VersionDiff {
  const before = new Map(previous.map((op) => [operationKey(op), op]));
  const after = new Map(next.map((op) => [operationKey(op), op]));
  let endpointsAdded = 0;
  let examplesChanged = 0;
  for (const [key, op] of after) {
    const old = before.get(key);
    if (!old) endpointsAdded += 1;
    else if (old.examplesHash !== op.examplesHash) examplesChanged += 1;
  }
  let endpointsRemoved = 0;
  for (const key of before.keys()) {
    if (!after.has(key)) endpointsRemoved += 1;
  }
  return { endpointsAdded, endpointsRemoved, examplesChanged };
}
