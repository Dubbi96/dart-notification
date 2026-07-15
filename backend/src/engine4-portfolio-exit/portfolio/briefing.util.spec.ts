/**
 * briefing.util.spec.ts (W14)
 * - aggregateDailyPnl: 누적손익 차분 산식·신규 포지션 폴백·분모(전일 평가금액) 역산·결측 정직(null)
 * - extractSummaryLine: 캐시 resultJson 방어 파싱·첫 줄 추출·절단
 */

import {
  aggregateDailyPnl,
  extractSummaryLine,
  SUMMARY_LINE_MAX_LENGTH,
} from './briefing.util';

describe('aggregateDailyPnl — 일간 손익 집계(순수 룰)', () => {
  it('두 시점 누적손익 차분의 합이 일간 손익이다', () => {
    const latest = [
      { positionId: 'p1', unrealizedPnl: 1500, positionValue: 11500 },
      { positionId: 'p2', unrealizedPnl: -500, positionValue: 9500 },
    ];
    const prev = [
      { positionId: 'p1', unrealizedPnl: 1000, positionValue: 11000 },
      { positionId: 'p2', unrealizedPnl: -200, positionValue: 9800 },
    ];
    const agg = aggregateDailyPnl(latest, prev);

    // p1: +500, p2: -300 → 합 +200
    expect(agg.dailyPnl).toBe(200);
    expect(agg.positionCount).toBe(2);
    // 분모 = 최신 평가금액 합(21000) − 일간 손익(200) = 20800
    expect(agg.dailyPnlPct).toBeCloseTo((200 / 20800) * 100, 6);
  });

  it('직전 스냅샷 없는 신규 포지션은 당일 누적분 전체가 일간 손익으로 잡힌다', () => {
    const latest = [
      { positionId: 'p1', unrealizedPnl: 300, positionValue: 10300 },
      { positionId: 'new', unrealizedPnl: 150, positionValue: 5150 }, // 당일 진입
    ];
    const prev = [{ positionId: 'p1', unrealizedPnl: 100, positionValue: 10100 }];
    const agg = aggregateDailyPnl(latest, prev);

    // p1: +200, new: +150(차감 0) → +350
    expect(agg.dailyPnl).toBe(350);
    expect(agg.positionCount).toBe(2);
  });

  it('직전에만 있고 최신에 없는 포지션(청산)은 집계에서 제외된다', () => {
    const latest = [{ positionId: 'p1', unrealizedPnl: 100, positionValue: 10100 }];
    const prev = [
      { positionId: 'p1', unrealizedPnl: 50, positionValue: 10050 },
      { positionId: 'closed', unrealizedPnl: 999, positionValue: 9999 },
    ];
    const agg = aggregateDailyPnl(latest, prev);

    expect(agg.dailyPnl).toBe(50);
    expect(agg.positionCount).toBe(1);
  });

  it('분모(전일 기준 평가금액) ≤ 0이면 손익률은 null(0% 위장 금지)', () => {
    // 평가금액 합 100, 일간 손익 100 → 분모 0
    const latest = [{ positionId: 'p1', unrealizedPnl: 100, positionValue: 100 }];
    const agg = aggregateDailyPnl(latest, []);

    expect(agg.dailyPnl).toBe(100);
    expect(agg.dailyPnlPct).toBeNull();
  });

  it('최신 행이 없으면 0건·0원·null%', () => {
    const agg = aggregateDailyPnl([], []);
    expect(agg).toEqual({ dailyPnl: 0, dailyPnlPct: null, positionCount: 0 });
  });
});

describe('extractSummaryLine — 캐시 요약 1줄 추출(방어 파싱)', () => {
  it('정상 resultJson에서 summary 문자열을 추출한다', () => {
    expect(
      extractSummaryLine({ summary: '3분기 영업이익이 컨센서스를 상회했다.', polarity: 'POSITIVE' }),
    ).toBe('3분기 영업이익이 컨센서스를 상회했다.');
  });

  it('여러 줄이면 첫 줄만 취한다(요약 1줄 계약)', () => {
    expect(extractSummaryLine({ summary: '첫 줄 요약.\n둘째 줄 상세.' })).toBe('첫 줄 요약.');
  });

  it('선행 빈 줄은 건너뛰고 첫 내용 줄을 취한다', () => {
    expect(extractSummaryLine({ summary: '  \n실제 요약 줄.' })).toBe('실제 요약 줄.');
  });

  it('최대 길이 초과분은 말줄임으로 절단한다', () => {
    const long = '가'.repeat(SUMMARY_LINE_MAX_LENGTH + 40);
    const line = extractSummaryLine({ summary: long });
    expect(line).toHaveLength(SUMMARY_LINE_MAX_LENGTH);
    expect(line?.endsWith('…')).toBe(true);
  });

  it.each([
    ['null', null],
    ['배열', ['summary']],
    ['문자열', 'summary'],
    ['summary 비문자', { summary: 42 }],
    ['summary 공백', { summary: '   \n  ' }],
    ['summary 부재', { polarity: 'MIXED' }],
  ])('비정형 resultJson(%s)은 null(결측 정직)', (_label, input) => {
    expect(extractSummaryLine(input)).toBeNull();
  });
});
