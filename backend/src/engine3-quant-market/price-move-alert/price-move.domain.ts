/**
 * 갭분석 W7·W6 — 관심종목 급변동 알림 순수 도메인(±5% 판정·업종 z-score·본문 빌더).
 *
 * ★순수 함수만: DB·HTTP·시계 의존 0(모든 입력은 인자). 스케줄러/서비스가 데이터를 주입한다.
 * ★AI 금지영역 무접점: 알림 계층 전용 — 매매·체결·Buy Score 경로와 코드 공유 없음(조회·계측·알림).
 *
 * 정직 원칙(W6): 급변동 원인을 아는 척하지 않는다 — 당일 공시 유무를 병기하고,
 * 공시 0건(48h)일 때는 보유 데이터(시장조치·업종 동반 변동·조회공시)로 '공시 요인 배제'
 * 팩트체크 근거만 제시한다(뉴스 수집·저장 0 — 네이버금융 딥링크 링크아웃만).
 */

/** 발화 임계 — 전일 종가 대비 ±5% 이상(W7 핵심 방향 frozen). */
export const PRICE_MOVE_THRESHOLD_PCT = 5;

/** 업종 cross-sectional z-score 판정 최소 피어 수(미만이면 판정 보류 — LOW_SAMPLE 정직). */
export const SECTOR_MIN_PEERS = 5;

/** |z| ≤ 이 값이면 '업종 내 평범한 움직임'(동반 변동 후보) — 타깃이 업종 분포의 이상치가 아님. */
export const SECTOR_CO_MOVE_MAX_ABS_Z = 1.5;

/** 업종 평균 등락률(%)이 이 값 이상 같은 방향이어야 '업종 동반 변동'으로 라벨링. */
export const SECTOR_CO_MOVE_MIN_MEAN_PCT = 1.0;

/** 전일 종가 대비 등락률(%). prevClose 가 0/음수·비유한이면 판정 불가(null). */
export function computeChangePct(price: number, prevClose: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) return null;
  return ((price - prevClose) / prevClose) * 100;
}

/** ±threshold% 이상 변동 여부. null(판정 불가)은 항상 미발화. */
export function isPriceMoveTriggered(
  changePct: number | null,
  thresholdPct: number = PRICE_MOVE_THRESHOLD_PCT,
): boolean {
  if (changePct === null || !Number.isFinite(changePct)) return false;
  return Math.abs(changePct) >= thresholdPct;
}

/**
 * 멱등 자연키 — 종목당 1일 1회 dedupe 의 뿌리(refId).
 * NotificationHistory @@unique([userId,type,refId]) + BullMQ jobId(`pmove-<refId>`)가 공유한다.
 * ★':' 미포함(BullMQ custom jobId 는 ':' 불가 — queue.constants DAR-230 주석 참조).
 */
export function priceMoveRefId(stockCode: string, tradeDate: string): string {
  return `${stockCode}-${tradeDate}`;
}

/** 네이버금융 종목 뉴스 URL — 외부 브라우저 링크아웃 전용(수집·저장 0, 라이선스 무관). */
export function naverStockNewsUrl(stockCode: string): string {
  return `https://finance.naver.com/item/news.naver?code=${stockCode}`;
}

/** 부호 포함 퍼센트(소수 1자리) — 알림 제목·본문 표기용. 예: +6.2% / -5.0% */
export function formatSignedPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** 업종 동반 변동(cross-sectional) 판정 결과. */
export interface SectorCoMoveResult {
  /** 타깃 등락률의 업종 내 z-score. 표본 부족·분산 0 이면 null(판정 보류). */
  zScore: number | null;
  /** '업종 동반 변동(테마성 추정)' 라벨 부여 여부. */
  isCoMove: boolean;
  /** 판정에 사용한 피어 수. */
  peerCount: number;
  /** 피어 등락률 평균(%). 표본 부족이면 null. */
  peerMeanPct: number | null;
}

/**
 * 동일 업종 동반 변동 여부 — 축적 일봉 기반 cross-sectional z-score(W6 (b)).
 *
 * 판정: 피어 ≥ SECTOR_MIN_PEERS 이고,
 *  ① |z| ≤ SECTOR_CO_MOVE_MAX_ABS_Z (타깃이 업종 분포의 이상치가 아님 = 업종과 함께 움직임)
 *  ② 업종 평균이 타깃과 같은 방향으로 SECTOR_CO_MOVE_MIN_MEAN_PCT 이상
 * 둘 다 충족 시에만 isCoMove=true. 표본 부족·분산 0 은 zScore=null(과잉 라벨 방지 — 정직).
 */
export function evaluateSectorCoMove(
  targetChangePct: number,
  peerChangePcts: number[],
): SectorCoMoveResult {
  const peers = peerChangePcts.filter((p) => Number.isFinite(p));
  const peerCount = peers.length;
  if (peerCount < SECTOR_MIN_PEERS) {
    return { zScore: null, isCoMove: false, peerCount, peerMeanPct: null };
  }
  const mean = peers.reduce((a, b) => a + b, 0) / peerCount;
  const variance = peers.reduce((a, b) => a + (b - mean) ** 2, 0) / peerCount;
  const std = Math.sqrt(variance);
  if (std === 0) {
    return { zScore: null, isCoMove: false, peerCount, peerMeanPct: mean };
  }
  const zScore = (targetChangePct - mean) / std;
  const sameDirection = Math.sign(mean) === Math.sign(targetChangePct);
  const isCoMove =
    Math.abs(zScore) <= SECTOR_CO_MOVE_MAX_ABS_Z &&
    sameDirection &&
    Math.abs(mean) >= SECTOR_CO_MOVE_MIN_MEAN_PCT;
  return { zScore, isCoMove, peerCount, peerMeanPct: mean };
}

/** 시장조치 플래그(StockStatusDaily 최신 스냅샷 발췌 — W6 (a)). */
export interface MarketStatusFlags {
  isTradingSuspended: boolean;
  isInvestmentCaution: boolean;
  isAbnormalSurge: boolean;
}

/** 알림 본문 빌더 입력 — 팩트체크 컨텍스트(서비스가 DB 조회로 채움). */
export interface PriceMoveFactCheck {
  /** 오늘(KST 거래일) 공시 건수 — engine1 Disclosure 조회(백필 제외). */
  disclosureCountToday: number;
  /** 최근 48시간 내 공시 존재 여부(오늘 포함). */
  hasDisclosure48h: boolean;
  /** 시장조치 플래그(무공시 케이스만 조회·병기). 미조회/무데이터면 null. */
  status: MarketStatusFlags | null;
  /** 업종 동반 변동 판정(무공시 케이스만 계산). 판정 불가/미계산이면 null. */
  sector: SectorCoMoveResult | null;
  /** 시황변동 조회공시(요구/답변) 최근 존재 여부(무공시 케이스만 조회). */
  hasInquiryDisclosure: boolean;
}

/** 알림 제목 — '{기업명} 급변동 {±X.X%}' (이모지 0·출처 라벨 SSOT '급변동' 과 정합). */
export function buildPriceMoveTitle(corpName: string, changePct: number): string {
  return `${corpName} 급변동 ${formatSignedPct(changePct)}`;
}

/**
 * 알림 본문 — 당일 공시 유무 병기(W7) + 무공시(48h 0건) 팩트체크 근거 병기(W6).
 *
 * 분기:
 *  - 오늘 공시 N>0        → '오늘 공시 N건' (원인 후보 존재 — 딥링크(종목 상세)에서 확인)
 *  - 오늘 0건·48h 내 있음 → '오늘 공시 없음 · 최근 48시간 내 공시 있음'
 *  - 48h 0건              → '관련 공시 없음(최근 48시간)' + 팩트체크 근거:
 *      (a) 시장조치: 거래정지 / 투자주의 지정 / 이상급등 지정
 *      (b) 업종 동반 변동(테마성 추정)
 *      (c) 시황변동 조회공시 있음
 *      근거 전무 시 '공시 요인 아님 — 수급·테마 추정' (설명 실패 고백이 아니라 배제 팩트체크)
 * 말미 '준실시간(최대 5분 지연)' 고정 — 기대치 관리(W7 리스크 (2)).
 */
export function buildPriceMoveBody(changePct: number, fact: PriceMoveFactCheck): string {
  const parts: string[] = [`전일 종가 대비 ${formatSignedPct(changePct)}`];

  if (fact.disclosureCountToday > 0) {
    parts.push(`오늘 공시 ${fact.disclosureCountToday}건`);
  } else if (fact.hasDisclosure48h) {
    parts.push('오늘 공시 없음 · 최근 48시간 내 공시 있음');
  } else {
    parts.push('관련 공시 없음(최근 48시간)');
    const evidences: string[] = [];
    if (fact.status?.isTradingSuspended) evidences.push('거래정지');
    if (fact.status?.isInvestmentCaution) evidences.push('투자주의 지정');
    if (fact.status?.isAbnormalSurge) evidences.push('이상급등 지정');
    if (fact.sector?.isCoMove) evidences.push('업종 동반 변동(테마성 추정)');
    if (fact.hasInquiryDisclosure) evidences.push('시황변동 조회공시 있음');
    if (evidences.length > 0) {
      parts.push(...evidences);
    } else {
      parts.push('공시 요인 아님 — 수급·테마 추정');
    }
  }

  parts.push('준실시간(최대 5분 지연)');
  return parts.join(' · ');
}
