// Pure translation from Refine list params to the API's §4.2 query contract:
// page, pageSize (≤100), sort=field:dir (comma multi), filter[field][op]=value.
// Kept free of @refinedev/core runtime imports so jest can test it in isolation;
// dataProvider.ts adapts Refine's own types onto these structural inputs.

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

// Refine operator → API §4.2 operator. Anything else (ne, lt, gt, between,
// null, or/and conditionals, …) is not expressible server-side and must throw
// rather than silently drop a filter the user believes is applied.
export const FILTER_OPERATOR_MAP = {
  eq: 'eq',
  contains: 'like',
  in: 'in',
  gte: 'gte',
  lte: 'lte',
} as const;

export type SortRule = {
  field: string;
  order: 'asc' | 'desc';
};

export type FilterRule = {
  // Conditional (or/and) filters carry no field — detected and rejected below.
  field?: string;
  operator: string;
  value: unknown;
};

export type ListQuery = {
  pagination?: { page?: number; pageSize?: number };
  sorters?: readonly SortRule[];
  filters?: readonly FilterRule[];
};

function toParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Cannot serialize filter value of type ${typeof value}`);
}

export function buildListQuery({
  pagination,
  sorters,
  filters,
}: ListQuery): URLSearchParams {
  const params = new URLSearchParams();

  const page = pagination?.page ?? 1;
  const pageSize = Math.min(
    pagination?.pageSize ?? DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (sorters && sorters.length > 0) {
    params.set('sort', sorters.map((s) => `${s.field}:${s.order}`).join(','));
  }

  for (const filter of filters ?? []) {
    if (filter.operator === 'or' || filter.operator === 'and') {
      throw new Error(
        'Conditional (or/and) filters are not supported — the API ANDs flat filters only',
      );
    }
    if (!filter.field) {
      throw new Error('Filter is missing a field');
    }
    const op =
      FILTER_OPERATOR_MAP[filter.operator as keyof typeof FILTER_OPERATOR_MAP];
    if (!op) {
      throw new Error(`Unsupported filter operator: ${filter.operator}`);
    }
    const value =
      op === 'in'
        ? (Array.isArray(filter.value) ? filter.value : [filter.value])
            .map(toParamValue)
            .join(',')
        : toParamValue(filter.value);
    params.set(`filter[${filter.field}][${op}]`, value);
  }

  return params;
}
