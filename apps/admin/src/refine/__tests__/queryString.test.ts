import {
  buildListQuery,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../queryString';

describe('buildListQuery', () => {
  test('applies pagination defaults when nothing is provided', () => {
    const params = buildListQuery({});

    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe(String(DEFAULT_PAGE_SIZE));
    expect(params.get('sort')).toBeNull();
  });

  test('passes explicit pagination through', () => {
    const params = buildListQuery({ pagination: { page: 3, pageSize: 50 } });

    expect(params.get('page')).toBe('3');
    expect(params.get('pageSize')).toBe('50');
  });

  test('caps pageSize at the API maximum of 100', () => {
    const params = buildListQuery({ pagination: { pageSize: 500 } });

    expect(params.get('pageSize')).toBe(String(MAX_PAGE_SIZE));
  });

  test('serializes a single sorter as field:dir', () => {
    const params = buildListQuery({
      sorters: [{ field: 'createdAt', order: 'desc' }],
    });

    expect(params.get('sort')).toBe('createdAt:desc');
  });

  test('joins multiple sorters with commas', () => {
    const params = buildListQuery({
      sorters: [
        { field: 'status', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    });

    expect(params.get('sort')).toBe('status:asc,createdAt:desc');
  });

  test.each([
    ['eq', 'eq'],
    ['contains', 'like'],
    ['gte', 'gte'],
    ['lte', 'lte'],
  ] as const)('maps %s to filter[field][%s]', (refineOp, apiOp) => {
    const params = buildListQuery({
      filters: [{ field: 'title', operator: refineOp, value: 'hello' }],
    });

    expect(params.get(`filter[title][${apiOp}]`)).toBe('hello');
  });

  test('comma-joins in filter values into a single param', () => {
    const params = buildListQuery({
      filters: [
        { field: 'status', operator: 'in', value: ['draft', 'published'] },
      ],
    });

    expect(params.get('filter[status][in]')).toBe('draft,published');
  });

  test('serializes number and boolean filter values', () => {
    const params = buildListQuery({
      filters: [
        { field: 'count', operator: 'gte', value: 10 },
        { field: 'active', operator: 'eq', value: true },
      ],
    });

    expect(params.get('filter[count][gte]')).toBe('10');
    expect(params.get('filter[active][eq]')).toBe('true');
  });

  test('throws on unsupported operators', () => {
    expect(() =>
      buildListQuery({
        filters: [{ field: 'title', operator: 'ne', value: 'x' }],
      }),
    ).toThrow('Unsupported filter operator: ne');
  });

  test.each([
    'or',
    'and',
  ] as const)('throws on %s conditional filters', (operator) => {
    expect(() =>
      buildListQuery({ filters: [{ operator, value: [] }] }),
    ).toThrow('Conditional (or/and) filters are not supported');
  });
});
