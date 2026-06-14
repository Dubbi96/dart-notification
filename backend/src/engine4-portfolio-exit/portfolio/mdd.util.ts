/**
 * mdd.util.ts — 포트폴리오 MDD(최대낙폭) 산출 (DAR-219)
 *
 * 진짜 MDD는 정의상 '시계열 누적 최고점 대비 최대 하락폭'(peak-to-trough)이다.
 * 기존 findPortfolioSummary는 '최신 스냅샷의 미실현손익률을 0 이하로 클램프'해서
 * 한때 깊이 빠졌다 회복한 포지션의 위험을 0%로 과소표시했다
 * (예: 한때 -30%까지 빠졌다 +5% 회복 → mddPercent=0).
 * 스냅샷 totalValue 시계열에서 실제 누적 최고점 대비 최대 하락폭을 구한다.
 *
 * 알고리즘은 engine3 event-study의 calcMaxDrawdown(abnormal-return.ts)과 동일한
 * peak-to-trough 방식이며, 엔진 경계 보존을 위해 순수 함수로 재구현한다.
 */

/**
 * 자산가치(equity) 시계열에서 최대낙폭을 음수 퍼센트로 반환한다.
 * - 반환값 ≤ 0 (낙폭이 없으면 0). 예: [100, 70, 105] → -30.
 * - 데이터 1개 이하이거나 단조 상승이면 0.
 * - peak ≤ 0 구간은 나눗셈 방어로 건너뛴다.
 * - 시계열은 시간 오름차순으로 전달해야 한다.
 */
export function computeMaxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let maxDrawdown = 0; // 낙폭 크기를 양수로 누적

  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = ((peak - value) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  return maxDrawdown > 0 ? -maxDrawdown : 0;
}
