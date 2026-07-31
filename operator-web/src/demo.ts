import type { AuditData, BacktestRow, BootstrapData, HealthRow, ShadowData, StrategyRow } from './types';

const now = new Date('2026-08-01T08:14:00+09:00').toISOString();

export const demoBootstrap: BootstrapData = {
  operator: { userId: 'demo', email: 'operator@aos.local', role: 'ADMIN', permissions: ['OPERATOR_READ', 'CONFIG_WRITE', 'CONFIG_APPROVE', 'EMERGENCY_CONTROL', 'RECONCILIATION_RESOLVE'], source: 'MEMBERSHIP' },
  mode: 'READ_ONLY',
  mutationsEnabled: false,
  summary: { strategyCount: 3, failedBacktests: 1, openBreaks: 1, recentFailures: 0 },
  killSwitch: { command: 'ACKNOWLEDGE', mode: 'FULL_HALT', requestedAt: now },
  asOf: now,
};

export const demoStrategies: StrategyRow[] = [
  {
    id: 'swing-core', key: 'adaptive-swing-core', name: 'Adaptive Swing Core', description: '국내 주식 Long Only · 2~20거래일', direction: 'LONG_ONLY', horizonMinDays: 2, horizonMaxDays: 20, status: 'ACTIVE',
    versions: [
      { id: 'v12', version: 12, status: 'APPROVAL_PENDING', configHash: '7b2f5f78d6c2cf84f88c87ad2ba765d0cb16f094953139220a9bbaad23fb9e54', createdAt: now, _count: { rules: 14, signalDecisions: 1248, aosBacktestRuns: 3 } },
      { id: 'v11', version: 11, status: 'ACTIVE', configHash: 'eb151f608fbc1a6ca10ce5632178f87f570dd2d86061e8cf7d0aacb12827a3ac', effectiveFrom: '2026-07-28T10:00:00.000Z', createdAt: '2026-07-25T10:00:00.000Z', _count: { rules: 14, signalDecisions: 931, aosBacktestRuns: 4 } },
    ],
  },
  { id: 'quality', key: 'quality-pullback', name: 'Quality Pullback', description: '실적·추세 확인 후 눌림목', direction: 'LONG_ONLY', horizonMinDays: 4, horizonMaxDays: 15, status: 'ACTIVE', versions: [{ id: 'q4', version: 4, status: 'BACKTESTED', configHash: '2e574f2d3f82f881f93f09c96635114372e52a410eabaf97b5488273e30aaec8', createdAt: now, _count: { rules: 11, signalDecisions: 622, aosBacktestRuns: 2 } }] },
  { id: 'event', key: 'event-edge', name: 'Event Edge', description: '공시 이벤트 이후 단기 반응', direction: 'LONG_ONLY', horizonMinDays: 2, horizonMaxDays: 8, status: 'DRAFT', versions: [{ id: 'e7', version: 7, status: 'DRAFT', configHash: '6b34c8bca5e1b65b05d40391f1e2911c49222392d78ce95207e5eed2478d043b', createdAt: now, _count: { rules: 9, signalDecisions: 0, aosBacktestRuns: 0 } }] },
];
export const demoBacktests: BacktestRow[] = [
  { id: 'bt-1', datasetVersion: 'krx-pit-2026.07.31', startDate: '2021-01-04T00:00:00.000Z', endDate: '2026-06-30T00:00:00.000Z', acceptanceStatus: 'PASSED', metricsJson: { cagrPct: 17.4, mddPct: -11.8, sharpe: 1.31, winRatePct: 58.2 }, createdAt: now, strategyVersion: { version: 12, strategy: { name: 'Adaptive Swing Core' } }, acceptance: [{ criterionKey: 'POSITIVE_EXPECTANCY', passed: true }, { criterionKey: 'MDD_LIMIT', passed: true }, { criterionKey: 'OOS_STABILITY', passed: true }], _count: { trades: 486 } },
  { id: 'bt-2', datasetVersion: 'krx-pit-2026.07.31', startDate: '2022-01-03T00:00:00.000Z', endDate: '2026-06-30T00:00:00.000Z', acceptanceStatus: 'FAILED', metricsJson: { cagrPct: 8.1, mddPct: -22.6, sharpe: 0.68, winRatePct: 49.1 }, createdAt: '2026-07-31T06:00:00.000Z', strategyVersion: { version: 4, strategy: { name: 'Quality Pullback' } }, acceptance: [{ criterionKey: 'POSITIVE_EXPECTANCY', passed: true }, { criterionKey: 'MDD_LIMIT', passed: false }, { criterionKey: 'OOS_STABILITY', passed: false }], _count: { trades: 219 } },
];

export const demoShadow: ShadowData = {
  accounts: [{ id: 'acct-1', label: '시스템 트레이딩', accountType: 'SYSTEM_TRADING', status: 'ACTIVE', capitalBuckets: [{ bucketType: 'SYSTEM_TRADING', targetWeight: 0.2, availableAmount: 20_000_000 }] }, { id: 'acct-2', label: '장기 자산', accountType: 'LONG_TERM', status: 'ACTIVE', capitalBuckets: [{ bucketType: 'SPGI', targetWeight: 0.5, availableAmount: 50_000_000 }, { bucketType: 'VTI', targetWeight: 0.3, availableAmount: 30_000_000 }] }],
  plans: [{ id: 'plan-105', status: 'APPROVED', mode: 'SHADOW', side: 'BUY', plannedQuantity: 71, plannedPrice: 70000, validFrom: now, expiresAt: '2026-08-08T00:00:00.000Z', order: { status: 'PARTIAL', fills: [{}] } }, { id: 'plan-104', status: 'EXECUTED', mode: 'SHADOW', side: 'BUY', plannedQuantity: 18, plannedPrice: 182000, validFrom: now, expiresAt: '2026-08-05T00:00:00.000Z', order: { status: 'FILLED', fills: [{}] } }],
  reconciliations: [{ id: 'rec-1', tradeDate: '20260731', status: 'MATCHED', unexplainedBreaks: 0, completedAt: now }, { id: 'rec-2', tradeDate: '20260730', status: 'BROKEN', unexplainedBreaks: 1, completedAt: '2026-07-30T12:00:00.000Z' }],
  breaks: [{ id: 'break-1', breakKey: 'paper-392', severity: 'ERROR', category: 'FILL_MISMATCH', resolution: 'OPEN', createdAt: now }],
};

export const demoAudit: AuditData = {
  approvals: [{ id: 'ap-1', decision: 'APPROVE', subjectType: 'STRATEGY_VERSION', subjectId: 'v11', actorRoleKey: 'APPROVER', reason: 'OOS 기준 및 MDD 수용 기준 통과', createdAt: now }],
  configEvents: [{ id: 'cfg-1', action: 'STATE_TRANSITIONED', subjectType: 'STRATEGY_VERSION', subjectId: 'v12', reason: '검증 완료 후 승인 요청', createdAt: now }],
  interventions: [{ id: 'hi-1', type: 'APPROVE', targetType: 'RECONCILIATION_BREAK', targetId: 'break-0', reasonText: '증권사 체결 정정 반영 확인', createdAt: now }],
  killEvents: [{ id: 'ks-1', command: 'ACKNOWLEDGE', scope: 'NEW_ENTRY', mode: 'FULL_HALT', reasonText: '정기 비상 통제 훈련', createdAt: now }],
  commands: [{ id: 'cmd-1', commandType: 'DECIDE_APPROVAL', targetType: 'STRATEGY_VERSION', targetId: 'v11', actorRole: 'APPROVER', status: 'SUCCEEDED', reason: '승인 기준 충족', createdAt: now }],
};

export const demoHealth: HealthRow[] = [
  { id: 'h1', jobKey: 'market.daily-price', status: 'SUCCESS', triggeredBy: 'CRON', startedAt: '2026-08-01T07:00:00+09:00', finishedAt: '2026-08-01T07:01:24+09:00' },
  { id: 'h2', jobKey: 'market.indicator-daily', status: 'SUCCESS', triggeredBy: 'CRON', startedAt: '2026-08-01T08:15:00+09:00', finishedAt: '2026-08-01T08:15:41+09:00' },
  { id: 'h3', jobKey: 'paper.simulation', status: 'SUCCESS', triggeredBy: 'CRON', startedAt: '2026-07-31T19:30:00+09:00', finishedAt: '2026-07-31T19:30:18+09:00' },
  { id: 'h4', jobKey: 'aos.reconciliation', status: 'SKIPPED', triggeredBy: 'CRON', startedAt: '2026-08-01T08:00:00+09:00', finishedAt: '2026-08-01T08:00:01+09:00', errorMessage: '휴장일' },
];
