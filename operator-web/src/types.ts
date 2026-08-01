export type ViewKey = 'overview' | 'strategies' | 'backtests' | 'shadow' | 'allocation' | 'audit' | 'health' | 'emergency';

export interface BootstrapData {
  operator: {
    userId: string;
    email: string;
    role: string;
    permissions: string[];
    source: string;
  };
  mode: 'READ_ONLY' | 'CONTROLLED_MUTATION';
  mutationsEnabled: boolean;
  summary: {
    strategyCount: number;
    failedBacktests: number;
    openBreaks: number;
    recentFailures: number;
  };
  killSwitch: Record<string, unknown> | null;
  asOf: string;
}

export interface StrategyVersionRow {
  id: string;
  version: number;
  status: string;
  configHash: string;
  effectiveFrom?: string | null;
  createdAt: string;
  _count: { rules: number; signalDecisions: number; aosBacktestRuns: number };
}

export interface StrategyVersionDetail {
  version: StrategyVersionRow & {
    configJson: Record<string, unknown>;
    rules: Array<{
      ruleDefinitionId: string;
      priority: number;
      enabled: boolean;
      weight?: string | number | null;
      parametersJson: Record<string, unknown>;
      ruleDefinition: { key: string; name: string; category: string };
    }>;
  };
  baseline: Record<string, unknown> | null;
  diff: Array<{ path: string; before: unknown; after: unknown }>;
}

export interface StrategyRow {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  direction: string;
  horizonMinDays: number;
  horizonMaxDays: number;
  status: string;
  versions: StrategyVersionRow[];
}

export interface BacktestRow {
  id: string;
  datasetVersion: string;
  startDate: string;
  endDate: string;
  acceptanceStatus: string;
  metricsJson: Record<string, unknown>;
  createdAt: string;
  strategyVersion: { version: number; strategy: { name: string } };
  acceptance: Array<{ criterionKey: string; passed: boolean }>;
  _count: { trades: number };
}

export interface ShadowData {
  accounts: Array<{
    id: string;
    label: string;
    accountType: string;
    status: string;
    capitalBuckets: Array<{
      bucketType: string;
      targetWeight: string | number;
      availableAmount?: string | number | null;
    }>;
  }>;
  plans: Array<{
    id: string;
    status: string;
    mode: string;
    side: string;
    plannedQuantity: number;
    plannedPrice?: string | number | null;
    validFrom: string;
    expiresAt: string;
    order?: { status: string; fills: unknown[] } | null;
  }>;
  reconciliations: Array<{
    id: string;
    tradeDate: string;
    status: string;
    unexplainedBreaks: number;
    completedAt: string;
  }>;
  breaks: Array<{
    id: string;
    breakKey: string;
    severity: string;
    category: string;
    resolution: string;
    createdAt: string;
  }>;
}

export interface AuditData {
  approvals: Record<string, unknown>[];
  configEvents: Record<string, unknown>[];
  interventions: Record<string, unknown>[];
  killEvents: Record<string, unknown>[];
  commands: Record<string, unknown>[];
}

export interface HealthRow {
  id: string;
  jobKey: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface AllocationPolicyRow {
  id: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  spgiWeight: string | number;
  vtiWeight: string | number;
  systemTradingWeight: string | number;
  profitPeriodPolicyJson: Record<string, unknown>;
  taxReservePolicyJson: Record<string, unknown>;
  fxPolicyJson: Record<string, unknown>;
  minimumAmountPolicyJson: Record<string, unknown>;
  contentHash: string;
  createdByUserId: string;
  approvedByUserId?: string | null;
  effectiveFrom?: string | null;
  createdAt: string;
}

export interface AllocationPlanRow {
  id: string;
  tradingAccountId: string;
  periodStart: string;
  periodEnd: string;
  revision: number;
  grossRealizedProfit: string | number;
  taxReserveAmount: string | number;
  fxReserveAmount: string | number;
  distributableProfit: string | number;
  currency: string;
  status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  planHash: string;
  sourceEvidenceJson: Record<string, unknown>;
  parentPlanId?: string | null;
  createdByUserId: string;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  allocationPolicy: { version: number; contentHash: string };
  tradingAccount: { label: string };
  items: Array<{
    destination: 'SPGI' | 'VTI' | 'SYSTEM_TRADING';
    weight: string | number;
    amount: string | number;
  }>;
  ledger: Array<{
    eventType: string;
    actorRole: string;
    reason: string;
    receiptHash: string;
    createdAt: string;
  }>;
}

export interface AllocationData {
  policies: AllocationPolicyRow[];
  accounts: Array<{
    id: string;
    userId: string;
    label: string;
    currency: string;
  }>;
  plans: AllocationPlanRow[];
}
