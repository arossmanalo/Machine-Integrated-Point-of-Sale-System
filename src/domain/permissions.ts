export const ROLES = ['DEVELOPER', 'OWNER', 'ADMIN', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  DEVELOPER: 'Developer',
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EMPLOYEE: 'Employee',
};

/**
 * The developer can do everything the owner can, and is the only one who sets up and tests the
 * machines and sees how they are wired.
 */
export function hasOwnerRights(role: Role): boolean {
  return role === 'OWNER' || role === 'DEVELOPER';
}

export function isManager(role: Role): boolean {
  return hasOwnerRights(role) || role === 'ADMIN';
}

const developerOnly = (role: Role) => role === 'DEVELOPER';

export const can = {
  seeRevenue: isManager,
  manageStaff: isManager,
  viewReports: isManager,
  changeSettings: isManager,
  voidOrder: isManager,
  setAuditedStatus: isManager,
  manageInventoryItems: isManager,
  manageExpenses: isManager,
  backdateOrder: hasOwnerRights,
  /** Shop-wide owner settings: GCash QR, top-up prices on new orders, staff expenses. */
  changeOwnerSettings: hasOwnerRights,
  /** The Manage › Machines screen: read-only for the owner. */
  viewMachineSettings: hasOwnerRights,
  /** Adding and changing machines, cycles and the controller, and Testing mode. */
  manageMachines: developerOnly,
  viewUnlockLog: hasOwnerRights,
  changeOwnerPin: hasOwnerRights,
  /** Printing an order's one-time override receipt, which stands in for the owner PIN once. */
  issueOverrideReceipts: hasOwnerRights,
  // Backups hold the owner PIN hash and a restore replaces the unlock log.
  manageBackups: hasOwnerRights,
};

interface Account {
  id: string;
  role: Role;
}

/**
 * Roles the acting user may give an account (null target = a new account). Nobody gives out the
 * developer role: the developer signs in with the login built into the app.
 */
export function assignableRoles(actor: Account, target: Account | null): Role[] {
  if (target !== null && target.id === actor.id) return [];
  if (hasOwnerRights(actor.role)) return hasOwnerRights(target?.role ?? 'EMPLOYEE') ? [] : ['ADMIN', 'EMPLOYEE'];
  if (actor.role === 'ADMIN') {
    return target === null || target.role === 'EMPLOYEE' ? ['EMPLOYEE'] : [];
  }
  return [];
}

/** Whether the actor may edit this account (their own, or one below them). */
export function canEditAccount(actor: Account, target: Account): boolean {
  if (actor.id === target.id) return true;
  if (actor.role === 'DEVELOPER') return true;
  if (actor.role === 'OWNER') return !hasOwnerRights(target.role);
  if (actor.role === 'ADMIN') return target.role === 'EMPLOYEE';
  return false;
}

/** Nobody deletes their own account, and the owner account is never deleted. */
export function canDeleteAccount(actor: Account, target: Account): boolean {
  return actor.id !== target.id && target.role !== 'OWNER' && canEditAccount(actor, target);
}
