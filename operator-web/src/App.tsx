import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { api, login, logout, token } from './api';
import { formatDate, formatMoney, shortHash, statusTone } from './format';
import type { AllocationData, AllocationPlanRow, AuditData, BacktestRow, BootstrapData, HealthRow, ShadowData, StrategyRow, StrategyVersionDetail, StrategyVersionRow, ViewKey } from './types';

const NAV: Array<{ key: ViewKey; label: string; hint: string }> = [
  { key: 'overview', label: '운영 요약', hint: '오늘 상태' },
  { key: 'strategies', label: '전략·룰', hint: '버전과 승인' },
  { key: 'backtests', label: '백테스트', hint: '승격 근거' },
  { key: 'shadow', label: 'Shadow', hint: '계획과 원장' },
  { key: 'allocation', label: '자산 배분', hint: '확정이익 50·30·20' },
  { key: 'audit', label: '감사·리플레이', hint: '누가, 왜' },
  { key: 'health', label: '데이터·Worker', hint: '신선도' },
  { key: 'emergency', label: '비상 통제', hint: 'Kill Switch' },
];

interface DataState {
  bootstrap: BootstrapData;
  strategies: StrategyRow[];
  backtests: BacktestRow[];
  shadow: ShadowData;
  allocation: AllocationData;
  audit: AuditData;
  health: HealthRow[];
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(api.demo || !!token());
  const [view, setView] = useState<ViewKey>('overview');
  const [data, setData] = useState<DataState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [bootstrap, strategies, backtests, shadow, allocation, audit, health] = await Promise.all([api.bootstrap(), api.strategies(), api.backtests(), api.shadow(), api.allocation(), api.audit(), api.health()]);
      setData({
        bootstrap,
        strategies,
        backtests,
        shadow,
        allocation,
        audit,
        health,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '운영 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated]);

  if (!authenticated) return <LoginScreen onSuccess={() => setAuthenticated(true)} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="AOS 운영 메뉴">
        <div className="brand-lockup">
          <span className="brand-mark">A</span>
          <div>
            <strong>AOS</strong>
            <small>Operator Console</small>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <button key={item.key} className={view === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.key)} aria-current={view === item.key ? 'page' : undefined}>
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="operator-chip">
            <span className="presence" />
            <div>
              <strong>{data?.bootstrap.operator.role ?? '확인 중'}</strong>
              <small>{data?.bootstrap.operator.email ?? '—'}</small>
            </div>
          </div>
          {!api.demo && (
            <button
              className="quiet-button"
              onClick={() => {
                logout();
                setAuthenticated(false);
              }}
            >
              로그아웃
            </button>
          )}
        </div>
      </aside>
      <main id="main" className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">ADAPTIVE ASSET OPERATING SYSTEM</p>
            <h1>{NAV.find((item) => item.key === view)?.label}</h1>
          </div>
          <div className="top-actions">
            {data && <span className={`mode-badge ${data.bootstrap.mutationsEnabled ? 'controlled' : 'readonly'}`}>{data.bootstrap.mutationsEnabled ? '통제 명령 허용' : '읽기 전용'}</span>}
            <button className="icon-button" aria-label="새로고침" onClick={() => void load()} disabled={loading}>
              ↻
            </button>
          </div>
        </header>
        {data && !data.bootstrap.mutationsEnabled && (
          <div className="safety-banner">
            <strong>안전 모드</strong>
            <span>구성 변경과 비상 명령은 잠겨 있습니다. 조회·검증·감사에는 영향이 없습니다.</span>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => void load()}>다시 시도</button>
          </div>
        )}
        {loading && !data ? <Loading /> : data ? <View view={view} data={data} refresh={load} /> : null}
      </main>
    </div>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '로그인 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-lockup large">
          <span className="brand-mark">A</span>
          <div>
            <strong>AOS</strong>
            <small>Operator Console</small>
          </div>
        </div>
        <p className="eyebrow">CONTROL PLANE · NOT A TRADING APP</p>
        <h1>
          운영 판단을 한곳에서,
          <br />
          변경은 증거와 함께.
        </h1>
        <p className="login-copy">전략 버전, 백테스트, Shadow 원장과 비상 통제를 위한 제한된 운영자 화면입니다.</p>
        <form onSubmit={submit}>
          <label>
            운영자 이메일
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? '확인 중…' : '운영 콘솔 열기'}
          </button>
        </form>
        <small className="security-note">세션 토큰은 이 탭의 sessionStorage에만 보관됩니다.</small>
      </section>
      <aside className="login-aside">
        <div className="signal-orbit">
          <span />
          <span />
          <span />
          <b>
            Rule
            <br />
            Risk
          </b>
        </div>
        <div>
          <strong>권한 분리</strong>
          <p>작성자와 승인자는 다릅니다.</p>
        </div>
        <div>
          <strong>단일 사용 인증</strong>
          <p>모든 변경은 5분·1회용 step-up이 필요합니다.</p>
        </div>
        <div>
          <strong>Append-only</strong>
          <p>명령과 사유, 전후 hash를 지우지 않습니다.</p>
        </div>
      </aside>
    </main>
  );
}

function View({ view, data, refresh }: { view: ViewKey; data: DataState; refresh: () => Promise<void> }) {
  if (view === 'overview') return <Overview data={data} />;
  if (view === 'strategies') return <Strategies rows={data.strategies} bootstrap={data.bootstrap} refresh={refresh} />;
  if (view === 'backtests') return <Backtests rows={data.backtests} />;
  if (view === 'shadow') return <Shadow data={data.shadow} bootstrap={data.bootstrap} refresh={refresh} />;
  if (view === 'allocation') return <Allocation data={data.allocation} bootstrap={data.bootstrap} refresh={refresh} />;
  if (view === 'audit') return <Audit data={data.audit} />;
  if (view === 'health') return <Health rows={data.health} />;
  return <Emergency bootstrap={data.bootstrap} refresh={refresh} />;
}

function Overview({ data }: { data: DataState }) {
  const summary = data.bootstrap.summary;
  const matched = data.shadow.reconciliations.filter((r) => r.status === 'MATCHED').length;
  const totalRecon = data.shadow.reconciliations.length;
  return (
    <div className="page-stack">
      <section className="hero-grid">
        <div className="hero-card">
          <p className="eyebrow">오늘의 운영 판단</p>
          <h2>{summary.openBreaks ? '새 주문보다 원장 불일치 확인이 먼저입니다.' : 'Hard Risk와 원장이 정상 범위입니다.'}</h2>
          <p>{summary.openBreaks ? `설명되지 않은 조정 차이 ${summary.openBreaks}건이 남았습니다. 해결 전에는 전략 승격보다 증거 확인을 우선하세요.` : '설명되지 않은 원장 차이가 없습니다. 승인 대기 버전과 데이터 신선도를 순서대로 확인하세요.'}</p>
          <div className="hero-actions">
            <span className="status-pill warn">승인 대기 {data.strategies.flatMap((s) => s.versions).filter((v) => v.status === 'APPROVAL_PENDING').length}</span>
            <span className={`status-pill ${summary.recentFailures ? 'bad' : 'good'}`}>24h Worker 실패 {summary.recentFailures}</span>
          </div>
        </div>
        <div className="allocation-card">
          <p className="eyebrow">자금 경계</p>
          <div className="allocation-bar">
            <span style={{ width: '50%' }}>SPGI 50</span>
            <span style={{ width: '30%' }}>VTI 30</span>
            <span style={{ width: '20%' }}>SYSTEM 20</span>
          </div>
          <p>시스템 손실을 장기계좌에서 자동 보전하지 않습니다.</p>
        </div>
      </section>
      <section className="metric-grid">
        <Metric label="운영 전략" value={summary.strategyCount} hint="Long Only · 2~20일" tone="neutral" />
        <Metric label="Backtest 실패" value={summary.failedBacktests} hint="승격 불가" tone={summary.failedBacktests ? 'warn' : 'good'} />
        <Metric label="열린 원장 차이" value={summary.openBreaks} hint="설명 전까지 보류" tone={summary.openBreaks ? 'bad' : 'good'} />
        <Metric label="조정 일치율" value={totalRecon ? `${Math.round((matched / totalRecon) * 100)}%` : '—'} hint={`최근 ${totalRecon}회`} tone={matched === totalRecon ? 'good' : 'warn'} />
      </section>
      <section className="content-grid">
        <Panel title="결정 경로" subtitle="우회할 수 없는 실행 순서">
          <div className="decision-flow">
            {['Feature', 'Strategy v', 'Signal', 'Portfolio', 'Hard Risk', 'Order Plan', 'Fill'].map((label, index) => (
              <div key={label}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{label}</strong>
                {index < 6 && <i>→</i>}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="최근 승격 근거" subtitle="Acceptance 기준">
          <div className="compact-list">
            {data.backtests.slice(0, 3).map((run) => (
              <div className="list-row" key={run.id}>
                <div>
                  <strong>
                    {run.strategyVersion.strategy.name} v{run.strategyVersion.version}
                  </strong>
                  <small>
                    {run.datasetVersion} · {run._count.trades} trades
                  </small>
                </div>
                <Status value={run.acceptanceStatus} />
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <p className="asof">기준 시각 {formatDate(data.bootstrap.asOf)} · 서버 원장 기준</p>
    </div>
  );
}

function Strategies({ rows, bootstrap, refresh }: { rows: StrategyRow[]; bootstrap: BootstrapData; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(rows[0]?.id);
  const strategy = rows.find((row) => row.id === selected) ?? rows[0];
  const [action, setAction] = useState<ActionConfig | null>(null);
  const [editorVersionId, setEditorVersionId] = useState<string | null>(null);
  const versions = strategy?.versions ?? [];
  return (
    <div className="page-stack">
      <section className="strategy-layout">
        <div className="strategy-list" role="list">
          {rows.map((row) => (
            <button key={row.id} className={strategy?.id === row.id ? 'strategy-select active' : 'strategy-select'} onClick={() => setSelected(row.id)}>
              <span>
                <strong>{row.name}</strong>
                <small>{row.key}</small>
              </span>
              <Status value={row.versions[0]?.status ?? row.status} />
            </button>
          ))}
        </div>
        {strategy ? (
          <div className="strategy-detail">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{strategy.key}</p>
                <h2>{strategy.name}</h2>
                <p>{strategy.description}</p>
              </div>
              <div className="section-actions">
                <span className="scope-badge">
                  KR STOCK · LONG ONLY · {strategy.horizonMinDays}–{strategy.horizonMaxDays}D
                </span>
                <button
                  className="secondary-button"
                  disabled={!bootstrap.mutationsEnabled || versions.length === 0}
                  onClick={() =>
                    setAction({
                      title: '새 DRAFT 생성',
                      description: '현재 최신 버전을 복제해 수정 가능한 새 버전을 만듭니다.',
                      path: `/strategies/${strategy.id}/versions`,
                      scope: 'CONFIG_CHANGE',
                      extra: { parentVersionId: versions[0]?.id },
                    })
                  }
                >
                  새 DRAFT
                </button>
              </div>
            </div>
            <div className="version-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>버전</th>
                    <th>상태</th>
                    <th>룰</th>
                    <th>결정</th>
                    <th>Backtest</th>
                    <th>Config hash</th>
                    <th>다음 단계</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td>
                        <strong>v{version.version}</strong>
                      </td>
                      <td>
                        <Status value={version.status} />
                      </td>
                      <td>{version._count.rules}</td>
                      <td>{version._count.signalDecisions.toLocaleString()}</td>
                      <td>{version._count.aosBacktestRuns}</td>
                      <td>
                        <code title={version.configHash}>{shortHash(version.configHash)}</code>
                      </td>
                      <td>
                        <VersionAction version={version} disabled={!bootstrap.mutationsEnabled} onAction={setAction} onEdit={() => setEditorVersionId(version.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rule-note">
              <strong>변경 규칙</strong>
              <p>DRAFT에서만 설정을 수정하고, validation → backtest → 다른 승인자 → 장후 예약 순으로 이동합니다.</p>
            </div>
          </div>
        ) : (
          <Empty text="등록된 전략이 없습니다." />
        )}
      </section>
      {action && (
        <CommandDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            await refresh();
          }}
        />
      )}
      {editorVersionId && (
        <RuleEditorDialog
          versionId={editorVersionId}
          onClose={() => setEditorVersionId(null)}
          onSuccess={async () => {
            setEditorVersionId(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

interface ActionConfig {
  title: string;
  description: string;
  path: string;
  scope: string;
  extra?: Record<string, unknown>;
  schedule?: boolean;
  method?: 'POST' | 'PATCH';
}
function VersionAction({ version, disabled, onAction, onEdit }: { version: StrategyVersionRow; disabled: boolean; onAction: (action: ActionConfig) => void; onEdit: () => void }) {
  const map: Record<string, ActionConfig> = {
    VALIDATED: {
      title: `v${version.version} Backtest 반영`,
      description: 'PASSED acceptance run이 있을 때만 BACKTESTED로 승격합니다.',
      path: `/strategy-versions/${version.id}/attest-backtest`,
      scope: 'CONFIG_CHANGE',
    },
    BACKTESTED: {
      title: `v${version.version} 승인 요청`,
      description: '작성자와 다른 승인자의 판단을 요청합니다.',
      path: `/strategy-versions/${version.id}/request-approval`,
      scope: 'CONFIG_CHANGE',
    },
    APPROVAL_PENDING: {
      title: `v${version.version} 승인`,
      description: '자기 승인은 차단됩니다. OOS와 MDD 근거를 확인하세요.',
      path: `/strategy-versions/${version.id}/approval`,
      scope: 'APPROVAL',
      extra: { decision: 'APPROVE' },
    },
    APPROVED: {
      title: `v${version.version} 장후 예약`,
      description: 'KRX 거래일 종가 이후 시각만 허용됩니다.',
      path: `/strategy-versions/${version.id}/schedule`,
      scope: 'APPROVAL',
      schedule: true,
    },
  };
  if (version.status === 'DRAFT')
    return (
      <div className="table-actions">
        <button className="table-action" disabled={disabled} onClick={onEdit}>
          룰 편집
        </button>
        <button
          className="table-action"
          disabled={disabled}
          onClick={() =>
            onAction({
              title: `v${version.version} 검증`,
              description: '필수 룰, 투자 범위와 config hash를 검증합니다.',
              path: `/strategy-versions/${version.id}/validate`,
              scope: 'CONFIG_CHANGE',
            })
          }
        >
          검증
        </button>
      </div>
    );
  const action = map[version.status];
  if (!action) return <span className="muted">—</span>;
  return (
    <button className="table-action" disabled={disabled} title={disabled ? '읽기 전용 모드' : undefined} onClick={() => onAction(action)}>
      {action.title.replace(`v${version.version} `, '')}
    </button>
  );
}

function RuleEditorDialog({ versionId, onClose, onSuccess }: { versionId: string; onClose: () => void; onSuccess: () => Promise<void> }) {
  const [detail, setDetail] = useState<StrategyVersionDetail | null>(null);
  const [configText, setConfigText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .strategyVersion(versionId)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setConfigText(JSON.stringify(next.version.configJson, null, 2));
        setRulesText(
          JSON.stringify(
            next.version.rules.map((rule) => ({
              ruleDefinitionId: rule.ruleDefinitionId,
              priority: rule.priority,
              enabled: rule.enabled,
              weight: rule.weight === null ? undefined : Number(rule.weight),
              parametersJson: rule.parametersJson,
            })),
            null,
            2,
          ),
        );
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '버전 상세 조회 실패');
      });
    return () => {
      active = false;
    };
  }, [versionId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const configJson = parseObject(configText, 'Config JSON');
      const rules = parseArray(rulesText, 'Rule JSON');
      await api.command(`/strategy-versions/${versionId}/draft`, 'CONFIG_CHANGE', password, { configJson, rules, reason, correlationId: crypto.randomUUID() }, 'PATCH');
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '룰 저장 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="command-modal rule-editor" role="dialog" aria-modal="true" aria-labelledby="rule-editor-title">
        <p className="eyebrow">DRAFT ONLY · HASHED CONFIG</p>
        <h2 id="rule-editor-title">v{detail?.version.version ?? '…'} 룰 편집</h2>
        <p>Rule 구현 코드는 바꾸지 않습니다. 활성 룰의 파라미터와 weight만 새 config hash로 저장합니다.</p>
        {!detail && !error ? (
          <Loading />
        ) : (
          <form onSubmit={submit}>
            <div className="editor-grid">
              <label>
                Strategy config JSON
                <textarea className="code-input" value={configText} onChange={(event) => setConfigText(event.target.value)} required rows={14} spellCheck={false} />
              </label>
              <label>
                Version rules JSON
                <textarea className="code-input" value={rulesText} onChange={(event) => setRulesText(event.target.value)} required rows={14} spellCheck={false} />
              </label>
            </div>
            <label>
              변경 사유
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required rows={2} />
            </label>
            <label>
              비밀번호 재확인
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="current-password" />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={onClose}>
                취소
              </button>
              <button className="primary-button" disabled={busy || !detail}>
                {busy ? '검증·저장 중…' : '새 hash로 저장'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Backtests({ rows }: { rows: BacktestRow[] }) {
  return (
    <div className="page-stack">
      <section className="metric-grid three">
        <Metric label="Acceptance 통과" value={rows.filter((r) => r.acceptanceStatus === 'PASSED').length} hint={`전체 ${rows.length} runs`} tone="good" />
        <Metric label="승격 차단" value={rows.filter((r) => r.acceptanceStatus === 'FAILED').length} hint="재검증 필요" tone="bad" />
        <Metric label="총 거래 표본" value={rows.reduce((sum, r) => sum + r._count.trades, 0).toLocaleString()} hint="immutable runs" tone="neutral" />
      </section>
      <section className="card-grid">
        {rows.map((run) => {
          const metrics = run.metricsJson;
          return (
            <article className="backtest-card" key={run.id}>
              <div className="card-head">
                <div>
                  <p className="eyebrow">
                    v{run.strategyVersion.version} · {run.datasetVersion}
                  </p>
                  <h3>{run.strategyVersion.strategy.name}</h3>
                </div>
                <Status value={run.acceptanceStatus} />
              </div>
              <div className="metric-strip">
                <SmallMetric label="CAGR" value={percent(metrics.cagrPct)} />
                <SmallMetric label="MDD" value={percent(metrics.mddPct)} />
                <SmallMetric label="Sharpe" value={String(metrics.sharpe ?? '—')} />
                <SmallMetric label="승률" value={percent(metrics.winRatePct)} />
              </div>
              <div className="criteria">
                {run.acceptance.map((criterion) => (
                  <span key={criterion.criterionKey} className={criterion.passed ? 'pass' : 'fail'}>
                    {criterion.passed ? '✓' : '×'} {criterion.criterionKey.replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
              <footer>
                <span>
                  {formatDate(run.startDate, false)}–{formatDate(run.endDate, false)}
                </span>
                <strong>{run._count.trades} trades</strong>
              </footer>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Shadow({ data, bootstrap, refresh }: { data: ShadowData; bootstrap: BootstrapData; refresh: () => Promise<void> }) {
  const [action, setAction] = useState<ActionConfig | null>(null);
  return (
    <div className="page-stack">
      <section className="account-grid">
        {data.accounts.map((account) => (
          <article className="account-card" key={account.id}>
            <div className="card-head">
              <div>
                <p className="eyebrow">{account.accountType}</p>
                <h3>{account.label}</h3>
              </div>
              <Status value={account.status} />
            </div>
            {account.capitalBuckets.map((bucket) => (
              <div className="bucket-row" key={bucket.bucketType}>
                <span>{bucket.bucketType}</span>
                <strong>{Math.round(Number(bucket.targetWeight) * 100)}%</strong>
                <small>{formatMoney(bucket.availableAmount)}</small>
              </div>
            ))}
          </article>
        ))}
      </section>
      <section className="content-grid">
        <Panel title="최근 Order Plan" subtitle="승인 계획 없는 주문은 0건이어야 합니다">
          <div className="compact-list">
            {data.plans.map((plan) => (
              <div className="list-row plan-row" key={plan.id}>
                <div>
                  <strong>
                    {plan.side} {plan.plannedQuantity.toLocaleString()}주 · {formatMoney(plan.plannedPrice)}
                  </strong>
                  <small>
                    {plan.mode} · 유효 {formatDate(plan.expiresAt)}
                  </small>
                </div>
                <div>
                  <Status value={plan.order?.status ?? plan.status} />
                  <code>{shortHash(plan.id)}</code>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="EOD Reconciliation" subtitle="설명되지 않은 차이는 승격을 차단합니다">
          <div className="compact-list">
            {data.reconciliations.map((run) => (
              <div className="list-row" key={run.id}>
                <div>
                  <strong>{run.tradeDate}</strong>
                  <small>{formatDate(run.completedAt)}</small>
                </div>
                <div>
                  <Status value={run.status} />
                  {run.unexplainedBreaks > 0 && <b className="danger-count">{run.unexplainedBreaks}</b>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>
      {data.breaks.length > 0 && (
        <Panel title="열린 원장 차이" subtitle="증거와 운영자 사유 없이 닫을 수 없습니다">
          <div className="break-grid">
            {data.breaks.map((item) => (
              <article className="break-card" key={item.id}>
                <Status value={item.severity} />
                <strong>{item.category}</strong>
                <code>{item.breakKey}</code>
                <small>{formatDate(item.createdAt)}</small>
                <button
                  className="table-action"
                  disabled={!bootstrap.mutationsEnabled}
                  onClick={() =>
                    setAction({
                      title: `${item.breakKey} 설명 기록`,
                      description: '원장 증거를 확인한 뒤 운영자 사유와 개입 기록을 남깁니다.',
                      path: `/reconciliation-breaks/${item.id}/resolve`,
                      scope: 'RECONCILIATION',
                      extra: {
                        resolution: 'EXPLAINED',
                        reasonCode: 'OPERATOR_EVIDENCE_REVIEW',
                      },
                    })
                  }
                >
                  증거 확인 완료
                </button>
              </article>
            ))}
          </div>
        </Panel>
      )}
      {action && (
        <CommandDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Allocation({ data, bootstrap, refresh }: { data: AllocationData; bootstrap: BootstrapData; refresh: () => Promise<void> }) {
  const [action, setAction] = useState<ActionConfig | null>(null);
  const [policyEditor, setPolicyEditor] = useState(false);
  const [planEditor, setPlanEditor] = useState<AllocationPlanRow | null | undefined>(undefined);
  const active = data.policies.find((policy) => policy.status === 'ACTIVE');
  const canWrite = bootstrap.mutationsEnabled && bootstrap.operator.permissions.includes('CONFIG_WRITE');
  const canApprove = bootstrap.mutationsEnabled && bootstrap.operator.permissions.includes('CONFIG_APPROVE');
  const totalApproved = data.plans.filter((plan) => plan.status === 'APPROVED').reduce((sum, plan) => sum + Number(plan.distributableProfit), 0);
  return (
    <div className="page-stack">
      <section className="allocation-hero">
        <div>
          <p className="eyebrow">REALIZED PROFIT · PLAN ONLY</p>
          <h2>
            확정이익만 50 · 30 · 20으로
            <br />
            분리 계획합니다.
          </h2>
          <p>손실이나 0원은 계획을 만들지 않습니다. 승인 후에도 송금·환전·매수는 자동 실행되지 않습니다.</p>
        </div>
        <div className="allocation-ring" aria-label="SPGI 50%, VTI 30%, 시스템 트레이딩 20%">
          <span>50</span>
          <span>30</span>
          <span>20</span>
          <b>
            KRW
            <br />
            PLAN
          </b>
        </div>
      </section>
      <section className="metric-grid three">
        <Metric label="활성 정책" value={active ? `v${active.version}` : '없음'} hint={active ? shortHash(active.contentHash) : '계획 생성 차단'} tone={active ? 'good' : 'warn'} />
        <Metric label="승인 배분액" value={formatMoney(totalApproved)} hint={`${data.plans.filter((plan) => plan.status === 'APPROVED').length} plans`} tone="neutral" />
        <Metric label="실행 레일" value="OFF" hint="송금 · FX · 주문 없음" tone="good" />
      </section>
      <section className="content-grid allocation-controls">
        <Panel title="정책 버전" subtitle="비율 고정 · 미확정 정책은 JSON으로 명시">
          <div className="section-actions allocation-actions">
            <button className="secondary-button" disabled={!canWrite} onClick={() => setPolicyEditor(true)}>
              새 정책 DRAFT
            </button>
          </div>
          <div className="compact-list">
            {data.policies.map((policy) => (
              <div className="list-row" key={policy.id}>
                <div>
                  <strong>Allocation Policy v{policy.version}</strong>
                  <small>
                    {shortHash(policy.contentHash)} · {formatDate(policy.effectiveFrom ?? policy.createdAt)}
                  </small>
                </div>
                <div>
                  <Status value={policy.status} />
                  {policy.status === 'DRAFT' && (
                    <button
                      className="table-action"
                      disabled={!canApprove}
                      onClick={() =>
                        setAction({
                          title: `정책 v${policy.version} 장후 활성화`,
                          description: '작성자와 다른 승인자만 KRX 종가 이후 활성화할 수 있습니다.',
                          path: `/allocation/policies/${policy.id}/activate`,
                          scope: 'APPROVAL',
                        })
                      }
                    >
                      장후 승인
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="계획 생성 조건" subtitle="수치를 자동 추정하지 않습니다">
          <div className="guard-list">
            <div>
              <strong>1</strong>
              <span>확정 손익 기간과 증거를 입력</span>
            </div>
            <div>
              <strong>2</strong>
              <span>세금·FX 유보액을 명시</span>
            </div>
            <div>
              <strong>3</strong>
              <span>다른 승인자가 원장 대사</span>
            </div>
            <div>
              <strong>4</strong>
              <span>실행은 외부에서 별도 처리</span>
            </div>
          </div>
          <button className="primary-button full-button" disabled={!canWrite || !active || data.accounts.length === 0} onClick={() => setPlanEditor(null)}>
            확정이익 배분 계획 만들기
          </button>
        </Panel>
      </section>
      <section className="allocation-plan-grid">
        {data.plans.map((plan) => (
          <article className="allocation-plan-card" key={plan.id}>
            <div className="card-head">
              <div>
                <p className="eyebrow">
                  {plan.tradingAccount.label} · REV {plan.revision}
                </p>
                <h3>
                  {formatDate(plan.periodStart, false)}–{formatDate(plan.periodEnd, false)}
                </h3>
              </div>
              <Status value={plan.status} />
            </div>
            <div className="profit-waterfall">
              <div>
                <span>확정이익</span>
                <strong>{formatMoney(plan.grossRealizedProfit)}</strong>
              </div>
              <i>−</i>
              <div>
                <span>세금·FX 유보</span>
                <strong>{formatMoney(Number(plan.taxReserveAmount) + Number(plan.fxReserveAmount))}</strong>
              </div>
              <i>=</i>
              <div>
                <span>배분 가능</span>
                <strong>{formatMoney(plan.distributableProfit)}</strong>
              </div>
            </div>
            <div className="allocation-item-grid">
              {[...plan.items]
                .sort((left, right) => allocationRank(left.destination) - allocationRank(right.destination))
                .map((item) => (
                  <div key={item.destination}>
                    <span>
                      {allocationLabel(item.destination)} · {Math.round(Number(item.weight) * 100)}%
                    </span>
                    <strong>{formatMoney(item.amount)}</strong>
                  </div>
                ))}
            </div>
            <footer className="plan-footer">
              <div>
                <code title={plan.planHash}>{shortHash(plan.planHash)}</code>
                <small>
                  Policy v{plan.allocationPolicy.version} · 원장 {plan.ledger.length}건
                </small>
              </div>
              <div className="table-actions">
                {plan.status === 'DRAFT' && (
                  <button
                    className="table-action"
                    disabled={!canApprove}
                    onClick={() =>
                      setAction({
                        title: '배분 계획 승인',
                        description: '원천 증거와 세금·FX 유보액을 대사합니다. 실제 자금 이동은 없습니다.',
                        path: `/allocation/plans/${plan.id}/approve`,
                        scope: 'APPROVAL',
                      })
                    }
                  >
                    승인
                  </button>
                )}
                {plan.status !== 'CANCELLED' && (
                  <button
                    className="table-action"
                    disabled={!canApprove}
                    onClick={() =>
                      setAction({
                        title: '배분 계획 취소',
                        description: '계획 상태만 취소하고 감사 원장은 보존합니다.',
                        path: `/allocation/plans/${plan.id}/cancel`,
                        scope: 'APPROVAL',
                      })
                    }
                  >
                    취소
                  </button>
                )}
                {plan.status === 'CANCELLED' && (
                  <button className="table-action" disabled={!canWrite} onClick={() => setPlanEditor(plan)}>
                    재발행
                  </button>
                )}
              </div>
            </footer>
          </article>
        ))}
      </section>
      {data.plans.length === 0 && <Empty text="확정이익 배분 계획이 아직 없습니다." />}
      {action && (
        <CommandDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            await refresh();
          }}
        />
      )}
      {policyEditor && (
        <AllocationPolicyDialog
          onClose={() => setPolicyEditor(false)}
          onSuccess={async () => {
            setPolicyEditor(false);
            await refresh();
          }}
        />
      )}
      {planEditor !== undefined && (
        <AllocationPlanDialog
          accounts={data.accounts}
          reissue={planEditor}
          onClose={() => setPlanEditor(undefined)}
          onSuccess={async () => {
            setPlanEditor(undefined);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function AllocationPolicyDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const initial = JSON.stringify({ status: 'OPEN_QUESTION', value: null, note: '운영 확정 필요' }, null, 2);
  const [period, setPeriod] = useState(initial);
  const [tax, setTax] = useState(JSON.stringify({ status: 'EXPLICIT_PER_PLAN' }, null, 2));
  const [fx, setFx] = useState(JSON.stringify({ status: 'PLANNING_ONLY', executionEnabled: false }, null, 2));
  const [minimum, setMinimum] = useState(initial);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.command('/allocation/policies', 'CONFIG_CHANGE', password, {
        profitPeriodPolicyJson: parseObject(period, '정산 주기'),
        taxReservePolicyJson: parseObject(tax, '세금 정책'),
        fxPolicyJson: parseObject(fx, 'FX 정책'),
        minimumAmountPolicyJson: parseObject(minimum, '최소금액 정책'),
        reason,
        correlationId: crypto.randomUUID(),
      });
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '정책 생성 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="command-modal rule-editor" role="dialog" aria-modal="true" aria-labelledby="policy-title">
        <p className="eyebrow">FIXED WEIGHTS · VERSIONED PLACEHOLDERS</p>
        <h2 id="policy-title">50 · 30 · 20 정책 DRAFT</h2>
        <p>
          비율은 고정입니다. 아직 확정되지 않은 운영 기준을 임의 숫자로 채우지 말고 <code>OPEN_QUESTION</code>으로 남기세요.
        </p>
        <form onSubmit={submit}>
          <div className="editor-grid">
            <JsonField label="확정이익 정산 주기" value={period} setValue={setPeriod} />
            <JsonField label="세금 유보 정책" value={tax} setValue={setTax} />
            <JsonField label="FX 정책" value={fx} setValue={setFx} />
            <JsonField label="최소금액 정책" value={minimum} setValue={setMinimum} />
          </div>
          <label>
            생성 사유
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required rows={2} />
          </label>
          <label>
            비밀번호 재확인
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="current-password" />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              취소
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? '원장 기록 중…' : 'DRAFT 생성'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AllocationPlanDialog({ accounts, reissue, onClose, onSuccess }: { accounts: AllocationData['accounts']; reissue: AllocationPlanRow | null; onClose: () => void; onSuccess: () => Promise<void> }) {
  const [accountId, setAccountId] = useState(reissue?.tradingAccountId ?? accounts[0]?.id ?? '');
  const [periodStart, setPeriodStart] = useState(toDateInput(reissue?.periodStart));
  const [periodEnd, setPeriodEnd] = useState(toDateInput(reissue?.periodEnd));
  const [gross, setGross] = useState(reissue ? String(Math.trunc(Number(reissue.grossRealizedProfit))) : '');
  const [tax, setTax] = useState(reissue ? String(Math.trunc(Number(reissue.taxReserveAmount))) : '0');
  const [fx, setFx] = useState(reissue ? String(Math.trunc(Number(reissue.fxReserveAmount))) : '0');
  const [evidence, setEvidence] = useState(
    JSON.stringify(
      reissue?.sourceEvidenceJson ?? {
        source: 'PERIOD_CLOSE',
        reconciliationRunId: null,
        note: '',
      },
      null,
      2,
    ),
  );
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const distributable = Number(gross || 0) - Number(tax || 0) - Number(fx || 0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        tradingAccountId: accountId,
        periodStart: new Date(`${periodStart}T00:00:00+09:00`).toISOString(),
        periodEnd: new Date(`${periodEnd}T23:59:59+09:00`).toISOString(),
        grossRealizedProfitKrw: Number(gross),
        taxReserveKrw: Number(tax),
        fxReserveKrw: Number(fx),
        sourceEvidenceJson: parseObject(evidence, '원천 증거'),
        reason,
        correlationId: crypto.randomUUID(),
      };
      await api.command(reissue ? `/allocation/plans/${reissue.id}/reissue` : '/allocation/plans', 'CONFIG_CHANGE', password, payload);
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계획 생성 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="command-modal" role="dialog" aria-modal="true" aria-labelledby="allocation-plan-title">
        <p className="eyebrow">{reissue ? `REISSUE · REV ${reissue.revision + 1}` : 'PERIOD CLOSE · WHOLE KRW'}</p>
        <h2 id="allocation-plan-title">확정이익 배분 계획</h2>
        <p>확정이익과 유보액은 자동 추정하지 않습니다. 이 화면은 계획만 기록하며 자금을 옮기지 않습니다.</p>
        <form onSubmit={submit}>
          <label>
            시스템 트레이딩 계정
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={!!reissue} required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} · {shortHash(account.id)}
                </option>
              ))}
            </select>
          </label>
          <div className="field-grid">
            <label>
              기간 시작
              <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={!!reissue} required />
            </label>
            <label>
              기간 종료
              <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={!!reissue} required />
            </label>
          </div>
          <div className="field-grid three-fields">
            <label>
              확정이익 (원)
              <input type="number" min="1" step="1" value={gross} onChange={(event) => setGross(event.target.value)} required />
            </label>
            <label>
              세금 유보 (원)
              <input type="number" min="0" step="1" value={tax} onChange={(event) => setTax(event.target.value)} required />
            </label>
            <label>
              FX 유보 (원)
              <input type="number" min="0" step="1" value={fx} onChange={(event) => setFx(event.target.value)} required />
            </label>
          </div>
          <div className={`distribution-preview ${distributable <= 0 ? 'invalid' : ''}`}>
            <span>배분 가능액</span>
            <strong>{formatMoney(distributable)}</strong>
            <small>
              SPGI {formatMoney(Math.floor(distributable * 0.5))} · VTI {formatMoney(Math.floor(distributable * 0.3))} · System 잔여
            </small>
          </div>
          <label>
            원천 증거 JSON
            <textarea className="code-input" value={evidence} onChange={(event) => setEvidence(event.target.value)} required rows={5} spellCheck={false} />
          </label>
          <label>
            계획 사유
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required rows={2} />
          </label>
          <label>
            비밀번호 재확인
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="current-password" />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              취소
            </button>
            <button className="primary-button" disabled={busy || distributable <= 0}>
              {busy ? 'hash 계산 중…' : reissue ? '새 revision 발행' : 'DRAFT 계획 생성'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function JsonField({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea className="code-input" value={value} onChange={(event) => setValue(event.target.value)} required rows={5} spellCheck={false} />
    </label>
  );
}
function allocationLabel(value: string): string {
  return value === 'SYSTEM_TRADING' ? '시스템 자금' : value;
}
function allocationRank(value: string): number {
  return value === 'SPGI' ? 0 : value === 'VTI' ? 1 : 2;
}
function toDateInput(value?: string): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function Audit({ data }: { data: AuditData }) {
  const events = useMemo(() => [...tagAudit(data.commands, 'COMMAND'), ...tagAudit(data.approvals, 'APPROVAL'), ...tagAudit(data.interventions, 'INTERVENTION'), ...tagAudit(data.killEvents, 'KILL'), ...tagAudit(data.configEvents, 'CONFIG')].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [data]);
  const [decisionId, setDecisionId] = useState('');
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null);
  const [replayError, setReplayError] = useState('');
  const submitReplay = async (event: FormEvent) => {
    event.preventDefault();
    setReplayError('');
    try {
      setReplay(await api.replayDecision(decisionId.trim()));
    } catch (cause) {
      setReplayError(cause instanceof Error ? cause.message : '결정 재생 실패');
    }
  };
  return (
    <div className="page-stack">
      <Panel title="결정 리플레이" subtitle="SignalDecision ID로 Feature·Strategy·Risk·Rule trace를 같은 영수증에서 확인합니다">
        <form className="replay-form" onSubmit={submitReplay}>
          <label>
            Decision ID
            <input value={decisionId} onChange={(event) => setDecisionId(event.target.value)} required placeholder="SignalDecision ID" />
          </label>
          <button className="secondary-button">재생</button>
        </form>
        {replayError && (
          <p className="form-error" role="alert">
            {replayError}
          </p>
        )}
        {replay && <pre className="replay-result">{JSON.stringify(replay, null, 2)}</pre>}
      </Panel>
      <Panel title="Append-only 감사 타임라인" subtitle="명령 · 승인 · 개입 · 구성 변경을 같은 시간축에서 봅니다">
        <div className="timeline">
          {events.map((event, index) => (
            <article key={`${String(event.id)}-${index}`}>
              <span className={`timeline-dot tone-${statusTone(String(event.status ?? event.decision ?? event.action ?? ''))}`} />
              <div>
                <div className="timeline-title">
                  <Status value={String(event.lane)} />
                  <strong>{String(event.commandType ?? event.action ?? event.decision ?? event.type ?? event.command ?? 'EVENT')}</strong>
                </div>
                <p>{String(event.reason ?? event.reasonText ?? '기록된 사유 없음')}</p>
                <small>
                  {String(event.targetType ?? event.subjectType ?? event.scope ?? '')} · {shortHash(event.targetId ?? event.subjectId ?? event.id)} · {formatDate(event.createdAt)}
                </small>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function tagAudit(rows: Record<string, unknown>[], lane: string): Array<Record<string, unknown> & { lane: string }> {
  return rows.map((row) => ({ ...row, lane }));
}

function Health({ rows }: { rows: HealthRow[] }) {
  const grouped = new Map<string, HealthRow>();
  rows.forEach((row) => {
    if (!grouped.has(row.jobKey)) grouped.set(row.jobKey, row);
  });
  return (
    <div className="page-stack">
      <section className="metric-grid three">
        <Metric label="최근 관측 Worker" value={grouped.size} hint="jobKey 기준" tone="neutral" />
        <Metric label="실패" value={[...grouped.values()].filter((r) => r.status === 'FAILED').length} hint="최근 실행" tone={[...grouped.values()].some((r) => r.status === 'FAILED') ? 'bad' : 'good'} />
        <Metric label="진행 중" value={[...grouped.values()].filter((r) => r.status === 'RUNNING').length} hint="중복 실행 확인" tone="warn" />
      </section>
      <Panel title="Worker 최신 상태" subtitle="오래된 성공은 정상으로 보지 않습니다">
        <div className="health-grid">
          {[...grouped.values()].map((row) => (
            <article key={row.id}>
              <div>
                <span className={`health-light tone-${statusTone(row.status)}`} />
                <strong>{row.jobKey}</strong>
              </div>
              <Status value={row.status} />
              <small>{formatDate(row.finishedAt ?? row.startedAt)}</small>
              {row.errorMessage && <p>{row.errorMessage}</p>}
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Emergency({ bootstrap, refresh }: { bootstrap: BootstrapData; refresh: () => Promise<void> }) {
  const [action, setAction] = useState<ActionConfig | null>(null);
  const latest = bootstrap.killSwitch;
  return (
    <div className="page-stack">
      <section className="emergency-hero">
        <div>
          <p className="eyebrow">EMERGENCY CONTROL</p>
          <h2>
            발동은 즉시,
            <br />
            해제는 자동으로 하지 않습니다.
          </h2>
          <p>신규 진입을 즉시 차단합니다. 손절·추적손절과 이미 승인된 비상 규칙은 별도 정책을 따릅니다.</p>
        </div>
        <div className="kill-state">
          <span className="pulse-ring" />
          <p>최근 AOS 명령</p>
          <strong>{String(latest?.command ?? '기록 없음')}</strong>
          <small>{formatDate(latest?.requestedAt)}</small>
        </div>
      </section>
      <section className="emergency-actions">
        <article>
          <h3>신규 진입 전체 중단</h3>
          <p>Legacy KillSwitch와 AOS 사건 원장에 동시에 남깁니다.</p>
          <button
            className="danger-button"
            disabled={!bootstrap.mutationsEnabled}
            onClick={() =>
              setAction({
                title: 'Kill Switch 발동',
                description: '모든 신규 진입을 즉시 차단합니다. 자동 해제되지 않습니다.',
                path: '/emergency/kill-switch',
                scope: 'EMERGENCY_CONTROL',
                extra: {
                  command: 'ACTIVATE',
                  scope: 'NEW_ENTRY',
                  mode: 'FULL_HALT',
                },
              })
            }
          >
            FULL HALT 발동
          </button>
        </article>
        <article>
          <h3>해제 검토 요청</h3>
          <p>요청만 기록합니다. 실제 Kill Switch 상태는 바꾸지 않습니다.</p>
          <button
            className="secondary-button"
            disabled={!bootstrap.mutationsEnabled}
            onClick={() =>
              setAction({
                title: 'Kill Switch 해제 검토',
                description: '자동 해제하지 않고 운영 원장에 검토 요청을 남깁니다.',
                path: '/emergency/kill-switch',
                scope: 'EMERGENCY_CONTROL',
                extra: {
                  command: 'DEACTIVATE_REQUEST',
                  scope: 'NEW_ENTRY',
                  mode: 'FULL_HALT',
                },
              })
            }
          >
            해제 검토 요청
          </button>
        </article>
      </section>
      <div className="safety-checklist">
        <strong>발동 전 확인</strong>
        <span>① 데이터 장애인지</span>
        <span>② 원장 차이가 있는지</span>
        <span>③ 신규 진입만 중단해도 되는지</span>
        <span>④ 복구 책임자가 지정됐는지</span>
      </div>
      {action && (
        <CommandDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function CommandDialog({ action, onClose, onSuccess }: { action: ActionConfig; onClose: () => void; onSuccess: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const schedulePayload = action.schedule ? { scheduledFor: new Date(scheduledFor).toISOString() } : {};
      await api.command(
        action.path,
        action.scope,
        password,
        {
          reason,
          correlationId: crypto.randomUUID(),
          ...action.extra,
          ...schedulePayload,
        },
        action.method,
      );
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '명령 실패');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="command-modal" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <p className="eyebrow">SINGLE-USE STEP-UP</p>
        <h2 id="command-title">{action.title}</h2>
        <p>{action.description}</p>
        <form onSubmit={submit}>
          {action.schedule && (
            <label>
              활성화 예약 시각
              <input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} required />
              <small>KRX 거래일 15:30 이후만 서버가 허용합니다.</small>
            </label>
          )}
          <label>
            변경 사유
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} required rows={3} placeholder="무엇을 왜 변경하는지 구체적으로 기록" />
          </label>
          <label>
            비밀번호 재확인
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="current-password" />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              취소
            </button>
            <button className={action.scope === 'EMERGENCY_CONTROL' ? 'danger-button' : 'primary-button'} disabled={busy}>
              {busy ? '영수증 기록 중…' : '확인하고 실행'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint: string; tone: string }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}
function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return <span className={`status-pill ${statusTone(value)}`}>{value.replaceAll('_', ' ')}</span>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>표시할 내용이 없습니다.</strong>
      <p>{text}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading-state" aria-live="polite">
      <span />
      <p>운영 원장을 확인하고 있습니다.</p>
    </div>
  );
}
function percent(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '—';
}
function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}은 object여야 합니다.`);
  return parsed as Record<string, unknown>;
}
function parseArray(value: string, label: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label}은 array여야 합니다.`);
  return parsed;
}
