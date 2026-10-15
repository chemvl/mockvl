// config.ts reads import.meta.env (Vite-only syntax) — replace it wholesale.
jest.mock('../config', () => ({ ADMIN_API_URL: 'http://api.test' }));

// Real AdminHttpError (onError narrows on instanceof), mocked adminFetch.
jest.mock('../http', () => {
  const actual = jest.requireActual('../http');
  return { AdminHttpError: actual.AdminHttpError, adminFetch: jest.fn() };
});

jest.mock('../navigation', () => ({
  hardNavigate: jest.fn(),
  hardReplace: jest.fn(),
}));

import { adminLogout, authProvider } from '../authProvider';
import { AdminHttpError, adminFetch } from '../http';
import { hardNavigate, hardReplace } from '../navigation';

const adminFetchMock = adminFetch as jest.Mock;
const hardNavigateMock = hardNavigate as jest.Mock;
const hardReplaceMock = hardReplace as jest.Mock;

beforeEach(() => {
  adminFetchMock.mockReset();
  hardNavigateMock.mockReset();
  hardReplaceMock.mockReset();
});

describe('adminLogout', () => {
  test('POSTs the logout endpoint then lands on the login page', async () => {
    adminFetchMock.mockResolvedValue({ data: { success: true } });

    await adminLogout();

    expect(adminFetchMock).toHaveBeenCalledWith('/admin/auth/logout', {
      method: 'POST',
    });
    expect(hardReplaceMock).toHaveBeenCalledWith('/user/login');
  });

  test('still lands on the login page when the POST fails', async () => {
    adminFetchMock.mockRejectedValue(new Error('network down'));

    await adminLogout();

    expect(hardReplaceMock).toHaveBeenCalledWith('/user/login');
  });
});

describe('authProvider', () => {
  test('login hands the browser to the Google OAuth flow', async () => {
    await authProvider.login({});

    expect(hardNavigateMock).toHaveBeenCalledWith(
      'http://api.test/admin/auth/google',
    );
  });

  test('check failure redirects to the login page', async () => {
    adminFetchMock.mockRejectedValue(new AdminHttpError('Unauthorized', 401));

    await expect(authProvider.check()).resolves.toEqual({
      authenticated: false,
      logout: false,
      redirectTo: '/user/login',
    });
  });

  test('check succeeds on a live session', async () => {
    adminFetchMock.mockResolvedValue({ data: { id: '1' } });

    await expect(authProvider.check()).resolves.toEqual({
      authenticated: true,
    });
  });

  test('onError logs out on a 401 (mid-session expiry)', async () => {
    const result = await authProvider.onError(
      new AdminHttpError('Unauthorized', 401),
    );

    expect(result).toEqual({ logout: true, redirectTo: '/user/login' });
  });

  test('onError passes other errors through', async () => {
    const error = new AdminHttpError('Forbidden', 403);

    await expect(authProvider.onError(error)).resolves.toEqual({ error });
  });
});
