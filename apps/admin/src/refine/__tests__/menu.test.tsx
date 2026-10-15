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

  test('lists each resource as a top-level entry', () => {
    useAdminStore.getState().setBoot({ identity: null, resources: [posts] });

    const { result } = renderHook(() => useAdminResourceMenu());

    expect(result.current).toEqual([
      expect.objectContaining({ path: '/resources/posts', name: 'Posts' }),
    ]);
    expect(result.current[0].icon).toBeDefined();
  });
});
