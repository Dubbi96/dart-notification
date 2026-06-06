/**
 * 매매 사유 추적 + 성적표 집계 — 순수 함수 (M10 모의운용, DAR-64)
 *
 * 모의 포지션의 "왜 진입했고 왜 청산했는지" 근거를 기존 저장 데이터에서 추출하고,
 * 청산 완료(CLOSED) 포지션을 매매 성적표(승률·평균손익·평균보유기간·누적수익률)로 집계한다.
 *
 * ★ 순수 산술/매핑만 — 신규 수집·외부호출·AI 개입 0. 기존 Position·PositionThesis·ExitSignal
 *   에 이미 저장된 값만 조합한다. I/O 는 service 가 담당하고 여기서는 받은 값만 변환.
 */

/** 표본이 이 수 미만이면 '데이터 한계' 배지로 과신을 방지한다(정직 표기). */
export const LOW_SAMPLE_THRESHOLD = 5;

/** service 가 Prisma 에서 읽어 넘기는 포지션 1행(사유 추적에 필요한 부분만) */
export interface TradeRationaleInput {
  positionId: string;
  corpCode: string;
  stockCode: string;
  /** 회사명(없으면 null → 종목코드 대체 표시) */
  corpName: string | null;
  /** 'OPEN' | 'CLOSED' */
  status: string;
  entryDate: Date;
  entryPrice: number;
  quantity: number;
  closedAt: Date | null;
  /** OPEN=평가손익, CLOSED=실현손익(원) */
  pnl: number | null;
  /** OPEN=평가손익률, CLOSED=실현수익률(%) */
  pnlPct: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxHoldDays: number | null;
  /** PositionThesis.entryReason (한 문장 진입 사유) */
  entryReason: string | null;
  /** PositionThesis.initialThesis (근거 항목 배열) — Json 원본 */
  initialThesis: unknown;
  /** 해당 포지션을 청산시킨 ExitSignal.exitAction (없으면 null) */
  exitAction: string | null;
  /** ExitSignal.triggerTypes (청산 트리거 enum 값 배열) */
  exitTriggers: string[];
  /** 진입 신호의 eventType (PositionThesis→TradingSignal, 없으면 null) — DAR-73 차원 추가 */
  eventType?: string | null;
  /** 진입 신호의 등급 SignalGrade (없으면 null) — DAR-73 차원 추가 */
  signalGrade?: string | null;
}

/** 모바일 매매 사유 카드 1행 */
export interface TradeRationale {
  positionId: string;
  corpCode: string;
  stockCode: string;
  corpName: string | null;
  status: 'OPEN' | 'CLOSED';
  /** 진입일 ISO */
  entryDate: string;
  entryPrice: number;
  quantity: number;
  /** 청산일 ISO (OPEN 이면 null) */
  exitDate: string | null;
  /** 손익(원) — OPEN=평가, CLOSED=실현 */
  pnl: number;
  /** 수익률(%) — OPEN=평가, CLOSED=실현 */
  pnlPct: number;
  /** 보유일수 (CLOSED 이고 두 일자 모두 있으면 계산, 아니면 null) */
  holdDays: number | null;
  /** 진입 사유 한 문장 (없으면 null → UI '근거 기록 없음') */
  entryReason: string | null;
  /** 진입 근거 칩: thesis 근거 + 포지션 룰(손절/익절/최대보유) 조합 */
  entryBasis: string[];
  /** 청산 액션 enum (OPEN 이면 null) */
  exitAction: string | null;
  /** 청산 트리거 enum 배열 (없으면 빈 배열) */
  exitTriggers: string[];
  /** 진입 신호 eventType (없으면 null) — DAR-73 필터/집계 차원 */
  eventType: string | null;
  /** 진입 신호 등급 (없으면 null) — DAR-73 필터/집계 차원 */
  signalGrade: string | null;
}

/** 매매 성적표 — CLOSED 포지션 누적 집계 */
export interface TradeScorecard {
  /** 청산 완료 매매 수 = 표본 수 */
  closedCount: number;
  /** 수익 매매 수 (pnl > 0) */
  winCount: number;
  /** 손실 매매 수 (pnl < 0) */
  lossCount: number;
  /** 승률 (0~1). 표본 0이면 null */
  winRate: number | null;
  /** 평균 실현손익(원). 표본 0이면 0 */
  avgPnl: number;
  /** 평균 실현수익률(%). 표본 0이면 0 */
  avgPnlPct: number;
  /** 평균 보유일수. 산출 가능한 표본 0이면 null */
  avgHoldDays: number | null;
  /** 누적 실현손익(원) */
  totalNetPnl: number;
  /** 누적 수익률(%) = 누적 실현손익 / 초기원금 × 100 */
  cumulativeReturnPct: number;
  /** 표본 수 (closedCount 동의어, UI 명시성) */
  sampleSize: number;
  /** 표본 부족 여부 (LOW_SAMPLE_THRESHOLD 미만) */
  lowSample: boolean;
}

/** Json initialThesis 를 안전하게 string[] 로 정규화 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/** 두 일자 사이의 보유일수(달력 기준, 음수 방지). 둘 중 하나라도 없으면 null */
export function holdDaysBetween(entryDate: Date, closedAt: Date | null): number | null {
  if (!closedAt) return null;
  const ms = closedAt.getTime() - entryDate.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/**
 * 포지션 룰(손절·익절·최대보유) → 근거 칩. thesis 근거가 없어도 '기존 필드 조합'으로
 * 최소한의 추적 가능한 근거를 노출한다(신규 수집 아님 — 이미 저장된 룰 값).
 */
function ruleChips(input: TradeRationaleInput): string[] {
  const chips: string[] = [];
  if (input.stopLossPct != null) chips.push(`손절 -${input.stopLossPct}%`);
  if (input.takeProfitPct != null) chips.push(`익절 +${input.takeProfitPct}%`);
  if (input.maxHoldDays != null) chips.push(`최대보유 ${input.maxHoldDays}일`);
  return chips;
}

/** 포지션 1행 → 매매 사유 카드. thesis 근거 + 룰 칩을 조합 */
export function buildTradeRationale(input: TradeRationaleInput): TradeRationale {
  const status: 'OPEN' | 'CLOSED' = input.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const thesisChips = toStringArray(input.initialThesis);
  // thesis 근거를 우선 노출하고, 중복 없이 룰 칩을 보강.
  const entryBasis = [...thesisChips, ...ruleChips(input).filter((c) => !thesisChips.includes(c))];
  return {
    positionId: input.positionId,
    corpCode: input.corpCode,
    stockCode: input.stockCode,
    corpName: input.corpName,
    status,
    entryDate: input.entryDate.toISOString(),
    entryPrice: input.entryPrice,
    quantity: input.quantity,
    exitDate: status === 'CLOSED' && input.closedAt ? input.closedAt.toISOString() : null,
    pnl: input.pnl ?? 0,
    pnlPct: input.pnlPct ?? 0,
    holdDays: status === 'CLOSED' ? holdDaysBetween(input.entryDate, input.closedAt) : null,
    entryReason: input.entryReason?.trim() ? input.entryReason.trim() : null,
    entryBasis,
    exitAction: status === 'CLOSED' ? input.exitAction : null,
    exitTriggers: status === 'CLOSED' ? input.exitTriggers : [],
    eventType: input.eventType ?? null,
    signalGrade: input.signalGrade ?? null,
  };
}

/** 차원별(eventType / signalGrade) 성적표 한 행 */
export interface DimensionScorecard {
  /** 그룹 키 (eventType 값·등급명·또는 'UNKNOWN') */
  key: string;
  scorecard: TradeScorecard;
}

/** UNKNOWN 키 표기(신호 연결이 없는 포지션) */
export const UNKNOWN_DIMENSION_KEY = 'UNKNOWN';

/**
 * CLOSED 매매를 차원(eventType / signalGrade)별로 묶어 성적표를 집계한다(기존 집계 확장, DAR-73).
 * 각 그룹은 표본<LOW_SAMPLE_THRESHOLD 면 scorecard.lowSample=true 로 과신 방지.
 * @param closed CLOSED TradeRationale 목록
 * @param initialCapital 누적 수익률 분모
 * @param dimension 그룹 기준 차원
 * @returns 표본 많은 그룹 우선 정렬된 차원별 성적표
 */
export function calculateScorecardByDimension(
  closed: TradeRationale[],
  initialCapital: number,
  dimension: 'eventType' | 'signalGrade',
): DimensionScorecard[] {
  const groups = new Map<string, TradeRationale[]>();
  for (const t of closed) {
    const key = (dimension === 'eventType' ? t.eventType : t.signalGrade) ?? UNKNOWN_DIMENSION_KEY;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .map(([key, ts]) => ({ key, scorecard: calculateTradeScorecard(ts, initialCapital) }))
    .sort((a, b) => b.scorecard.closedCount - a.scorecard.closedCount);
}

/**
 * CLOSED 매매 사유 목록 → 성적표 집계.
 * @param closed 청산 완료 TradeRationale 목록
 * @param initialCapital 누적 수익률 분모(초기 가상원금)
 */
export function calculateTradeScorecard(
  closed: TradeRationale[],
  initialCapital: number,
): TradeScorecard {
  const closedCount = closed.length;
  const winCount = closed.filter((t) => t.pnl > 0).length;
  const lossCount = closed.filter((t) => t.pnl < 0).length;
  const totalNetPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const sumPnlPct = closed.reduce((s, t) => s + t.pnlPct, 0);

  const holdSamples = closed.map((t) => t.holdDays).filter((d): d is number => d != null);
  const avgHoldDays =
    holdSamples.length > 0
      ? Math.round((holdSamples.reduce((s, d) => s + d, 0) / holdSamples.length) * 10) / 10
      : null;

  return {
    closedCount,
    winCount,
    lossCount,
    winRate: closedCount > 0 ? winCount / closedCount : null,
    avgPnl: closedCount > 0 ? Math.round(totalNetPnl / closedCount) : 0,
    avgPnlPct: closedCount > 0 ? Math.round((sumPnlPct / closedCount) * 100) / 100 : 0,
    avgHoldDays,
    totalNetPnl: Math.round(totalNetPnl),
    cumulativeReturnPct:
      initialCapital > 0 ? Math.round((totalNetPnl / initialCapital) * 10000) / 100 : 0,
    sampleSize: closedCount,
    lowSample: closedCount < LOW_SAMPLE_THRESHOLD,
  };
}
