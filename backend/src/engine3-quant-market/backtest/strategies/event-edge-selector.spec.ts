import {
  EventEdgeSelectorService,
  POSITIVE_EDGE_THRESHOLD_PCT,
  MIN_EDGE_SAMPLE_COUNT,
} from './event-edge-selector.service';
import { EventStudyQueryService, RobustEdge } from '../../event-study/event-study-query.service';

/**
 * DAR-408 — event-edge robust 선별 단위 테스트.
 * 핵심 불변식: 거짓 평균(avgArD20)이 아무리 양수여도 robust(winsorized/median)가 음수면 매수 0.
 */
describe('EventEdgeSelectorService (DAR-408)', () => {
  let query: jest.Mocked<Pick<EventStudyQueryService, 'findRobustEdges'>>;
  let service: EventEdgeSelectorService;

  function edge(over: Partial<RobustEdge>): RobustEdge {
    return {
      eventType: 'X',
      bucketKey: '__ALL__',
      winsorizedMeanArD20: null,
      medianArD20: null,
      avgArD20: 0,
      sampleCount: MIN_EDGE_SAMPLE_COUNT,
      status: 'READY',
      ...over,
    };
  }

  beforeEach(() => {
    query = { findRobustEdges: jest.fn() } as any;
    service = new EventEdgeSelectorService(query as any);
  });

  it('robust(winsorized)가 양수면 매수, 음수면 제외 — 거짓 평균은 무시한다', async () => {
    query.findRobustEdges.mockResolvedValue([
      // 거짓 양: 산술평균 +33%지만 winsorized 음수 → 제외(이슈의 SUPPLY_CONTRACT 케이스)
      edge({ eventType: 'SUPPLY_CONTRACT', avgArD20: 33, winsorizedMeanArD20: -2.1, sampleCount: 40 }),
      // 진짜 양: winsorized 양수 → 매수
      edge({ eventType: 'EARNINGS_SURPRISE', avgArD20: 1, winsorizedMeanArD20: 2.5, sampleCount: 50 }),
    ]);

    const res = await service.selectPositiveEdgeEventTypes();
    expect(res.eventTypes).toEqual(['EARNINGS_SURPRISE']);
    const sc = res.evaluated.find((e) => e.eventType === 'SUPPLY_CONTRACT')!;
    expect(sc.selected).toBe(false);
    expect(sc.metric).toBe('winsorized');
  });

  it('winsorized 없으면 median 으로 폴백한다(avg 로는 폴백 안 함)', async () => {
    query.findRobustEdges.mockResolvedValue([
      // winsorized null, median 양수 → 매수(median 폴백)
      edge({ eventType: 'A', avgArD20: -99, medianArD20: 1.2, sampleCount: 30 }),
      // winsorized null, median 음수 → 제외
      edge({ eventType: 'B', avgArD20: 99, medianArD20: -3.0, sampleCount: 30 }),
      // robust 전부 null → 제외(미재계산)
      edge({ eventType: 'C', avgArD20: 50, sampleCount: 30 }),
    ]);

    const res = await service.selectPositiveEdgeEventTypes();
    expect(res.eventTypes).toEqual(['A']);
    expect(res.evaluated.find((e) => e.eventType === 'A')!.metric).toBe('median');
    expect(res.evaluated.find((e) => e.eventType === 'C')!.metric).toBe('none');
  });

  it('소표본 양-edge 는 노이즈로 보고 제외한다(do-no-harm)', async () => {
    query.findRobustEdges.mockResolvedValue([
      edge({ eventType: 'A', winsorizedMeanArD20: 5, sampleCount: MIN_EDGE_SAMPLE_COUNT - 1 }),
    ]);
    const res = await service.selectPositiveEdgeEventTypes();
    expect(res.eventTypes).toEqual([]);
    expect(res.evaluated[0].selected).toBe(false);
    expect(res.evaluated[0].reason).toContain('소표본');
  });

  it('모든 이벤트가 음수 robust 면 빈 배열 → 진입 0(현재 ~7개월 데이터 시나리오)', async () => {
    query.findRobustEdges.mockResolvedValue([
      edge({ eventType: 'A', winsorizedMeanArD20: -1.2, sampleCount: 40 }),
      edge({ eventType: 'B', medianArD20: -6.4, sampleCount: 40 }),
      edge({ eventType: 'C', winsorizedMeanArD20: -3.0, sampleCount: 40 }),
    ]);
    const res = await service.selectPositiveEdgeEventTypes();
    expect(res.eventTypes).toEqual([]);
    expect(POSITIVE_EDGE_THRESHOLD_PCT).toBe(0);
  });

  it('표본 없으면 빈 배열(에러 아님)', async () => {
    query.findRobustEdges.mockResolvedValue([]);
    const res = await service.selectPositiveEdgeEventTypes();
    expect(res.eventTypes).toEqual([]);
    expect(res.evaluated).toEqual([]);
  });
});
