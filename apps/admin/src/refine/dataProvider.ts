import type { BaseRecord, DataProvider } from '@refinedev/core';
import { ADMIN_API_URL } from './config';
import { adminFetch } from './http';
import { buildListQuery, MAX_PAGE_SIZE } from './queryString';

type Envelope<T> = { data: T };
type ListEnvelope<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};

// Refine DataProvider over the generic admin CRUD (`/admin/<resource>`).
// URL segments come straight from the resource name registered server-side;
// buildListQuery translates Refine params to the §4.2 query contract.
export const dataProvider: DataProvider = {
  getList: async ({ resource, pagination, sorters, filters, meta }) => {
    const query = buildListQuery({
      pagination: {
        page: pagination?.currentPage,
        pageSize: pagination?.pageSize,
      },
      sorters,
      filters,
    });
    const response = await adminFetch<ListEnvelope<BaseRecord>>(
      `/admin/${resource}?${query}`,
      // Consuming React Query's AbortSignal lets it actually cancel reads
      // whose subscriber unmounted (stale page flips, StrictMode's dev-only
      // double mount) instead of letting the orphaned request complete.
      { signal: meta?.signal },
    );
    return { data: response.data, total: response.meta.total } as any;
  },

  getOne: async ({ resource, id, meta }) => {
    const response = await adminFetch<Envelope<BaseRecord>>(
      `/admin/${resource}/${id}`,
      { signal: meta?.signal },
    );
    return response as any;
  },

  getMany: async ({ resource, ids, meta }) => {
    const query = buildListQuery({
      pagination: { page: 1, pageSize: Math.min(ids.length, MAX_PAGE_SIZE) },
      filters: [{ field: 'id', operator: 'in', value: ids }],
    });
    const response = await adminFetch<ListEnvelope<BaseRecord>>(
      `/admin/${resource}?${query}`,
      { signal: meta?.signal },
    );
    return { data: response.data } as any;
  },

  create: async ({ resource, variables }) => {
    const response = await adminFetch<Envelope<BaseRecord>>(
      `/admin/${resource}`,
      { method: 'POST', body: JSON.stringify(variables) },
    );
    return response as any;
  },

  update: async ({ resource, id, variables }) => {
    // §4.2 partial update — the API mounts PATCH, not PUT.
    const response = await adminFetch<Envelope<BaseRecord>>(
      `/admin/${resource}/${id}`,
      { method: 'PATCH', body: JSON.stringify(variables) },
    );
    return response as any;
  },

  deleteOne: async ({ resource, id }) => {
    const response = await adminFetch<Envelope<BaseRecord>>(
      `/admin/${resource}/${id}`,
      { method: 'DELETE' },
    );
    return response as any;
  },

  getApiUrl: () => ADMIN_API_URL,
};
