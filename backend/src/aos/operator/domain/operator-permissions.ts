export const OPERATOR_PERMISSIONS = [
  'OPERATOR_READ',
  'CONFIG_WRITE',
  'CONFIG_APPROVE',
  'EMERGENCY_CONTROL',
  'RECONCILIATION_RESOLVE',
] as const;

export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];
export type OperatorRole = 'VIEWER' | 'EDITOR' | 'APPROVER' | 'RISK_OFFICER' | 'ADMIN';

const ROLE_PERMISSIONS: Readonly<Record<OperatorRole, readonly OperatorPermission[]>> = {
  VIEWER: ['OPERATOR_READ'],
  EDITOR: ['OPERATOR_READ', 'CONFIG_WRITE'],
  APPROVER: ['OPERATOR_READ', 'CONFIG_APPROVE'],
  RISK_OFFICER: ['OPERATOR_READ', 'EMERGENCY_CONTROL', 'RECONCILIATION_RESOLVE'],
  ADMIN: [...OPERATOR_PERMISSIONS],
};

export function permissionsForRole(role: OperatorRole): readonly OperatorPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermissions(
  role: OperatorRole,
  required: readonly OperatorPermission[],
): boolean {
  const permissions = new Set(ROLE_PERMISSIONS[role]);
  return required.every((permission) => permissions.has(permission));
}
