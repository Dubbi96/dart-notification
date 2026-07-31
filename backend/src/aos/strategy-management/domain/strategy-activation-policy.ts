import {
  getMarketSession,
  isTradingDay,
  KRX_FULLY_VERIFIED_CALENDAR_YEARS,
} from '../../../common/time/market-calendar';
import { formatKstDateCompact, kstClock } from '../../../common/time/kst';
import { StrategyVersionDomainError } from './strategy-version.types';

export interface StrategyActivationWindow {
  readonly marketSessionDate: string;
  readonly closeMinute: number;
  readonly currentMinute: number;
}

/**
 * Strategy/Rule/Weight 버전은 검증된 KRX 거래일의 종가가 완전히 지난 뒤에만 효력을 얻는다.
 * Date는 절대 시각이며 날짜·벽시계는 항상 KST로 해석한다.
 */
export function assertStrategyActivationWindow(now: Date): StrategyActivationWindow {
  assertValidDate(now);

  const marketSessionDate = formatKstDateCompact(now);
  const year = Number(marketSessionDate.slice(0, 4));
  if (!KRX_FULLY_VERIFIED_CALENDAR_YEARS.has(year)) {
    throw new StrategyVersionDomainError(
      'MARKET_CALENDAR_NOT_VERIFIED',
      `KRX calendar is not fully verified for ${year}; strategy activation is blocked.`,
    );
  }

  if (!isTradingDay(marketSessionDate)) {
    throw new StrategyVersionDomainError(
      'ACTIVATION_NOT_TRADING_DAY',
      `Strategy activation is allowed only after the close of a verified KRX trading day (${marketSessionDate}).`,
    );
  }

  const session = getMarketSession(marketSessionDate);
  if (!session) {
    throw new StrategyVersionDomainError(
      'ACTIVATION_NOT_TRADING_DAY',
      `No KRX market session exists for ${marketSessionDate}.`,
    );
  }

  const currentMinute = kstClock(now).minutes;
  if (currentMinute <= session.closeMin) {
    throw new StrategyVersionDomainError(
      'ACTIVATION_NOT_AFTER_MARKET_CLOSE',
      `Strategy activation is blocked until after KRX close (${session.closeMin} KST minutes).`,
    );
  }

  return {
    marketSessionDate,
    closeMinute: session.closeMin,
    currentMinute,
  };
}

/**
 * 예약 효력 시각도 거래일 종가 후여야 한다. 실제 활성화 시점에는 같은 정책을 다시 평가한다.
 */
export function assertValidStrategyActivationSchedule(
  scheduledFor: Date,
  requestedAt: Date,
): StrategyActivationWindow {
  assertValidDate(requestedAt);
  assertValidDate(scheduledFor);

  if (scheduledFor.getTime() <= requestedAt.getTime()) {
    throw new StrategyVersionDomainError(
      'EFFECTIVE_FROM_NOT_FUTURE',
      'scheduledFor must be later than the scheduling time.',
    );
  }

  return assertStrategyActivationWindow(scheduledFor);
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new StrategyVersionDomainError(
      'VERSION_ACTIVATION_SCHEDULE_MISMATCH',
      'Strategy activation requires a valid absolute timestamp.',
    );
  }
}
