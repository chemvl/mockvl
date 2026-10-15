import { createBrowserRouter, RouterProvider, redirect } from 'react-router';
import BasicLayout from '@/app/BasicLayout';
import { ADMIN_BASENAME } from '@/refine/config';
import { adminLoginLoader, adminRootLoader } from '@/refine/loader';
import RefineRoot from '@/refine/RefineRoot';
import { selectAccess, useUserStore } from '@/store';

// basename '/admin' in deployed builds (single-domain layout, nginx serves the
// SPA under /admin); '/' in local dev. See ADMIN_BASENAME in refine/config.ts.
export const router = createBrowserRouter(
  [
    {
      // Auth-gated shell — the admin_session cookie (apps/api admin realm)
      // gates everything under '/'; no session → redirect to /user/login.
      path: '/',
      Component: BasicLayout,
      loader: adminRootLoader,
      children: [
        {
          // Pathless Refine wrapper: gives every shell page Refine context.
          // Identity + resource meta were already booted by the root loader
          // (RefineRoot reads them from the admin store). Login/register
          // siblings stay outside this subtree.
          Component: RefineRoot,
          children: [
            {
              index: true,
              lazy: () =>
                import('@/refine/pages/AdminHome').then((m) => ({
                  Component: m.default,
                })),
            },
            {
              path: 'admin',
              loader: () => {
                const { canAdmin } = selectAccess(useUserStore.getState());
                if (!canAdmin) throw redirect('/exception/403');
                return null;
              },
              lazy: async () => {
                const m = await import('@/pages/Admin');
                return { Component: m.default };
              },
            },
            {
              path: 'exception/403',
              lazy: async () => {
                const m = await import('@/pages/exception/403/index');
                return { Component: m.default };
              },
            },
            {
              path: 'exception/404',
              lazy: async () => {
                const m = await import('@/pages/exception/404/index');
                return { Component: m.default };
              },
            },
            {
              path: 'exception/500',
              lazy: async () => {
                const m = await import('@/pages/exception/500/index');
                return { Component: m.default };
              },
            },
            {
              path: 'notifications',
              lazy: async () => {
                const m = await import('@/pages/Notifications/index');
                return { Component: m.default };
              },
            },

            {
              // create/edit are children so the list (and its table state)
              // stays mounted while the form opens in a drawer over it.
              path: 'resources/:resource',
              lazy: async () => {
                const m = await import('@/refine/pages/ResourceList');
                return { Component: m.default };
              },
              children: [
                {
                  path: 'create',
                  lazy: async () => {
                    const m = await import('@/refine/pages/ResourceFormDrawer');
                    return { Component: m.default };
                  },
                },
                {
                  path: 'edit/:id',
                  lazy: async () => {
                    const m = await import('@/refine/pages/ResourceFormDrawer');
                    return { Component: m.default };
                  },
                },
              ],
            },
            {
              path: '*',
              lazy: async () => {
                const m = await import('@/pages/exception/404/index');
                return { Component: m.default };
              },
            },
          ],
        },
      ],
    },
    {
      path: '/user/login',
      loader: adminLoginLoader,
      lazy: async () => {
        const m = await import('@/pages/User/login/index');
        return { Component: m.default };
      },
    },
    {
      path: '/user/register',
      lazy: async () => {
        const m = await import('@/pages/User/register/index');
        return { Component: m.default };
      },
    },
    {
      path: '/user/register-result',
      lazy: async () => {
        const m = await import('@/pages/User/register-result/index');
        return { Component: m.default };
      },
    },
  ],
  { basename: ADMIN_BASENAME },
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
