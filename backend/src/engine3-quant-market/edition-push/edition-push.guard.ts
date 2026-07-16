/**
 * DAR-523(Wave B/B2·P0) — 일일 에디션 발행 푸시 하드 가드(순수 함수).
 *
 * ★수용기준 1: 빈 에디션(매수등급 STRONG_BUY+BUY 0건) 날은 발송 0.
 *   에디션 조회 API(SignalsService.findDailyEdition, DAR-505/519 수정판)의 결과를 그대로 받아
 *   `meta.isEmpty`(=매수등급 items 0건)면 emptyReason(CLOSED/QUIET/PENDING/FUTURE/COLD_START)
 *   불문 무조건 발송을 금지한다. '판단 없는 날 배달 금지' — 정직 원칙(플랜 §3)의 코드화.
 *
 * ★순수 함수 — I/O·시각·엔진 의존 없음. 결정론 단위테스트로 QUIET/CLOSED 날 미발송을 고정한다.
 * ★조회·판정 계층 전용 — 매매·체결·Buy Score 경로 무접점(M10 무오염·AI 0).
 */

/** SignalsService.findDailyEdition item 중 가드가 소비하는 최소 형상(구조적 타이핑). */
export interface EditionSignalItemShape {
  /** 기업명(헤드라인 표기용). */
  corpName: string;
  /** 표시 등급 — 'STRONG_BUY' | 'BUY' (매수등급만 조회되므로 이 둘 중 하나). */
  grade: string;
}

/** SignalsService.findDailyEdition 반환 중 가드가 소비하는 최소 형상. */
export interface EditionQueryResultShape {
  items: EditionSignalItemShape[];
  meta: {
    /** KST 거래일 YYYYMMDD. */
    date: string;
    /** 매수등급 0건 여부(=items.length===0). */
    isEmpty: boolean;
    /** 빈 사유(관측·로깅용) — CLOSED/PENDING/QUIET/COLD_START/FUTURE. */
    emptyReason?: string;
  };
}

/** 발행 결정(매수등급 >0). */
export interface EditionPushPublish {
  publish: true;
  editionDate: string;
  /** 매수등급(STRONG_BUY+BUY) 총 건수(>0 불변식). */
  count: number;
  /** 적극매수(STRONG_BUY) 건수. */
  strongBuyCount: number;
  /** 헤드라인 기업명(최고 점수 종목 — findDailyEdition 이 buyScore desc 정렬). */
  headlineCorpName: string;
}

/** 미발행 결정(빈 에디션). */
export interface EditionPushSkip {
  publish: false;
  editionDate: string;
  reason: 'EMPTY_EDITION';
  /** 빈 사유(관측·로깅용). */
  emptyReason?: string;
}

export type EditionPushDecision = EditionPushPublish | EditionPushSkip;

/** 표시 등급 상수(mapGrade 산출값과 동일 — SSOT 결합 최소화). */
const STRONG_BUY_DISPLAY_GRADE = 'STRONG_BUY';

/**
 * 에디션 조회 결과 → 발행/미발행 결정(★하드 가드).
 *   매수등급 0건(meta.isEmpty || items.length===0)이면 무조건 미발행(빈 에디션 발송 금지).
 *   그 외엔 발행하되 count/strongBuyCount/headline 을 산출한다.
 */
export function decideEditionPush(edition: EditionQueryResultShape): EditionPushDecision {
  const { items, meta } = edition;
  // ★하드 가드: 빈 에디션(매수등급 0)은 emptyReason 불문 발송 금지.
  if (meta.isEmpty || items.length === 0) {
    return {
      publish: false,
      editionDate: meta.date,
      reason: 'EMPTY_EDITION',
      emptyReason: meta.emptyReason,
    };
  }
  const strongBuyCount = items.filter((i) => i.grade === STRONG_BUY_DISPLAY_GRADE).length;
  return {
    publish: true,
    editionDate: meta.date,
    count: items.length,
    strongBuyCount,
    headlineCorpName: items[0].corpName,
  };
}

/** 완성된 푸시 콘텐츠(제목·본문·딥링크) — point-in-time 보존을 위해 발행 측이 산출한다. */
export interface EditionPushContent {
  title: string;
  body: string;
  deepLink: string;
}

/**
 * 발행 결정 → 푸시 콘텐츠(순수·정직 카피). 제목은 고정('오늘의 투자판단 에디션'),
 * 본문은 헤드라인 기업명 + 매수 후보 수(+적극매수 수) 팩트만 — 권고·과장 문구 없음.
 * 딥링크는 신호탭 에디션 브라우징(`/signals`, 모바일 화이트리스트 통과). 정밀 딥링크(에디션 호 지정)는
 * Wave B P1(딥링크+놓친 호 뱃지) 후속 이슈 범위.
 */
export function buildEditionPushContent(decision: EditionPushPublish): EditionPushContent {
  const { count, strongBuyCount, headlineCorpName } = decision;
  const others = count > 1 ? ` 외 ${count - 1}곳` : '';
  const strong = strongBuyCount > 0 ? ` (적극매수 ${strongBuyCount})` : '';
  return {
    title: '오늘의 투자판단 에디션',
    body: `${headlineCorpName}${others} · 매수 후보 ${count}곳${strong}`,
    deepLink: '/signals',
  };
}
