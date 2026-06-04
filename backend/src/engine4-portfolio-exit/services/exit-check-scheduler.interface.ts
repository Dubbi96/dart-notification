// 하루 3회 점검 스케줄 인터페이스 (09:00/13:00/16:30)
// AI 금지: 스케줄·트리거 결정은 Rule 기반 시간 기준만.

import { CheckTime } from '../domain/exit-engine.types';

export interface IExitCheckScheduler {
  /** 09:00 - 장 시작 전 점검 */
  runPreMarketCheck(): Promise<void>;
  /** 13:00 - 장중 점검 */
  runIntradayCheck(): Promise<void>;
  /** 16:30 - 장 마감 후 점검 */
  runPostMarketCheck(): Promise<void>;
}

export const EXIT_CHECK_CRON = {
  PRE_MARKET: '0 9 * * 1-5',    // 평일 09:00
  INTRADAY: '0 13 * * 1-5',     // 평일 13:00
  POST_MARKET: '30 16 * * 1-5', // 평일 16:30
} as const;

export function checkTimeFromCron(
  cronLabel: keyof typeof EXIT_CHECK_CRON,
): CheckTime {
  const map: Record<keyof typeof EXIT_CHECK_CRON, CheckTime> = {
    PRE_MARKET: 'PRE_MARKET',
    INTRADAY: 'INTRADAY',
    POST_MARKET: 'POST_MARKET',
  };
  return map[cronLabel];
}
