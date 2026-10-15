import { buildLabelMap, collectRelationIds } from '../pages/useRelationLookups';

describe('collectRelationIds', () => {
  test('collects distinct non-null ids, sorted', () => {
    const rows = [
      { id: '1', categoryId: 'b' },
      { id: '2', categoryId: 'a' },
      { id: '3', categoryId: 'b' },
      { id: '4', categoryId: null },
      { id: '5' },
    ];

    expect(collectRelationIds(rows, 'categoryId')).toEqual(['a', 'b']);
  });

  test('ignores empty-string values', () => {
    expect(collectRelationIds([{ id: '1', authorId: '' }], 'authorId')).toEqual(
      [],
    );
  });

  test('returns empty for no rows', () => {
    expect(collectRelationIds([], 'categoryId')).toEqual([]);
  });
});

describe('buildLabelMap', () => {
  test('maps id to the display field value', () => {
    const records = [
      { id: 'a', name: 'Tech' },
      { id: 'b', name: 'News' },
    ];

    expect(buildLabelMap(records, 'name')).toEqual({ a: 'Tech', b: 'News' });
  });

  test('omits records missing the display value so cells fall back to the id', () => {
    const records = [{ id: 'a', name: 'Tech' }, { id: 'b' }, { name: 'Lost' }];

    expect(buildLabelMap(records, 'name')).toEqual({ a: 'Tech' });
  });

  test('coerces non-string display values and ids', () => {
    expect(buildLabelMap([{ id: 7, count: 42 }], 'count')).toEqual({
      '7': '42',
    });
  });
});
