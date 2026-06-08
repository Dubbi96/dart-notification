import { dedupeCandidatesByCorpCode } from './simulation-entry';
import { dedupeOpenPositionRows } from './simulation-positions';

/**
 * DAR-122: 데이터 레벨 중복(중복 TradingSignal/Position 행) 근절 — 종목당 1건 디듑 순수 함수.
 * 동일 corpCode 다중 Persona 후보 → Position 중복 생성의 근본원인을 진입 전 디듑으로 차단한다.
 */
describe('dedupeCandidatesByCorpCode (DAR-122)', () => {
  const c = (id: string, corpCode: string, buyScore: number, signal = 'WATCH') => ({
    id,
    corpCode,
    buyScore,
    signal,
  });

  it('한 종목(corpCode)당 1건만 남긴다', () => {
    const out = dedupeCandidatesByCorpCode([
      c('s1', '001', 42),
      c('s2', '001', 42), // 같은 종목 중복(코칩 4행의 축약)
      c('s3', '001', 30),
      c('s4', '002', 50),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.corpCode).sort()).toEqual(['001', '002']);
  });

  it('동점이면 등급 서열이 높은 후보를 채택한다', () => {
    const out = dedupeCandidatesByCorpCode([
      c('s1', '001', 42, 'WATCH'),
      c('s2', '001', 42, 'STRONG_BUY_CANDIDATE'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('s2');
  });

  it('점수가 높은 후보를 채택한다(등급 무관)', () => {
    const out = dedupeCandidatesByCorpCode([
      c('s1', '001', 30, 'STRONG_BUY_CANDIDATE'),
      c('s2', '001', 60, 'WATCH'),
    ]);
    expect(out[0].id).toBe('s2');
  });

  it('입력 순서와 무관하게 동일 결과(재실행 멱등성)', () => {
    const a = [c('s1', '001', 42), c('s2', '001', 42, 'STRONG_BUY_CANDIDATE'), c('s3', '002', 50)];
    const b = [...a].reverse();
    expect(dedupeCandidatesByCorpCode(a)).toEqual(dedupeCandidatesByCorpCode(b));
  });

  it('출력은 점수 내림차순 정렬', () => {
    const out = dedupeCandidatesByCorpCode([
      c('s1', '001', 10),
      c('s2', '002', 90),
      c('s3', '003', 50),
    ]);
    expect(out.map((x) => x.buyScore)).toEqual([90, 50, 10]);
  });

  it('빈 입력은 빈 배열', () => {
    expect(dedupeCandidatesByCorpCode([])).toEqual([]);
  });
});

describe('dedupeOpenPositionRows (DAR-122)', () => {
  const row = (
    stockCode: string,
    corpCode: string,
    currentValue: number | null,
    quantity = 10,
    entryPrice = 1000,
  ) => ({
    corpCode,
    stockCode,
    quantity,
    entryPrice,
    currentPrice: null,
    currentValue,
    unrealizedPnl: null,
    unrealizedPnlPct: null,
  });

  it('종목(stockCode)당 1행 — 평가금액이 큰 행을 대표로', () => {
    const out = dedupeOpenPositionRows([
      row('126730', 'A', 100_000),
      row('126730', 'A', 399_500), // 코칩 중복 행
      row('259960', 'B', 500_000),
    ]);
    expect(out).toHaveLength(2);
    const cochip = out.find((r) => r.stockCode === '126730');
    expect(cochip?.currentValue).toBe(399_500);
  });

  it('currentValue가 null이면 진입가×수량으로 대표 비교', () => {
    const out = dedupeOpenPositionRows([
      row('001', 'A', null, 5, 1000), // 5000
      row('001', 'A', null, 20, 1000), // 20000 → 대표
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(20);
  });

  it('stockCode가 비면 corpCode로 키 폴백(행 손실 0)', () => {
    const out = dedupeOpenPositionRows([
      row('', 'A', 100),
      row('', 'B', 200),
    ]);
    expect(out).toHaveLength(2);
  });

  it('빈 입력은 빈 배열', () => {
    expect(dedupeOpenPositionRows([])).toEqual([]);
  });
});
