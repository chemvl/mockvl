import type { ResourceMeta } from '@starter/schemas';
import { renderHook } from '@testing-library/react';
import { useAdminStore } from '../adminStore';
import { useAdminResourceMenu } from '../menu';

// react-intl v10 ships ESM-only; the hook only needs formatMessage.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) =>
      defaultMessage,
  }),
}));

const posts: ResourceMeta = {
  name: 'posts',
  label: 'Posts',
  icon: 'FileTextOutlined',
  fields: [{ name: 'title', type: 'string', label: 'Title' }],
  permissions: { list: 'viewer' },
};

describe('useAdminResourceMenu', () => {
  afterEach(() => {
    useAdminStore.getState().setBoot({ identity: null, resources: [] });
  });

  test('returns no menu entries when no resources are loaded', () => {
    const { result } = renderHook(() => useAdminResourceMenu());

    expect(result.current).toEqual([]);
  });

  test('builds one Resources group with a child per resource', () => {
    useAdminStore.getState().setBoot({ identity: null, resources: [posts] });

    const { result } = renderHook(() => useAdminResourceMenu());

    expect(result.current).toHaveLength(1);
    const group = result.current[0];
    expect(group.path).toBe('/resources');
    expect(group.name).toBe('Resources');
    expect(group.icon).toBeDefined();
    expect(group.routes).toEqual([
      expect.objectContaining({ path: '/resources/posts', name: 'Posts' }),
    ]);
    expect(group.routes?.[0].icon).toBeDefined();
  });
});
