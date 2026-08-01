export type AosOperatorPermission =
  | 'OPERATOR_READ'
  | 'CONFIG_WRITE'
  | 'CONFIG_APPROVE'
  | 'EMERGENCY_CONTROL'
  | 'RECONCILIATION_RESOLVE';

export interface AosOperatorBootstrap {
  operator: {
    userId: string;
    email: string;
    role: 'VIEWER' | 'EDITOR' | 'APPROVER' | 'RISK_OFFICER' | 'ADMIN';
    permissions: AosOperatorPermission[];
    source: 'MEMBERSHIP' | 'BOOTSTRAP_ENV';
  };
  mode: 'READ_ONLY' | 'CONTROLLED_MUTATION';
  mutationsEnabled: boolean;
  killSwitch: AosKillSwitchReceipt | null;
  asOf: string;
}

export interface AosKillSwitchReceipt {
  id: string;
  command: 'ACTIVATE' | 'DEACTIVATE_REQUEST' | 'ACKNOWLEDGE';
  scope: 'NEW_ENTRY' | 'ACCOUNT' | 'STRATEGY' | 'ALL_ORDERS';
  mode: 'REDUCE_ONLY' | 'FULL_HALT';
  reasonText: string;
  requestedAt: string;
  effectiveAt: string | null;
  correlationId: string;
  receiptHash: string;
}

export interface ActivateMobileKillSwitchInput {
  password: string;
  reason: string;
  correlationId: string;
}
