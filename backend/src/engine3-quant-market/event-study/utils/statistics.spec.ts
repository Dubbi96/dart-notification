/**
 * statistics.spec.ts — robust 통계(median/percentile/winsorizedMean) 단위 검증 (DAR-402)
 *
 * 핵심 의도: 산술평균(mean)이 극단 이상치에 지배될 때, median/winsorized 평균이
 * 표본의 전형값을 유지함을 결정론적으로 증명한다 — 이상치 오염 차단의 근거.
 */
import { mean, median, percentile, winsorizedMean } from './statistics';

describe('median()', () => {
  it('홀수 길이는 가운데 값', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('짝수 길이는 가운데 두 값 평균', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('빈 배열은 0 (집계 컬럼 NaN 누출 방지)', () => {
    expect(median([])).toBe(0);
  });

  it('원본 배열을 변형하지 않는다(불변)', () => {
    const arr = [5, 1, 3];
    median(arr);
    expect(arr).toEqual([5, 1, 3]);
  });
});

describe('percentile()', () => {
  it('p=0 은 최소, p=1 은 최대', () => {
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 1)).toBe(40);
  });

  it('p=0.5 는 중앙값과 일치', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('선형 보간(R-7)', () => {
    // [0,10] 2점 → 5번째 백분위 = 0 + 0.05*(2-1)*span = 0.5
    expect(percentile([0, 10], 0.05)).toBeCloseTo(0.5, 6);
    expect(percentile([0, 10], 0.95)).toBeCloseTo(9.5, 6);
  });

  it('단일 원소는 그 값', () => {
    expect(percentile([7], 0.3)).toBe(7);
  });

  it('빈 배열은 0', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('winsorizedMean()', () => {
  it('이상치 없는 대칭 표본은 mean 과 동일', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(winsorizedMean(arr)).toBeCloseTo(mean(arr), 6);
  });

  it('극단 이상치를 5/95 분위로 눌러 mean 보다 강건', () => {
    // 19개 0 + 1개 +1000 → mean 은 +50 으로 부풀지만, winsorized 는 상단 5% clip 으로 크게 낮다.
    const arr = [...Array(19).fill(0), 1000];
    expect(mean(arr)).toBeCloseTo(50, 6);
    expect(winsorizedMean(arr)).toBeLessThan(mean(arr));
  });

  it('★ SUPPLY_CONTRACT 재현: 산술평균은 양수인데 median/winsorized 는 음수', () => {
    // 다수의 소폭 음수(전형 -3%) + 소수(≤5%)의 극단 양 이상치(유동성 낮은 소형주 폭등).
    // winsorized(5%/95%)는 상위 5% 이내의 극단치만 캡하므로, 이상치 비중이 clip 한도 이하일 때
    // 산술평균을 음수로 되돌린다. 중앙값은 비중과 무관하게 전형값(음수)을 유지한다.
    const sample = [...Array(95).fill(-3), ...Array(5).fill(200)]; // n=100, 이상치 5%
    expect(mean(sample)).toBeGreaterThan(0); // 산술평균: 이상치 5개에 지배되어 양수
    expect(median(sample)).toBeLessThan(0); // 중앙값: 전형값(-3) 유지
    expect(winsorizedMean(sample)).toBeLessThan(0); // winsorized: 상위 5% 캡 → 음수
    expect(winsorizedMean(sample)).toBeLessThan(mean(sample)); // 항상 산술평균보다 강건
  });

  it('이상치 비중이 clip(5%) 초과면 median 이 더 강건 (winsorized 한계 명시)', () => {
    // 이상치 10% → winsorized 는 절반만 캡되어 양수로 남을 수 있다. 중앙값은 여전히 음수.
    const sample = [...Array(18).fill(-3), 120, 140]; // n=20, 이상치 10%
    expect(mean(sample)).toBeGreaterThan(0);
    expect(median(sample)).toBeLessThan(0); // median 은 비중과 무관하게 강건
    expect(winsorizedMean(sample)).toBeLessThan(mean(sample)); // 최소한 mean 보다는 강건
  });

  it('빈 배열은 0', () => {
    expect(winsorizedMean([])).toBe(0);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const arr = [100, 1, 2, 3, -100];
    winsorizedMean(arr);
    expect(arr).toEqual([100, 1, 2, 3, -100]);
  });
});
