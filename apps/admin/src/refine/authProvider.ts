import type { AuthProvider } from '@refinedev/core';
import type { AdminUser } from '@starter/schemas';
import { useAdminStore } from './adminStore';
import { ADMIN_API_URL } from './config';
import { AdminHttpError, adminFetch } from './http';
import { hardNavigate, hardReplace } from './navigation';

// Plain function (not only a provider method) because the header avatar in
// BasicLayout sits OUTSIDE the <Refine> subtree and cannot call useLogout().
// The logout endpoint is idempotent and requires no auth; a network error
// just means the session cookie dies on its own expiry. The hard redirect
// also wipes any stale query cache via the full page load.
export async function adminLogout(): Promise<void> {
  await adminFetch('/admin/auth/logout', { method: 'POST' }).catch(
    () => undefined,
  );
  hardReplace('/user/login');
}

// Admin realm auth: Google OIDC cookie session on apps/api. The admin_session
// cookie gates the whole shell; /user/login is the admin login page.
export const authProvider: AuthProvider = {
  // Full-page redirect into the OAuth flow; the callback sets the
  // admin_session cookie and redirects back to ADMIN_URL (fresh page load,
  // so the root loader re-runs and picks up the session).
  login: async () => {
    hardNavigate(`${ADMIN_API_URL}/admin/auth/google`);
    return { success: true };
  },

  logout: async () => {
    await adminLogout();
    return { success: true };
  },

  check: async () => {
    try {
      await adminFetch<{ data: AdminUser }>('/admin/auth/me');
      return { authenticated: true };
    } catch {
      return { authenticated: false, logout: false, redirectTo: '/user/login' };
    }
  },

  // Mid-session expiry: route loaders do not revalidate on client-side
  // navigations, so a dataProvider 401 is the signal that the session died —
  // log out (idempotent POST) and land on the login page.
  onError: async (error) => {
    if (error instanceof AdminHttpError && error.statusCode === 401) {
      return { logout: true, redirectTo: '/user/login' };
    }
    return { error };
  },

  getIdentity: async () => useAdminStore.getState().identity,

  getPermissions: async () => useAdminStore.getState().identity?.role ?? null,
};
