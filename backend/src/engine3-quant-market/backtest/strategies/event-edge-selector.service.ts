import { Injectable, Logger } from '@nestjs/common';
import { EventStudyQueryService, RobustEdge } from '../../event-study/event-study-query.service';

/**
 * DAR-408 — event-edge 전략의 매수 이벤트 유형을 EventStudy robust 통계로 데이터 주도 선별한다.
 *
 * 배경(실측, DAR-402 robust 통계 반영 후): event-edge 가 산술평균(avgArD20)을 추종해 백테스트 -20%.
 *   산술평균은 극단 이상치에 지배돼 SUPPLY_CONTRACT 등 '거짓 양' 신호를 만들었고, 실제로는 모든
 *   공시 이벤트유형의 robust(winsorized/중앙값) D+20 초과수익이 음수였다. 손실 종목을 산 셈.
 *
 * 선별 규칙(do-no-harm):
 *   - robust 지표 = winsorizedMeanArD20 ?? medianArD20 (오염 평균 avgArD20 은 폴백조차 안 함).
 *   - robust > POSITIVE_EDGE_THRESHOLD_PCT(양의 임계치) 인 eventType 만 매수 대상.
 *   - 노이즈 방지: 표본 sampleCount >= MIN_EDGE_SAMPLE_COUNT 인 그룹만 신뢰(소표본 양-edge 무시).
 *   - 양-edge 그룹이 하나도 없으면 빈 배열 → 러너는 진입 0(손실 회피).
 *
 * 데이터가 쌓여 진짜 양-edge 이벤트가 생기면 자동으로 매수 대상에 편입된다(점진 확장 — 사용자 테제).
 *
 * AI 금지영역: 순수 Rule/통계 선별. AI 개입 0.
 */

/** robust D+20 초과수익이 이 값(%)을 초과해야 양(+) edge 로 인정. 0 = 양수면 인정. */
export const POSITIVE_EDGE_THRESHOLD_PCT = 0;

/** 양-edge 로 신뢰하기 위한 최소 표본 수(소표본 노이즈 매수 방지). */
export const MIN_EDGE_SAMPLE_COUNT = 20;

export interface EdgeSelection {
  /** 매수 허용 eventType allowlist(빈 배열이면 진입 0). */
  eventTypes: string[];
  /** 선별 근거(로깅/관측용). */
  evaluated: Array<{
    eventType: string;
    robust: number | null;
    metric: 'winsorized' | 'median' | 'none';
    sampleCount: number;
    selected: boolean;
    reason: string;
  }>;
}

@Injectable()
export class EventEdgeSelectorService {
  private readonly logger = new Logger(EventEdgeSelectorService.name);

  constructor(private readonly eventStudyQuery: EventStudyQueryService) {}

  /** event-edge 매수 eventType allowlist 를 robust 통계로 산출. 없으면 [] (do-no-harm). */
  async selectPositiveEdgeEventTypes(marketType = 'ALL'): Promise<EdgeSelection> {
    const edges = await this.eventStudyQuery.findRobustEdges(marketType);
    const evaluated = edges.map((e) => this.evaluate(e)).sort((a, b) => (b.robust ?? -Infinity) - (a.robust ?? -Infinity));
    const eventTypes = evaluated.filter((e) => e.selected).map((e) => e.eventType);

    if (eventTypes.length === 0) {
      this.logger.log(
        `[event-edge] robust 양-edge 이벤트 0종 → 진입 0(do-no-harm). 평가 ${evaluated.length}종 모두 미달.`,
      );
    } else {
      this.logger.log(`[event-edge] robust 양-edge ${eventTypes.length}종 선별: ${eventTypes.join(', ')}`);
    }
    return { eventTypes, evaluated };
  }

  /** 단일 eventType 의 robust 지표를 임계치·표본으로 평가. */
  private evaluate(edge: RobustEdge): EdgeSelection['evaluated'][number] {
    const { robust, metric } = pickRobust(edge);
    if (robust === null) {
      return {
        eventType: edge.eventType,
        robust: null,
        metric: 'none',
        sampleCount: edge.sampleCount,
        selected: false,
        reason: 'robust 통계 미산출(미재계산) → 제외',
      };
    }
    if (edge.sampleCount < MIN_EDGE_SAMPLE_COUNT) {
      return {
        eventType: edge.eventType,
        robust,
        metric,
        sampleCount: edge.sampleCount,
        selected: false,
        reason: `표본 ${edge.sampleCount} < ${MIN_EDGE_SAMPLE_COUNT}(소표본 노이즈) → 제외`,
      };
    }
    const selected = robust > POSITIVE_EDGE_THRESHOLD_PCT;
    return {
      eventType: edge.eventType,
      robust,
      metric,
      sampleCount: edge.sampleCount,
      selected,
      reason: selected
        ? `robust(${metric}) ${robust.toFixed(2)}% > ${POSITIVE_EDGE_THRESHOLD_PCT}% → 매수`
        : `robust(${metric}) ${robust.toFixed(2)}% <= ${POSITIVE_EDGE_THRESHOLD_PCT}% → 제외`,
    };
  }
}

/** robust 지표 선택: winsorized 우선, 없으면 median. 오염 평균(avg)은 폴백조차 안 함. */
function pickRobust(edge: RobustEdge): { robust: number | null; metric: 'winsorized' | 'median' | 'none' } {
  if (edge.winsorizedMeanArD20 !== null && edge.winsorizedMeanArD20 !== undefined) {
    return { robust: edge.winsorizedMeanArD20, metric: 'winsorized' };
  }
  if (edge.medianArD20 !== null && edge.medianArD20 !== undefined) {
    return { robust: edge.medianArD20, metric: 'median' };
  }
  return { robust: null, metric: 'none' };
}
