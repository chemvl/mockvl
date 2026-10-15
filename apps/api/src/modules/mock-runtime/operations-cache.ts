import type { IHttpOperation } from "@stoplight/types";
import { loadOperations } from "@/modules/mocks/import/operations";
import { parseSchemaContent } from "@/modules/mocks/import/parse";
import type { MocksRepo } from "@/modules/mocks/mocks.repo";

export interface OperationsCache<T> {
  get(key: string): Promise<T>;
  readonly size: number;
}

// In-process LRU keyed by mock version id. Versions are immutable, so entries
// never go stale — they only age out. Concurrent misses for one key share a
// single load; failed loads are not cached.
export function createOperationsCache<T>(options: {
  max: number;
  load: (key: string) => Promise<T>;
}): OperationsCache<T> {
  const entries = new Map<string, T>();
  const inflight = new Map<string, Promise<T>>();

  return {
    get(key: string): Promise<T> {
      if (entries.has(key)) {
        const hit = entries.get(key) as T;
        // Map preserves insertion order: re-inserting marks it most recent.
        entries.delete(key);
        entries.set(key, hit);
        return Promise.resolve(hit);
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const promise = options
        .load(key)
        .then((value) => {
          entries.set(key, value);
          for (const oldest of entries.keys()) {
            if (entries.size <= options.max) break;
            entries.delete(oldest);
          }
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    },
    get size() {
      return entries.size;
    },
  };
}

const STORED_LABEL = "Stored schema";

// Cache-miss loader: raw content from Postgres → parse → Prism operations.
// loadOperations re-applies the external-$ref guard (defence in depth).
export function createVersionOperationsLoader(repo: Pick<MocksRepo, "findVersionSource">) {
  return async (versionId: string): Promise<IHttpOperation[]> => {
    const source = await repo.findVersionSource(versionId);
    if (!source) throw new Error(`mock version ${versionId} not found`);
    return loadOperations(parseSchemaContent(source.content, STORED_LABEL), STORED_LABEL);
  };
}
