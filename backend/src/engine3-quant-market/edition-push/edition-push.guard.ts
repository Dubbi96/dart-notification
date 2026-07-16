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

import {
  buildEventLead,
  buildReactionStatPhrase,
  buildOneLineJudgmentBody,
  type ReactionStatInput,
} from '../../notifications/push-body-template';

/** SignalsService.findDailyEdition item 중 가드가 소비하는 최소 형상(구조적 타이핑). */
export interface EditionSignalItemShape {
  /** 기업명(헤드라인 표기용). */
  corpName: string;
  /** 표시 등급 — 'STRONG_BUY' | 'BUY' (매수등급만 조회되므로 이 둘 중 하나). */
  grade: string;
  /** 이벤트 유형(DAR-525 '한 줄 판단' 리드 라벨용). findDailyEdition item 이 포함(선택). */
  eventType?: string | null;
  /** 관련 공시 rcpNo(DAR-525 유사공시 반응 통계 조회 키). findDailyEdition item 이 포함(선택). */
  relatedDisclosureRcpNo?: string | null;
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
  /** 헤드라인 종목 이벤트 유형(DAR-525 '한 줄 판단' 리드 라벨용). 없으면 라벨 생략. */
  headlineEventType?: string;
  /** 헤드라인 종목 관련 공시 rcpNo(DAR-525 유사공시 반응 통계 조회 키). 없으면 통계 생략. */
  headlineRcpNo?: string;
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
  const headline = items[0];
  return {
    publish: true,
    editionDate: meta.date,
    count: items.length,
    strongBuyCount,
    headlineCorpName: headline.corpName,
    headlineEventType: headline.eventType ?? undefined,
    headlineRcpNo: headline.relatedDisclosureRcpNo ?? undefined,
  };
}

/** 완성된 푸시 콘텐츠(제목·본문·딥링크) — point-in-time 보존을 위해 발행 측이 산출한다. */
export interface EditionPushContent {
  title: string;
  body: string;
  deepLink: string;
  /** 유사공시 반응 통계 문구가 본문에 포함됐는가(관측·테스트용). */
  statsIncluded: boolean;
}

/**
 * 발행 결정 → 푸시 콘텐츠(순수·정직 카피, DAR-525 '한 줄 판단' 표준).
 *
 * 제목은 고정('오늘의 투자판단 에디션'). 본문은 헤드라인 종목의 '한 줄 판단':
 *   - 통계 있음(n≥30): '삼성전자 공급계약 외 4곳 — 유사공시 D+5 평균 +2.1% (n=142)'.
 *   - 통계 없음(n<30·미추출): '삼성전자 공급계약 외 4곳 · 매수 후보 5곳 (적극매수 2)'(대체 꼬리·허수 미노출).
 * 권고·과장 문구 없음(팩트/과거 통계만). 딥링크는 신호탭 에디션 브라우징(`/signals`).
 *
 * @param statInput 헤드라인 종목의 유사공시 반응 통계(Wave A DAR-511 페이로드 발췌). n<30 이면
 *   buildReactionStatPhrase 가 null 을 반환해 자동으로 대체 꼬리로 폴백한다.
 */
export function buildEditionPushContent(
  decision: EditionPushPublish,
  statInput?: ReactionStatInput | null,
): EditionPushContent {
  const { count, strongBuyCount, headlineCorpName, headlineEventType } = decision;
  const others = count > 1 ? ` 외 ${count - 1}곳` : '';
  const strong = strongBuyCount > 0 ? ` (적극매수 ${strongBuyCount})` : '';

  const eventLabel = buildEventLead({ eventType: headlineEventType });
  const lead = `${headlineCorpName}${eventLabel ? ` ${eventLabel}` : ''}${others}`;
  const statPhrase = buildReactionStatPhrase(statInput);
  const result = buildOneLineJudgmentBody({
    lead,
    statPhrase,
    fallbackTail: `매수 후보 ${count}곳${strong}`,
  });

  return {
    title: '오늘의 투자판단 에디션',
    body: result.body,
    deepLink: '/signals',
    statsIncluded: result.statsIncluded,
  };
}
