import type { AdminUser, ResourceMeta } from '@starter/schemas';
import { useAdminStore } from '../adminStore';
import { adminLoginLoader, adminRootLoader } from '../loader';

// config.ts reads import.meta.env (Vite-only syntax) — replace it wholesale.
jest.mock('../config', () => ({ ADMIN_API_URL: 'http://api.test' }));

// jsdom has no fetch Response, so react-router's real redirect() cannot be
// constructed — a sentinel object is enough to assert throw targets.
jest.mock('react-router', () => ({
  redirect: (to: string) => ({ __redirect: to }),
}));

jest.mock('../http', () => ({ adminFetch: jest.fn() }));
jest.mock('../resources', () => ({ fetchAdminMeta: jest.fn() }));

import { adminFetch } from '../http';
import { fetchAdminMeta } from '../resources';

const adminFetchMock = adminFetch as jest.Mock;
const fetchAdminMetaMock = fetchAdminMeta as jest.Mock;

const identity: AdminUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  name: 'Owner',
  avatarUrl: null,
  role: 'owner',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const posts: ResourceMeta = {
  name: 'posts',
  label: 'Posts',
  fields: [{ name: 'title', type: 'string', label: 'Title' }],
  permissions: { list: 'viewer' },
};

function rootArgs(url: string) {
  // Only request.url is read by the loader.
  return { request: { url } } as Parameters<typeof adminRootLoader>[0];
}

beforeEach(() => {
  adminFetchMock.mockReset();
  fetchAdminMetaMock.mockReset();
  useAdminStore.getState().setBoot({ identity: null, resources: [] });
});

describe('adminRootLoader', () => {
  test('boots the store and returns identity + resources on a live session', async () => {
    adminFetchMock.mockResolvedValue({ data: identity });
    fetchAdminMetaMock.mockResolvedValue([posts]);

    const boot = await adminRootLoader(rootArgs('http://localhost:8000/'));

    expect(boot).toEqual({ identity, resources: [posts] });
    expect(useAdminStore.getState().identity).toEqual(identity);
    expect(useAdminStore.getState().resources).toEqual([posts]);
  });

  test('redirects to the login page when there is no admin session', async () => {
    adminFetchMock.mockRejectedValue(new Error('401'));
    fetchAdminMetaMock.mockRejectedValue(new Error('401'));

    await expect(
      adminRootLoader(rootArgs('http://localhost:8000/')),
    ).rejects.toEqual({ __redirect: '/user/login' });
    expect(useAdminStore.getState().identity).toBeNull();
  });

  test('forwards the OAuth failure param to the login page', async () => {
    adminFetchMock.mockRejectedValue(new Error('401'));
    fetchAdminMetaMock.mockRejectedValue(new Error('401'));

    await expect(
      adminRootLoader(
        rootArgs('http://localhost:8000/?error=admin_login_failed'),
      ),
    ).rejects.toEqual({ __redirect: '/user/login?error=admin_login_failed' });
  });
});

describe('adminLoginLoader', () => {
  test('redirects to the shell when a session already exists', async () => {
    adminFetchMock.mockResolvedValue({ data: identity });

    await expect(adminLoginLoader()).rejects.toEqual({ __redirect: '/' });
  });

  test('returns null when there is no session', async () => {
    adminFetchMock.mockRejectedValue(new Error('401'));

    await expect(adminLoginLoader()).resolves.toBeNull();
  });
});
