import type { AdminUser, ResourceMeta } from '@starter/schemas';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Bridge between the route-loader boot fetch and BasicLayout, which sits
// OUTSIDE the Refine subtree and therefore cannot use Refine hooks. The
// loader writes here; the sidebar menu reads reactively.
type AdminState = {
  identity: AdminUser | null;
  resources: ResourceMeta[];
  setBoot: (boot: {
    identity: AdminUser | null;
    resources: ResourceMeta[];
  }) => void;
};

export const useAdminStore = create<AdminState>()(
  devtools(
    (set) => ({
      identity: null,
      resources: [],
      setBoot: ({ identity, resources }) =>
        set({ identity, resources }, false, 'setBoot'),
    }),
    { name: 'AdminStore' },
  ),
);
