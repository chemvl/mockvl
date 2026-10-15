import { Refine } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import { useMemo } from 'react';
import { Outlet } from 'react-router';
import { queryClient } from '@/queryClient';
import { accessControlProvider } from './accessControlProvider';
import { useAdminStore } from './adminStore';
import { authProvider } from './authProvider';
import { dataProvider } from './dataProvider';
import { notificationProvider } from './notificationProvider';
import { toRefineResources } from './resources';

// Pathless wrapper route around the app shell's children: everything under
// '/' gets Refine context, but only /resources/* pages use it. Resources come
// from the admin store, populated by the root loader before render
// (role-filtered meta endpoint) — registering a resource server-side is all
// it takes for these routes to start serving it.
export default function RefineRoot() {
  const metas = useAdminStore((s) => s.resources);
  const resources = useMemo(() => toRefineResources(metas), [metas]);

  return (
    <Refine
      dataProvider={dataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      notificationProvider={notificationProvider}
      routerProvider={routerProvider}
      resources={resources}
      options={{
        // Share the app's existing QueryClient instead of letting Refine
        // create a second cache.
        reactQuery: { clientConfig: queryClient },
        disableTelemetry: true,
        // Refine's RouteChangeHandler pings authProvider.check() (= GET
        // /admin/auth/me) on every pathname change and discards the result.
        // The root loader already gates entry and dataProvider 401s handle
        // mid-session expiry, so the ping is pure overhead.
        disableRouteChangeHandler: true,
      }}
    >
      <Outlet />
    </Refine>
  );
}
