import type { AdminUser, ResourceMeta } from '@starter/schemas';
import { type LoaderFunctionArgs, redirect } from 'react-router';
import { useAdminStore } from './adminStore';
import { adminFetch } from './http';
import { fetchAdminMeta } from './resources';

export type AdminBoot = {
  identity: AdminUser | null;
  resources: ResourceMeta[];
};

// A missing admin session (401), a down API, or a malformed meta payload all
// degrade to "no admin realm" — the gate then bounces to the login page
// instead of crashing the router.
async function fetchAdminBoot(): Promise<AdminBoot> {
  const [identity, resources] = await Promise.all([
    adminFetch<{ data: AdminUser }>('/admin/auth/me')
      .then((response) => response.data)
      .catch(() => null),
    fetchAdminMeta().catch(() => []),
  ]);
  const boot = { identity, resources };
  useAdminStore.getState().setBoot(boot);
  return boot;
}

// Root gate: the whole shell rides on the admin_session cookie. The Google
// OAuth callback 302s back to ADMIN_URL — a fresh page load, so this loader
// re-runs naturally after login. Its failure redirect lands on
// `/?error=admin_login_failed`, so the error param must be forwarded to the
// login page or it is lost.
export async function adminRootLoader({
  request,
}: LoaderFunctionArgs): Promise<AdminBoot> {
  const boot = await fetchAdminBoot();
  if (boot.identity === null) {
    const error = new URL(request.url).searchParams.get('error');
    throw redirect(error ? `/user/login?error=${error}` : '/user/login');
  }
  return boot;
}

// Login-page gate: already-authenticated admins bounce straight to the shell.
// No meta fetch here — the root loader does the full boot after the redirect.
export async function adminLoginLoader(): Promise<null> {
  const hasSession = await adminFetch<{ data: AdminUser }>('/admin/auth/me')
    .then(() => true)
    .catch(() => false);
  if (hasSession) throw redirect('/');
  return null;
}
