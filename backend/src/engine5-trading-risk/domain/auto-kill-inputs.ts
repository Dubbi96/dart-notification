// Engine5 — 자동 킬스위치 발동 조건 입력 산출 (순수 함수) (DAR-502 [견고화 W2·P20])
//
// 배경(갭 A6): checkAutoKill(kill-switch.ts) 은 완성돼 있으나 프로덕션 호출자 0.
//   본 모듈은 그 순수 함수에 먹일 3입력(연속손실·시장급락·API오류)을 **DB 조회 결과로부터**
//   결정론적으로 산출하는 순수 계산부만 담는다(조회 자체는 서비스 계층 담당 — 여기는 무부작용·무 I/O).
//
// AI 금지영역: 입력 산출은 순수 Rule(산술)만. AI/LLM 개입 0.

import { AutoKillConditions, DEFAULT_AUTO_KILL_CONDITIONS } from './risk-check.types';

/**
 * countConsecutiveLosses — 최근 청산 시계열에서 **연속 손실 횟수** 산출(순수 함수).
 *
 * @param realizedPnls 청산 실현손익 배열. **최신 청산이 index 0**(내림차순) 이어야 한다.
 *   (호출측이 `orderBy: { filledAt/exitTs: 'desc' }` 로 조회한 순서 그대로 넘긴다.)
 * @returns 최신부터 이어지는 손실(pnl < 0) 개수. 첫 비손실(≥0)에서 스트릭 종료.
 *
 * 규약: 손익 0(브레이크이븐)은 손실이 아니다 → 스트릭을 끊는다(보수적: 손실만 카운트).
 *   빈 배열이면 0.
 */
export function countConsecutiveLosses(realizedPnls: number[]): number {
  let streak = 0;
  for (const pnl of realizedPnls) {
    if (Number.isFinite(pnl) && pnl < 0) {
      streak += 1;
    } else {
      break; // 첫 비손실(≥0 또는 비유한값)에서 종료
    }
  }
  return streak;
}

/**
 * computeMarketDropPct — 시장 지수 변동율(음수 = 하락) 산출(순수 함수).
 *
 * @param rows 대표 지수(KOSPI) 최근 행. **최신이 index 0**(tradeDate 내림차순). 최대 2행 사용.
 * @returns 변동율(소수. 예: -0.05 = −5%). 데이터 없으면 0(신호 없음 = 오탐 방지).
 *
 * 산정:
 *   - 2행 이상: 전일 종가 대비 당일 종가((today.close − prev.close) / prev.close) = 일간 수익률.
 *   - 1행: 당일 시가 대비 종가((close − open) / open) = 장중(EOD 미확정) 폴백.
 *   - 0행 또는 분모 ≤ 0: 0(안전 측 — 급락 미감지).
 */
export function computeMarketDropPct(
  rows: Array<{ closeIndex: number; openIndex: number }>,
): number {
  if (rows.length === 0) return 0;
  const latest = rows[0];
  if (rows.length >= 2) {
    const prevClose = rows[1].closeIndex;
    if (!(prevClose > 0)) return 0;
    return (latest.closeIndex - prevClose) / prevClose;
  }
  if (!(latest.openIndex > 0)) return 0;
  return (latest.closeIndex - latest.openIndex) / latest.openIndex;
}

/**
 * SHADOW 계측 조건 = 프로덕션 활성 기본(DEFAULT_AUTO_KILL_CONDITIONS)과 **동일**(임계 무변경).
 *
 * ★설계(요건5·DoD 항목5 — SHADOW 중립성): 본 P20 은 임계값을 **바꾸지 않는다**. 자동킬 판정은
 *   frozen DEFAULT 로만 돌리고, 산출한 raw 입력(연속손실·marketDropPct·apiErrorCount)을 meta 에
 *   전량 기록한다. 따라서 P23(30일 계측 졸업 + 사용자 승인)이 **기록된 raw 데이터**로 임계·ENFORCE
 *   전환을 사후 결정할 수 있다(시장급락 임계는 현재 DEFAULT 에서 marketDropPct=0 → 판정에는 미기여,
 *   raw 값은 관측용으로 보존). 여기서 새 magic 임계를 도입하지 않는 이유 = 발동·해제 로직 및 조건 상수
 *   무변경(이슈 '주의')을 엄격 준수 + 임계 결정은 P23 소관임을 명확히 하기 위함이다.
 */
export const SHADOW_AUTO_KILL_CONDITIONS: AutoKillConditions =
  DEFAULT_AUTO_KILL_CONDITIONS;
