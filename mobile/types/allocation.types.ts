export interface AosAllocationSummary {
  policy: {
    version: number;
    spgiWeight: string | number;
    vtiWeight: string | number;
    systemTradingWeight: string | number;
    contentHash: string;
    effectiveFrom: string;
  } | null;
  plans: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    revision: number;
    distributableProfit: string | number;
    currency: string;
    approvedAt: string;
    planHash: string;
    items: Array<{
      destination: 'SPGI' | 'VTI' | 'SYSTEM_TRADING';
      weight: string | number;
      amount: string | number;
    }>;
  }>;
  executionAvailable: false;
}
