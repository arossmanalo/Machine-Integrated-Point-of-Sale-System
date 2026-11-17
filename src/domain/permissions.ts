export const ROLES = ['OWNER', 'ADMIN', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EMPLOYEE: 'Employee',
};

export function isManager(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

const ownerOnly = (role: Role) => role === 'OWNER';

export const can = {
  seeRevenue: isManager,
  manageStaff: isManager,
  viewReports: isManager,
  changeSettings: isManager,
  voidOrder: isManager,
  setAuditedStatus: isManager,
  manageInventoryItems: isManager,
  backdateOrder: ownerOnly,
  manageMachines: ownerOnly,
  viewUnlockLog: ownerOnly,
  changeOwnerPin: ownerOnly,
  // Backups hold the owner PIN hash and a restore replaces the unlock log.
  manageBackups: ownerOnly,
};

interface Account {
  id: string;
  role: Role;
}

/** Roles the acting user may give an account (null target = a new account). */
export function assignableRoles(actor: Account, target: Account | null): Role[] {
  if (target !== null && target.id === actor.id) return [];
  if (actor.role === 'OWNER') return target?.role === 'OWNER' ? [] : ['ADMIN', 'EMPLOYEE'];
  if (actor.role === 'ADMIN') {
    return target === null || target.role === 'EMPLOYEE' ? ['EMPLOYEE'] : [];
  }
  return [];
}

/** Whether the actor may edit this account (their own, or one below them). */
export function canEditAccount(actor: Account, target: Account): boolean {
  if (actor.id === target.id) return true;
  if (actor.role === 'OWNER') return target.role !== 'OWNER';
  if (actor.role === 'ADMIN') return target.role === 'EMPLOYEE';
  return false;
}

/** Nobody deletes their own account, and the owner account is never deleted. */
export function canDeleteAccount(actor: Account, target: Account): boolean {
  return actor.id !== target.id && canEditAccount(actor, target);
}
