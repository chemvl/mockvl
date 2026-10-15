import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { clearTokens } from '@/lib/auth/tokenStorage';

// The legacy product realm is parked: src/client is generated from apps/api
// (see openapi-ts.config.ts), which has no /me or token-revoke endpoints, so
// this store no longer talks to the network. It survives only so the parked
// legacy pages keep their imports — the admin realm (refine/adminStore) owns
// identity and auth.
type CurrentUser = { id: number; name: string; uid: string };

type UserState = {
  currentUser: CurrentUser | undefined;
  loading: boolean;

  fetchUserInfo: () => Promise<CurrentUser | undefined>;
  setCurrentUser: (user: CurrentUser) => void;
  refresh: () => Promise<CurrentUser | undefined>;
  logout: () => Promise<void>;
};

export const useUserStore = create<UserState>()(
  devtools(
    (set, get) => ({
      currentUser: undefined,
      loading: false,

      fetchUserInfo: async () => undefined,

      setCurrentUser: (user) =>
        set({ currentUser: user }, false, 'setCurrentUser'),

      refresh: () => get().fetchUserInfo(),

      logout: async () => {
        clearTokens();
        window.location.replace('/user/login');
      },
    }),
    { name: 'UserStore' },
  ),
);

export const selectAccess = (_s: UserState) => ({
  canAdmin: false as boolean,
});
