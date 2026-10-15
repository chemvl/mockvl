import type { AccessControlProvider, CanReturnType } from '@refinedev/core';
import {
  ADMIN_ROLES,
  type AdminRole,
  RESOURCE_ACTIONS,
  type ResourceAction,
  type ResourceMeta,
} from '@starter/schemas';
import { useAdminStore } from './adminStore';

// Refine action names → API permission actions. Refine has more verbs than
// the API's four: edit maps to update, clone needs create, show needs list.
const REFINE_ACTION_MAP: Record<string, ResourceAction> = {
  list: 'list',
  show: 'list',
  create: 'create',
  clone: 'create',
  edit: 'update',
  delete: 'delete',
};

export type AccessCheck = CanReturnType;

// Pure so the role×action matrix is unit-testable without mounting Refine.
// Deny-by-default: unknown action, unknown resource, missing identity, or an
// absent permission entry (action disabled server-side) all yield can:false.
export function checkAccess(
  resources: ResourceMeta[],
  role: AdminRole | null,
  resourceName: string | undefined,
  action: string,
): AccessCheck {
  if (!role) {
    return { can: false, reason: 'No admin session' };
  }
  const apiAction = REFINE_ACTION_MAP[action];
  if (!apiAction || !RESOURCE_ACTIONS.includes(apiAction)) {
    return { can: false, reason: `Unknown action: ${action}` };
  }
  const resource = resources.find((r) => r.name === resourceName);
  if (!resource) {
    return { can: false, reason: `Unknown resource: ${resourceName}` };
  }
  const requiredRole = resource.permissions[apiAction];
  if (!requiredRole) {
    return { can: false, reason: `Action ${apiAction} is disabled` };
  }
  const can = ADMIN_ROLES.indexOf(role) >= ADMIN_ROLES.indexOf(requiredRole);
  return can
    ? { can }
    : { can: false, reason: `Requires ${requiredRole} role` };
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const { identity, resources } = useAdminStore.getState();
    return checkAccess(resources, identity?.role ?? null, resource, action);
  },
};
