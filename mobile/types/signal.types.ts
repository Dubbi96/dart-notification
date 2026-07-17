// 신호(매수/매도) 도메인 타입 계약 — 백엔드 Engine3(신호) API DTO 기준.
// ⚠️ 매수/매도 신호 엔드포인트는 아직 미존재(DAR-22). 이 계약은 화면/서비스가
// 의존하는 형태를 고정하고, 실제 응답이 생기면 그대로 연동된다.

// 백엔드 SignalGrade enum 6단계와 1:1 대응(DAR-46). NEUTRAL/AVOID를 WATCH로 합치지 않는다.
export type SignalGrade =
  | 'STRONG_BUY'
  | 'BUY'
  | 'WATCH'
  | 'NEUTRAL'
  | 'AVOID'
  | 'BLOCKED';

/** 신호 정렬(DAR-46): 점수 내림차순 / 최신순 */
export type SignalSort = 'score' | 'latest';

/**
 * '왜 강한 신호가 아닌지' 억제 사유 enum(DAR-323) — 백엔드 buy-signal 도출값과 1:1.
 * BUY 이상·BLOCKED 는 백엔드가 null → undefined 로 미노출(배지 미표시).
 * 표시 라벨은 utils/suppressionReasonLabel.ts 가 소유(DAR-306/313/314 라벨맵 패턴).
 */
export type SuppressionReason =
  | 'EVENT_STUDY_DARK'
  | 'INDICATORS_MISSING'
  | 'UNMODELED_EVENT'
  | 'NO_POLARITY'
  | 'GENUINELY_NEUTRAL';

export type ExitAction = 'HOLD' | 'WATCH' | 'REDUCE' | 'EXIT' | 'BLOCK_REBUY';

/** 진입 조건(필수/선택, 충족 여부) */
export interface EntryCondition {
  id: string;
  label: string;
  required: boolean;
  met: boolean;
}

/** 리스크 플래그 */
export interface RiskFlag {
  id: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  /** 위험 맥락 고지 매핑 키(§6, copy.ts RISK_CONTEXT_NOTE). 백엔드 제공 시 면책 contextNotes로 승격 */
  key?: string;
}

/** Buy Score 구성 항목(상세 화면용, Phase B) */
export interface BuyScoreComponent {
  key: string;
  label: string;
  score: number;
  max: number;
  /**
   * 통계 근거 항목의 표본수(n). ScoreBreakdownSection이 'n=N건'으로 신뢰도를 동반 노출.
   * 백엔드(engine3 scoreBreakdown)가 표본수를 실으면 채워지며, 미존재 시 undefined(미표시).
   */
  sampleN?: number;
  /**
   * 표본 스코프 라벨(예: '전체시장') — 백엔드가 후속으로 실을 예정인 옵셔널 필드(방어적 지원).
   * 존재 시 화면은 '표본 1,871건 · 대규모 공급계약(전체시장)' 형식으로 병기하고
   * (이벤트 라벨은 utils/disclosureType EVENT_TYPE_LABEL 재사용), 미존재 시 '표본 N건' 유지.
   */
  sampleScope?: string;
}

/**
 * W13 '근거 지표 펼치기' — 스코어링이 실제 소비한 TechnicalIndicator 원시 수치 스냅샷.
 * 백엔드 SignalEvidenceIndicators 와 1:1. nullable 필드는 화면에서 '—' 처리(빈 값 노출 방지).
 */
export interface SignalEvidenceIndicators {
  /** 지표 기준 거래일(YYYYMMDD) — 신호 생성 시점 이전 최신 지표 행. */
  tradeDate: string;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  bollingerMid: number | null;
  volumeRatio20: number | null;
  /** 공시 전 선행상승률 D-5~D-1 (%). */
  preDsclReturn: number | null;
}

/** 매수 신호 */
export interface TradingSignal {
  id: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 공시 이벤트 종류 (예: 공급계약) */
  eventType?: string;
  grade: SignalGrade;
  /** 0~100 */
  buyScore: number;
  /** AI 매수 근거 요약 텍스트 */
  summary?: string;
  entryConditions: EntryCondition[];
  riskFlags: RiskFlag[];
  /** BLOCKED 신호의 차단 사유 */
  blockedReason?: string;
  /**
   * DAR-323: '왜 강한 신호가 아닌지' 억제 사유 enum. BUY 이상·BLOCKED 는 미존재(undefined).
   * 존재 시 신호 상세에서 '근거 부족'/'정직하게 약함'을 구분하는 배지로 노출.
   */
  suppressionReason?: SuppressionReason;
  scoreBreakdown?: BuyScoreComponent[];
  /**
   * W13: 스코어링이 소비한 원시 지표 스냅샷(read-only) — 상세 응답에만 존재.
   * 미적재/미지원(구 서버)이면 null/undefined → '근거 지표' 섹션 미표시(graceful).
   */
  evidenceIndicators?: SignalEvidenceIndicators | null;
  relatedDisclosureRcpNo?: string;
  /**
   * 공시 접수일(YYYYMMDD 또는 YYYYMMDDHHmmss) — 일일 에디션(GET /signals/daily/:date) item 에만 존재.
   * 귀속일 정직화 근거(발행일 createdAt ↔ 실제 공시 접수일 간극 = 지연배지 판정). 그 외 응답엔 미포함.
   */
  rcpDt?: string;
  /** ISO 8601 — 신호 만료 시각 */
  expiresAt?: string;
  /** ISO 8601 — 공시 발생/신호 생성 시각 */
  createdAt: string;
}

/** 매도 근거(아이콘 색상 매핑용 kind) */
export interface ExitReason {
  id: string;
  label: string;
  kind: 'loss' | 'thesis' | 'chart' | 'time';
}

/** 매도 신호 */
export interface ExitSignal {
  id: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 0~100 */
  exitScore: number;
  action: ExitAction;
  reasons: ExitReason[];
  /** 권장 액션 텍스트 (예: 50% 분할 매도) */
  recommendedAction?: string;
  /** 현재 손익률(%) */
  pnlPercent?: number;
  /** 재매수 차단 여부 */
  blockRebuy?: boolean;
  createdAt: string;
}

/**
 * 종목별 최신 신호 단건(DAR-159) — 종목 상세 신호 배지용 경량 응답.
 * 백엔드 GET /signals/by-corp/:corpCode 의 data(없으면 null).
 */
export interface CompanySignalBadge {
  id: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  eventType?: string;
  grade: SignalGrade;
  /** 0~100 */
  buyScore: number;
  /** 진입 준비 여부 */
  entryReady: boolean;
  summary?: string;
  relatedDisclosureRcpNo?: string;
  /** ISO 8601 — 신호 만료 시각 */
  expiresAt?: string;
  /** ISO 8601 — 신호 생성 시각 */
  createdAt: string;
}

// ── 일일 투자판단 에디션(신문 '호' 모델, DAR-505/507) ──────────────────
// 거래일 1일 = 신문 1호. 조회 전용(파이프라인 무변경). 날짜 키는 KST 거래일 compact 'YYYYMMDD'.

/**
 * 일일 에디션 목록 아이템(GET /signals/daily-editions data[]) — 판단 존재일 요약.
 * 빈 날은 목록에 미포함(백엔드가 '빈 날 발명' 금지). 최신순.
 */
export interface DailyEditionSummary {
  /** KST 거래일 (YYYYMMDD) */
  date: string;
  /** 그 날 매수등급(STRONG_BUY/BUY) 신호 수 */
  count: number;
  /** 그 중 STRONG_BUY 수 */
  strongBuyCount: number;
  /** 그 날 최상위(headline) 종목명 — 없으면 미포함 */
  headlineCorpName?: string;
  /** 그 날 최상위 신호 등급 */
  topGrade?: SignalGrade;
}

/** 일일 에디션 목록 메타(GET /signals/daily-editions meta). */
export interface DailyEditionsMeta {
  /** 시스템 최신 에디션 날짜 (YYYYMMDD) — 판단이 하나도 없으면 null */
  latestDate: string | null;
  /** 서버 기준 KST 오늘 (YYYYMMDD) */
  todayDate: string;
  /** 오늘 에디션(판단) 존재 여부 */
  todayHasEdition: boolean;
  /** 다음 페이지 커서 (before 로 재요청) — 없으면 미포함 */
  nextCursor?: string;
  /** 더 과거 에디션 존재 여부 */
  hasMore: boolean;
}

/**
 * 빈 에디션 사유(§3 정직 규약) — 빈 날을 '평가했으나 없음'으로 위장하지 않고 4분기 + 미래를 구분.
 * CLOSED(휴장)·PENDING(19시 전)·QUIET(조용)·COLD_START(시스템 전무)·FUTURE(미래).
 */
export type EditionEmptyReason = 'CLOSED' | 'PENDING' | 'QUIET' | 'COLD_START' | 'FUTURE';

/** 브리핑 한 줄의 출처 — AI 요약 재사용(`AI`) 또는 제목 폴백(`TITLE`, DAR-551 정직 표기). */
export type FallbackBriefingSummarySource = 'AI' | 'TITLE';

/**
 * 빈 에디션 폴백 '오늘의 주요 공시 브리핑' 항목(DAR-551, meta.fallbackBriefing[]).
 * '판단'이 아니라 그 거래일 주요 공시 브리핑 — TradingSignal 과 물리적으로 분리된 계약.
 */
export interface FallbackBriefingItem {
  /** DART 접수번호 — 공시 상세 딥링크 키(`/disclosure/:rcpNo`) */
  rcpNo: string;
  corpName: string;
  /** 이벤트 라벨(한국어). 이벤트 미분류·미등록 타입은 '기타 공시' */
  eventLabel: string;
  /** 주요 내용 한 줄(공백 정규화 + 최대 100자 말줄임) */
  summaryLine: string;
  summarySource: FallbackBriefingSummarySource;
}

/** 일일 에디션 상세 메타(GET /signals/daily/:date meta). */
export interface DailyEditionMeta {
  /** 조회한 KST 거래일 (YYYYMMDD) */
  date: string;
  /** 오늘 에디션인가 */
  isToday: boolean;
  /** 매수등급 신호 0건인가 */
  isEmpty: boolean;
  /** isEmpty=true 일 때의 사유(빈 카피 분기). 신호가 있으면 미포함 */
  emptyReason?: EditionEmptyReason;
  /** 직전 에디션 존재일 (YYYYMMDD) — 없으면 미포함. 날짜 스트립 좌측 플립 대상 */
  prevEditionDate?: string;
  /** 직후 에디션 존재일 (YYYYMMDD) — 없으면 미포함. 날짜 스트립 우측 플립 대상 */
  nextEditionDate?: string;
  /**
   * 빈 에디션 폴백 '오늘의 주요 공시 브리핑'(DAR-551) — isEmpty=true 이고
   * emptyReason∈{PENDING,QUIET,COLD_START} 일 때만 존재(그 외 undefined). 항목 없으면 [].
   */
  fallbackBriefing?: FallbackBriefingItem[];
}

/** GET /signals/daily-editions 정규화 응답(items + meta). */
export interface DailyEditionsPage {
  items: DailyEditionSummary[];
  meta: DailyEditionsMeta;
}

/** GET /signals/daily/:date 정규화 응답(items + meta). item 은 TradingSignal(+rcpDt). */
export interface DailyEdition {
  items: TradingSignal[];
  meta: DailyEditionMeta;
}

/** 등급무관 탐색 필터(DAR-46) — 등급/페르소나/이벤트유형 미지정 시 전체. */
export interface SignalExploreFilters {
  grade?: SignalGrade;
  personaType?: string;
  eventType?: string;
  sort?: SignalSort;
}

/** 이벤트 스터디 결과 — Prisma EventStudyResult 모델과 1:1 대응 */
export interface EventStudyResult {
  id: string;
  eventType: string;
  bucketKey: string;
  marketType: string;
  sampleCount: number;
  isSignificant: boolean;
  tStatistic?: number;
  pValue?: number;
  variance?: number;
  /** D+N 단순 수익률 평균 (%) */
  avgReturnD1: number;
  avgReturnD3: number;
  avgReturnD5: number;
  avgReturnD20: number;
  /** D+N 시장 대비 초과수익 (AR, %) */
  avgArD1: number;
  avgArD3: number;
  avgArD5: number;
  avgArD20: number;
  /** 분포 지표 */
  upProbD5: number;
  crashProbD5: number;
  avgMaxDrawdown: number;
  avgVolumeRatioD1: number;
  avgVolumeRatioD3: number;
  status: string;
  calculatedAt: string;
  dataFromDate: string;
  dataToDate: string;
}

/** 버킷 구성 개별 관측치 (DAR-166 드릴다운 — 어떤 공시로 통계를 만들었나) */
export interface EventStudyObservation {
  eventId: string;
  rcpNo: string;
  corpCode: string;
  corpName: string | null;
  stockCode: string | null;
  eventType: string;
  bucketKey: string;
  /** 실제 D0 날짜 (YYYYMMDD) */
  d0Date: string;
  /** D+5 누적 초과수익 (CAR, %) — 데이터 미보유 시 null */
  carD5: number | null;
  /** D+20 누적 초과수익 (CAR, %) */
  carD20: number | null;
  /** D0~D+20 최대낙폭 (%) */
  maxDrawdown: number;
  isUpD5: boolean;
  isCrashD5: boolean;
}

/** GET /event-study/:bucketKey/observations 페이지네이션 응답 */
export interface EventStudyObservationsPage {
  bucketKey: string;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: EventStudyObservation[];
}
