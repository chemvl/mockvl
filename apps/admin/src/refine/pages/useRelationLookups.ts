import {
  type BaseRecord,
  type GetManyResponse,
  useDataProvider,
} from '@refinedev/core';
import type { ResourceField } from '@starter/schemas';
import { useQueries } from '@tanstack/react-query';

type RelationField = Extract<ResourceField, { type: 'relation' }>;

/** field name → (related id → display label) */
export type RelationLookups = Record<string, Record<string, string>>;

// Distinct related ids referenced by the current page rows, sorted so the
// react-query key stays stable across renders that only reorder rows.
export function collectRelationIds(
  rows: readonly BaseRecord[],
  fieldName: string,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = (row as Record<string, unknown>)[fieldName];
    if (value != null && value !== '') ids.add(String(value));
  }
  return [...ids].sort();
}

// id → displayField value; records missing the display value are omitted so
// the cell falls back to the raw id (same coercion as RelationSelect's
// optionLabel in fieldWidgets.tsx).
export function buildLabelMap(
  records: readonly BaseRecord[],
  displayField: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const record of records) {
    if (record.id == null) continue;
    const label = (record as Record<string, unknown>)[displayField];
    if (label != null) map[String(record.id)] = String(label);
  }
  return map;
}

// Resolves display labels for every relation list column via one batched
// getMany (filter[id][in]) per relation field. useQueries (not useMany in a
// loop) keeps the hook count fixed regardless of how many relation fields a
// resource has. A failed lookup (403 on the target resource, deleted records)
// leaves that field's map empty — cells then fall back to the raw id — and
// stays outside Refine's notification flow, so it never toasts.
export function useRelationLookups(
  fields: readonly ResourceField[],
  rows: readonly BaseRecord[],
): RelationLookups {
  const dataProvider = useDataProvider();
  const relationFields = fields.filter(
    (f): f is RelationField => f.type === 'relation' && f.listColumn === true,
  );

  const queries = useQueries({
    queries: relationFields.map((field) => {
      const ids = collectRelationIds(rows, field.name);
      return {
        queryKey: ['relation-lookup', field.resource, ids] as const,
        enabled: ids.length > 0,
        retry: false,
        queryFn: (): Promise<GetManyResponse<BaseRecord>> => {
          const getMany = dataProvider().getMany;
          if (!getMany) return Promise.resolve({ data: [] });
          return getMany({ resource: field.resource, ids });
        },
      };
    }),
  });

  const lookups: RelationLookups = {};
  relationFields.forEach((field, index) => {
    lookups[field.name] = buildLabelMap(
      queries[index]?.data?.data ?? [],
      field.displayField,
    );
  });
  return lookups;
}
