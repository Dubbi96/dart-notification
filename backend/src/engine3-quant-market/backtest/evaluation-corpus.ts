/**
 * evaluation-corpus.ts — 공시 평가자료·인과코퍼스 순수 빌더 (DAR-379)
 *
 * 공시 1건마다 [AI/Rule 사전평가(극성·신뢰도·AI분석 유무) + 실제 실현 EventStudy
 * 사후결과(D+5/D+20 누적초과수익·급등/급락 플래그) + 일치/괴리 라벨]을 결합한
 * 라벨 데이터를 만든다. 이벤트유형·버킷(규모)별로 집계해 점수·임계 튜닝의 통계 근거를 노출한다.
 *
 * ★ AI 금지영역 불가침: 이 코퍼스는 **참고 평가자료**일 뿐 주문을 직접 결정하지 않는다.
 *   Buy/Exit Score = Rule(공식), Risk·체결은 Engine5 독립. 코퍼스는 calibration 의 입력 근거.
 *
 * ★ 순수 함수 — I/O·외부호출·AI 개입 0. 결정론적(같은 입력 → 같은 출력). 가중치/임계값 미변경.
 *   사전 극성(predictedPolarity)이 사후 실현 방향(realized AR 부호)을 맞히는지(hitRate)를
 *   표면화해, 이후 EVENT_BASE_SCORES 보정(calibration)의 통계 근거로만 쓴다.
 */

export type CorpusLabel = 'AGREE' | 'DIVERGE' | 'NEUTRAL';

/** 코퍼스 1행 입력 — 서비스가 DisclosureEvent ⨝ DisclosureAnalysis ⨝ EventStudyObservation 조립 */
export interface CorpusRecordInput {
  rcpNo: string;
  corpCode: string;
  eventType: string;
  /** 규모·시장 버킷 키(없으면 eventType 폴백). 관측치(EventStudyObservation.bucketKey) 정합. */
  bucketKey: string;

  // ── 사전평가(AI/Rule) ───────────────────────────────────────
  /** Rule 매핑 + AI 보정 극성: POSITIVE | NEGATIVE | MIXED | UNKNOWN */
  predictedPolarity: string;
  predictedConfidence: number;
  isAiAssisted: boolean;
  /** 이 공시에 존재하는 DisclosureAnalysis(AI 분석) 레코드 수 */
  aiTaskCount: number;
  /** summary 태스크 AI 분석 보유 여부(드레인 커버리지 기준점) */
  hasAiSummary: boolean;

  // ── 사후결과(실현 EventStudy 관측치) ────────────────────────
  /** 실제 D0 날짜(YYYYMMDD). 관측치 미존재 시 null. */
  d0Date: string | null;
  /** D+5 누적 초과수익(%) — 관측치 cumulativeAR.d5. 미존재 null. */
  realizedArD5: number | null;
  /** D+20 누적 초과수익(%) — 관측치 cumulativeAR.d20. 미존재 null. */
  realizedArD20: number | null;
  isUpD5: boolean | null;
  isCrashD5: boolean | null;
  maxDrawdown: number | null;
}

/** 코퍼스 1행 출력 — 입력 + 일치/괴리 라벨(사전 극성 vs 사후 방향). */
export interface CorpusRecord extends CorpusRecordInput {
  /** D+5 실현 방향 대비 사전극성 일치/괴리/중립 */
  labelD5: CorpusLabel;
  /** D+20 실현 방향 대비 사전극성 일치/괴리/중립 */
  labelD20: CorpusLabel;
  /** D+5 실현결과 존재 여부 */
  hasOutcomeD5: boolean;
  /** D+20 실현결과 존재 여부 */
  hasOutcomeD20: boolean;
}

/** 이벤트유형(또는 버킷)별 집계 통계 */
export interface CorpusGroupStats {
  key: string;
  recordCount: number;
  /** AI summary 분석 보유 레코드 수 */
  withAiCount: number;
  /** D+5 실현결과 보유 레코드 수 */
  withOutcomeD5Count: number;
  withOutcomeD20Count: number;
  /** AI 분석 커버리지(%) = withAiCount / recordCount */
  aiCoveragePct: number;
  /** 사후결과 커버리지(%) = withOutcomeD5Count / recordCount */
  outcomeCoverageD5Pct: number;
  // ── 일치/괴리(D+5) ──
  agreeD5: number;
  divergeD5: number;
  neutralD5: number;
  /** 방향 적중률 = agreeD5 / (agreeD5 + divergeD5). 판정대상 0 → null. */
  hitRateD5: number | null;
  hitRateD20: number | null;
  /** 실현결과 보유 레코드의 평균 D+5 AR(%). 표본 0 → null. */
  meanArD5: number | null;
  meanArD20: number | null;
}

/** 코퍼스 종합 리포트 */
export interface EvaluationCorpusReport {
  generatedAtNote: string;
  summary: {
    totalRecords: number;
    distinctEventTypes: number;
    withAiCount: number;
    withOutcomeD5Count: number;
    aiCoveragePct: number;
    outcomeCoverageD5Pct: number;
    agreeD5: number;
    divergeD5: number;
    neutralD5: number;
    hitRateD5: number | null;
    hitRateD20: number | null;
  };
  /** 이벤트유형별 집계(레코드 수 내림차순) */
  byEventType: CorpusGroupStats[];
  /** ★ 참고 평가자료 — 주문 직접결정 금지(AI 금지영역 불가침) */
  disclaimer: string;
}

const CORPUS_DISCLAIMER =
  'CORPUS_REFERENCE_ONLY — AI/Rule 사전평가와 실현결과를 결합한 참고 라벨 데이터. ' +
  'Buy/Exit Score 는 Rule 공식이 산출하고 Risk·체결은 Engine5 독립이다. ' +
  '이 코퍼스는 calibration 통계근거 입력일 뿐 주문을 직접 결정하지 않는다.';

/** 극성 문자열 → 방향 부호(+1/-1/0). MIXED·UNKNOWN·기타 → 0(방향예측 없음). */
export function polarityDirection(polarity: string): -1 | 0 | 1 {
  const p = (polarity ?? '').toUpperCase();
  if (p === 'POSITIVE') return 1;
  if (p === 'NEGATIVE') return -1;
  return 0;
}

/**
 * 사전극성(방향) vs 사후 실현 AR(부호) 일치/괴리 라벨.
 * - 실현결과 없음 → NEUTRAL(판정불가, 과신 방지)
 * - 방향예측 없음(MIXED/UNKNOWN) → NEUTRAL
 * - 실현 AR == 0(정확히) → NEUTRAL
 * - 부호 일치 → AGREE, 불일치 → DIVERGE
 */
export function labelDirection(predictedDir: -1 | 0 | 1, realizedAr: number | null): CorpusLabel {
  if (realizedAr === null || realizedAr === undefined || Number.isNaN(realizedAr)) return 'NEUTRAL';
  if (predictedDir === 0) return 'NEUTRAL';
  const realizedDir = realizedAr > 0 ? 1 : realizedAr < 0 ? -1 : 0;
  if (realizedDir === 0) return 'NEUTRAL';
  return predictedDir === realizedDir ? 'AGREE' : 'DIVERGE';
}

/** 입력 1행 → 라벨 부여 출력 1행 */
export function buildCorpusRecord(input: CorpusRecordInput): CorpusRecord {
  const dir = polarityDirection(input.predictedPolarity);
  return {
    ...input,
    labelD5: labelDirection(dir, input.realizedArD5),
    labelD20: labelDirection(dir, input.realizedArD20),
    hasOutcomeD5: input.realizedArD5 !== null && input.realizedArD5 !== undefined,
    hasOutcomeD20: input.realizedArD20 !== null && input.realizedArD20 !== undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return round2((part / whole) * 100);
}

function hitRate(agree: number, diverge: number): number | null {
  const denom = agree + diverge;
  if (denom <= 0) return null;
  return round2((agree / denom) * 100);
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

function aggregateGroup(key: string, records: CorpusRecord[]): CorpusGroupStats {
  const recordCount = records.length;
  const withAi = records.filter((r) => r.hasAiSummary);
  const withOutcomeD5 = records.filter((r) => r.hasOutcomeD5);
  const withOutcomeD20 = records.filter((r) => r.hasOutcomeD20);

  const agreeD5 = records.filter((r) => r.labelD5 === 'AGREE').length;
  const divergeD5 = records.filter((r) => r.labelD5 === 'DIVERGE').length;
  const neutralD5 = records.filter((r) => r.labelD5 === 'NEUTRAL').length;
  const agreeD20 = records.filter((r) => r.labelD20 === 'AGREE').length;
  const divergeD20 = records.filter((r) => r.labelD20 === 'DIVERGE').length;

  return {
    key,
    recordCount,
    withAiCount: withAi.length,
    withOutcomeD5Count: withOutcomeD5.length,
    withOutcomeD20Count: withOutcomeD20.length,
    aiCoveragePct: pct(withAi.length, recordCount),
    outcomeCoverageD5Pct: pct(withOutcomeD5.length, recordCount),
    agreeD5,
    divergeD5,
    neutralD5,
    hitRateD5: hitRate(agreeD5, divergeD5),
    hitRateD20: hitRate(agreeD20, divergeD20),
    meanArD5: meanOf(withOutcomeD5.map((r) => r.realizedArD5 as number)),
    meanArD20: meanOf(withOutcomeD20.map((r) => r.realizedArD20 as number)),
  };
}

/**
 * 코퍼스 레코드 배열 → 종합 리포트(이벤트유형별 집계 + 전체 요약).
 * 결정론적: 같은 입력은 같은 출력. byEventType 은 레코드 수 내림차순(동률은 key 사전순).
 */
export function buildEvaluationCorpusReport(records: CorpusRecord[]): EvaluationCorpusReport {
  const byType = new Map<string, CorpusRecord[]>();
  for (const r of records) {
    const list = byType.get(r.eventType) ?? [];
    list.push(r);
    byType.set(r.eventType, list);
  }

  const byEventType = Array.from(byType.entries())
    .map(([key, list]) => aggregateGroup(key, list))
    .sort((a, b) => b.recordCount - a.recordCount || a.key.localeCompare(b.key));

  const overall = aggregateGroup('__ALL__', records);

  return {
    generatedAtNote: 'point-in-time 코퍼스: 호출 시점의 관측치·AI분석 기준 스냅샷(저장 없음)',
    summary: {
      totalRecords: records.length,
      distinctEventTypes: byType.size,
      withAiCount: overall.withAiCount,
      withOutcomeD5Count: overall.withOutcomeD5Count,
      aiCoveragePct: overall.aiCoveragePct,
      outcomeCoverageD5Pct: overall.outcomeCoverageD5Pct,
      agreeD5: overall.agreeD5,
      divergeD5: overall.divergeD5,
      neutralD5: overall.neutralD5,
      hitRateD5: overall.hitRateD5,
      hitRateD20: overall.hitRateD20,
    },
    byEventType,
    disclaimer: CORPUS_DISCLAIMER,
  };
}
