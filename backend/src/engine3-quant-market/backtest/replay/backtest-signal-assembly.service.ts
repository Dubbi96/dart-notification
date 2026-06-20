import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DisclosureSignal } from '../ports/backtest.types';

/** YYYY-MM-DD → YYYYMMDD */
function toCompact(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/**
 * Disclosure.rcpDt(YYYYMMDD 또는 YYYYMMDDHHmmss) → 공시 접수 UTC instant.
 * MarketCalendarService.formatDate(+9h 후 UTC 컴포넌트 판독)와 왕복되도록
 * KST 벽시계 시각을 UTC 로 환산해 보관한다(시각 미상 8자리는 09:00 KST 가정 = 장중·정직).
 */
export function parseRcpDtToInstant(rcpDt: string): Date {
  const y = Number(rcpDt.slice(0, 4));
  const mo = Number(rcpDt.slice(4, 6));
  const d = Number(rcpDt.slice(6, 8));
  const hasTime = rcpDt.length >= 12;
  const hh = hasTime ? Number(rcpDt.slice(8, 10)) : 9;
  const mm = hasTime ? Number(rcpDt.slice(10, 12)) : 0;
  const ss = rcpDt.length >= 14 ? Number(rcpDt.slice(12, 14)) : 0;
  // inst + 9h 의 UTC 컴포넌트가 KST 벽시계가 되도록 -9h
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss) - 9 * 60 * 60 * 1000);
}

export interface SignalAssemblyOptions {
  /** 이 점수 미만 신호 제외(선택). 미지정 시 전수 — 전략 필터는 러너에서 적용 */
  minBuyScore?: number;
  /** 페르소나 한정(선택) */
  personas?: string[];
}

/**
 * 백테스트용 point-in-time 신호 조립 — 과거 1년 공시 신호를 시간순으로 끌어온다.
 *
 * ★ point-in-time(불가침): 각 신호의 발생 시점은 Disclosure.rcpDt(공시 접수일)로만 정의한다.
 *   [startDate, endDate] 구간의 rcpDt 를 가진 TradingSignal 만 반환하며, 그 외 시점 데이터는
 *   섞이지 않는다. 진입/청산의 미래 미참조는 BacktestRunnerService(다음 거래일 시가 진입)와
 *   PriceDataPort(asOf 절단)가 보장한다. 이 서비스는 '신호 발생일' 의 정직성만 책임진다.
 *
 *   buyScore/eventType/persona 는 TradingSignal 에 영속된 값을 그대로 사용한다(라이브와 동일
 *   Rule 산식). 미래 가격으로 고른 신호 0 — rcpDt 기준 구간 필터가 lookahead 를 차단한다.
 *
 * AI 금지영역: 순수 조회·매핑. AI 개입 0.
 */
@Injectable()
export class BacktestSignalAssemblyService {
  private readonly logger = new Logger(BacktestSignalAssemblyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param startDate YYYY-MM-DD (포함)
   * @param endDate   YYYY-MM-DD (포함, 종일)
   */
  async assemble(
    startDate: string,
    endDate: string,
    options: SignalAssemblyOptions = {},
  ): Promise<DisclosureSignal[]> {
    const startCompact = toCompact(startDate);
    // 종일 포함: 14자리(YYYYMMDDHHmmss) rcpDt 의 당일 장후 공시까지 포괄
    const endCompactCeil = `${toCompact(endDate)}999999`;

    const rows = await this.prisma.tradingSignal.findMany({
      where: {
        disclosure: { rcpDt: { gte: startCompact, lte: endCompactCeil } },
        ...(options.minBuyScore !== undefined
          ? { buyScore: { gte: options.minBuyScore } }
          : {}),
        ...(options.personas?.length ? { persona: { in: options.personas } } : {}),
      },
      select: {
        rcpNo: true,
        corpCode: true,
        stockCode: true,
        eventType: true,
        persona: true,
        buyScore: true,
        disclosure: { select: { rcpDt: true } },
      },
    });

    const signals: DisclosureSignal[] = rows.map((r) => ({
      rcpNo: r.rcpNo,
      corpCode: r.corpCode,
      stockCode: r.stockCode,
      eventType: r.eventType,
      persona: r.persona,
      buyScore: r.buyScore,
      disclosureAt: parseRcpDtToInstant(r.disclosure.rcpDt),
    }));

    // 시간순(발생일 asc) + 동일 시점은 buyScore 내림차순 → 러너의 corpCode 선점에서 고점수 우선.
    signals.sort((a, b) => {
      const t = a.disclosureAt.getTime() - b.disclosureAt.getTime();
      return t !== 0 ? t : b.buyScore - a.buyScore;
    });

    this.logger.log(
      `point-in-time 신호 조립: ${startDate}~${endDate} → ${signals.length}건`,
    );
    return signals;
  }
}
