import { useUserStore } from '@/store';

const ROLE = {
  LOCKED: 0,
  GUEST: 16,
  STAFF: 32,
  MODERATOR: 48,
  MAINTAINER: 64,
  SUPERVISOR: 80,
} as const;

type RolePermissions = {
  canAddUser: boolean;
  canEditUserRole: boolean;
  canDeleteUser: boolean;
  canGrantGroup: boolean;
  canCreateGroup: boolean;
  canEditGroup: boolean;
};

export function getRolePermissions(role: number | undefined): RolePermissions {
  const r = role ?? 0;
  return {
    canAddUser: r >= ROLE.MAINTAINER,
    canEditUserRole: r >= ROLE.MAINTAINER,
    canDeleteUser: r >= ROLE.SUPERVISOR,
    canGrantGroup: r >= ROLE.MAINTAINER,
    canCreateGroup: r >= ROLE.SUPERVISOR,
    canEditGroup: r >= ROLE.SUPERVISOR,
  };
}

export function useRolePermissions(): RolePermissions {
  const role = useUserStore((s) => (s.currentUser as any)?.role);
  return getRolePermissions(role);
}
