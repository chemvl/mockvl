import { ADMIN_ROLES, type AdminRole } from "@starter/schemas";

// viewer < editor < owner, by position in ADMIN_ROLES.
export function roleAtLeast(role: AdminRole, minRole: AdminRole): boolean {
  return ADMIN_ROLES.indexOf(role) >= ADMIN_ROLES.indexOf(minRole);
}
