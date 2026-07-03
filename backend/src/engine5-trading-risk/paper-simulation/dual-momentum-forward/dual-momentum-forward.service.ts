// Engine5 — 듀얼모멘텀 코어 forward 트랙(모의) 월말 리밸런싱 배선 (DAR-494 [견고화 W1·P13])
//
// P16 게이트를 위험조정 기준으로 통과(룰북 §9.3.2)한 코어 트랙(자본 65% 배분·styleTag
// 'alloc:dual-momentum')을 forward(오늘까지의 시세 → 월말 판정 → 익일 시가 체결)로 활성한다.
//
// ★설계(검증된 forward 증축 패턴 계승 + ETF 특성 반영):
//   - 판정: P12 decideMonthlyRebalance(순수 함수) 재사용 — EtfDailyPrice 에서 asOf 절단 bars 주입,
//     252 거래일 룩백. 부수효과 0.
//   - 자산: ETF 4종(360750/069500/153130/273130)은 DART corpCode 가 없어 Position/PaperTrade
//     (→Company FK)에 부적합 → 전용 모델 DualMomentumForwardTrade(FK 없음·IntradayScalpTrade 전례).
//   - 체결: "예약 → 익일 시가(PENDING)" 의미론 재사용. 월말 판정 시 목표 ETF PENDING 매수 예약
//     (entryTradeDate=nextTradingDay). 익일 사이클의 체결기가 **현재 보유 전량 매도(현금 확보) →
//     목표 전량 매수** 순서로 그 날 시가에 집행(단일 자산 100% 배분).
//   - 비용: ETF 프로파일(증권거래세 면제 sellTaxRate=0). 수수료·슬리피지는 개별주 체결 시뮬 동일.
//   - fail-safe: 판정 불가(결측) 시 무행동 + 전월 유지 + P02 OPS_ALERT(월 1회 멱등).
//   - ENFORCE: 킬스위치(REDUCE_ONLY)·현금≥0 불변식은 체결기 경로에서 자동 적용(신규 트랙도 준수).
//
// ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용). AI 금지영역: 판정·사이징·
//   체결 전부 순수 Rule(engine2/AI import 0 — decideMonthlyRebalance 는 engine3 순수 수식).
// ★ 기존 측정 트랙(시스템 모의·전략 forward·분봉 단타) 파일 무수정 — additive 트랙(M10 클록 안전).

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationProducerService } from '../../../notifications/notification-producer.service';
import { KillSwitchManager } from '../../domain/kill-switch';
import { simulateFill, DEFAULT_FILL_PARAMS, roundToTick } from '../../domain/fill-simulator';
import { FillParams } from '../../domain/paper-trade.types';
import { MomentumBar, decideMonthlyRebalance } from '../../../engine3-quant-market/dual-momentum/dual-momentum-signal';
import {
  MOMENTUM_LOOKBACK_DAYS,
  CORE_STYLE_TAG,
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
  CORE_CAPITAL_ALLOCATION_PCT,
  DUAL_MOMENTUM_PRESET,
} from '../../../engine3-quant-market/dual-momentum/dual-momentum.constants';
import {
  nextTradingDay,
  isLastTradingDayOfMonth,
  lastTradingDayOfMonth,
} from '../../../common/time/market-calendar';
import { formatKstDateCompact } from '../../../common/time/kst';
import { etfByCode } from '../../../engine3-quant-market/market-data/etf-universe';
import { PaperSimulationService } from '../paper-simulation.service';
import { buildEquityCurve, EquityCurvePoint } from '../equity-curve';
import { buildTradeRationale, calculateTradeScorecard, TradeScorecard } from '../trade-scorecard';

/** 코어 트랙 독립 가상원금(원) — 기존 forward 트랙 관례 10M, 룰북 §9.2 정합. */
export const DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL = 10_000_000;

/**
 * ETF 체결 파라미터 — 개별주 체결 시뮬과 동일하되 **증권거래세 면제**(sellTaxRate=0).
 * 룰북 §9.3 ETF 비용 프로파일과 정합(수수료·슬리피지는 개별주 동일).
 */
export const ETF_FILL_PARAMS: FillParams = { ...DEFAULT_FILL_PARAMS, sellTaxRate: 0 };

/** 예약 미체결(당일 데이터 결측) 이월 상한 — 초과 시 예약 취소(무한 이월 방지). */
const PENDING_FILL_MAX_CARRY_TRADING_DAYS = 5;

/** 코어 유니버스(모멘텀 판정 입력). */
const CORE_UNIVERSE = [
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
] as const;

/** 청산 표본 과신 방지 임계(월단위 트랙 — 소수). */
export const DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD = 6;

/**
 * 코어 트랙 유형 라벨 SSOT(감사 C2 — 사용자 표면의 유형 구분).
 * 기존 트랙(전략 변형·단타)과 성격이 다른 '자산배분(월단위)' 트랙임을 모바일 카드가 명시한다.
 */
export const CORE_TRACK_TYPE_LABEL = '자산배분(월단위)';

/** 리밸런싱 주기 — 월 1회(매월 마지막 거래일 판정). */
export type RebalanceFrequency = 'MONTHLY';

/** 코어 트랙 한 줄 컨셉(룰북 §9.2 — 월말 절대·상대 모멘텀 배분, 자본 65%). */
export const CORE_TRACK_TAGLINE = `월말 절대·상대 모멘텀으로 공격 ETF·방어채권 배분 (${MOMENTUM_LOOKBACK_DAYS}거래일 룩백·자본 ${Math.round(
  CORE_CAPITAL_ALLOCATION_PCT * 100,
)}%)`;

/**
 * 다음 월말 리밸런싱 판정 예정일(YYYYMMDD) — refYmd(오늘/최근 거래일) 기준. 순수 캘린더(데이터 무참조).
 *
 * 이번 달 마지막 거래일이 아직 오지 않았으면(≥ refYmd) 이번 달, 이미 지났으면 다음 달의 마지막
 * 거래일을 반환한다. 월 1회 리밸런싱 특성(다음 판정일) 표기용 — 실제 판정 발화는 크론이 데이터
 * 주도(당일 ETF 일봉 존재)로 확정하므로, 여기서는 '언제쯤 판정하는지' 안내용 근사치다.
 */
export function nextMonthEndDecisionDate(refYmd: string): string {
  const year = Number(refYmd.slice(0, 4));
  const month = Number(refYmd.slice(4, 6));
  const thisMonthEnd = lastTradingDayOfMonth(year, month);
  if (thisMonthEnd >= refYmd) return thisMonthEnd;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return lastTradingDayOfMonth(nextYear, nextMonth);
}

/** 코어 forward 포트폴리오 이름 — '모의운용 포트폴리오 [alloc:dual-momentum]'(forward 트랙 명명 관례). */
export function dualMomentumForwardPortfolioName(): string {
  return `${PaperSimulationService.SIM_PORTFOLIO_NAME} [${CORE_STYLE_TAG}]`;
}

export type RebalanceOutcome = 'HOLD' | 'SWITCH' | 'SUSPENDED' | 'NOT_MONTH_END';

/** 1일 사이클 실행 요약. */
export interface DualMomentumForwardCycleResult {
  tradeDate: string;
  portfolioId: string;
  /** 이 사이클에 체결된 매수·매도 건수(예약 체결 시 SWITCH 는 2). */
  filled: number;
  rebalance: RebalanceOutcome;
  /** 사이클 후 보유 ETF 코드(현금 보유 시 null). */
  holding: string | null;
  /** 대기 중(미체결) 예약 ETF 코드(있으면). */
  pendingTarget: string | null;
  equity: number;
  message?: string;
}

/** 상태 조회(read-only) — 화면/감사용. */
export interface DualMomentumForwardStatus {
  styleTag: string;
  initialCapital: number;
  holding: string | null;
  pendingTarget: string | null;
  equity: number;
  realizedNetPnl: number;
  cumulativeReturnPct: number;
  closedTrades: number;
  lowSample: boolean;
  lowSampleThreshold: number;
  equityCurve: { snapshotDate: string; totalValue: number }[];
  rebalanceHistory: {
    decisionDate: string;
    etfCode: string;
    status: string;
    entryPrice: number | null;
    exitDate: string | null;
    exitPrice: number | null;
    netPnl: number | null;
    returnPct: number | null;
  }[];
}

/** 리밸런싱(회전) 이력 한 행 — etfName 병기(코드 대신 사람 읽는 이름). */
export interface CoreRebalanceTradeRow {
  decisionDate: string;
  etfCode: string;
  /** ETF 표시 이름(유니버스 매핑, 없으면 null → 코드 대체 표시). */
  etfName: string | null;
  status: string;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  netPnl: number | null;
  returnPct: number | null;
}

/**
 * 코어 트랙 스코어카드(read-only) — 비교 표면/모바일 카드 계약 (DAR-495 [견고화 W1·P17]).
 *
 * 기존 `getStatus`(DAR-494)와 별개 표면(하위호환 유지) — 통일 성적표(trade-scorecard SSOT)를
 * 재사용하고, 월단위 트랙 특성(다음 판정 예정일·유형 라벨·느린 표본 축적 LOW_SAMPLE)을 명시한다.
 */
export interface DualMomentumForwardScorecard {
  styleTag: string;
  /** 유형 라벨(모바일 유형 구분) — '자산배분(월단위)'. */
  trackTypeLabel: string;
  /** 리밸런싱 주기 — 월 1회. */
  rebalanceFrequency: RebalanceFrequency;
  /** 한 줄 컨셉(룰북 §9.2). */
  tagline: string;
  initialCapital: number;
  /** 현재 보유 ETF 코드(현금이면 null). */
  holding: string | null;
  /** 현재 보유 ETF 표시 이름(현금이면 null). */
  holdingName: string | null;
  /** 대기 중(미체결) 예약 ETF 코드(있으면). */
  pendingTarget: string | null;
  /** 대기 중 예약 ETF 표시 이름(없으면 null). */
  pendingTargetName: string | null;
  /** 평가액(원). */
  equity: number;
  /** 누적 수익률(%) — 평가액 기준(미실현 포함). */
  cumulativeReturnPct: number;
  /** 통일 성적표(승률·평균손익·표본·lowSample) — trade-scorecard SSOT 재사용. */
  scorecard: TradeScorecard;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게 그대로). */
  equityCurve: EquityCurvePoint[];
  /** 마지막 스냅샷일(YYYYMMDD, 없으면 null). */
  latestSnapshotDate: string | null;
  /** 리밸런싱(회전) 이력. */
  rebalanceHistory: CoreRebalanceTradeRow[];
  /** 다음 월말 판정 예정일(YYYYMMDD) — 월 1회 리밸런싱 특성. */
  nextDecisionDate: string;
  /** 과신 방지 — 청산 표본 < 트랙 임계(월단위 트랙 느린 축적). */
  lowSample: boolean;
  /** 저표본 임계(청산 거래 수) — 라벨/문구 표기용. */
  lowSampleThreshold: number;
}

/** EtfDailyPrice 한 행(내부 조회 결과 정규화). */
interface EtfBar {
  tradeDate: string;
  open: number;
  close: number;
}

@Injectable()
export class DualMomentumForwardService {
  private readonly logger = new Logger(DualMomentumForwardService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    // @Optional — 큐/모듈 미주입(단위 테스트)에서도 안전. fail-safe OPS_ALERT 발행용.
    @Optional() private readonly notifyProducer?: NotificationProducerService,
    // @Optional — 미주입(단위 테스트)이면 비활성 폴백. 발동 시 REDUCE_ONLY(신규 매수 차단·매도 허용).
    @Optional() private readonly killSwitch?: KillSwitchManager,
  ) {}

  // ─── 포트폴리오 find-or-create (시스템 유저 — 타 forward 트랙과 동일) ─────
  async getOrCreatePortfolio(): Promise<{ id: string }> {
    let user = await this.prisma.user.findFirst({
      where: { email: PaperSimulationService.SIM_USER_EMAIL },
      select: { id: true },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: PaperSimulationService.SIM_USER_EMAIL, provider: 'system' },
        select: { id: true },
      });
    }
    const name = dualMomentumForwardPortfolioName();
    let pf = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name },
      select: { id: true },
    });
    if (!pf) {
      pf = await this.prisma.portfolio.create({
        data: { userId: user.id, name, maxSinglePositionPct: 100 },
        select: { id: true },
      });
    }
    return pf;
  }

  // ─── 1일 사이클 (수동 run-once / Cron 공통 진입점) ────────────────────────
  async runDailyCycle(tradeDate: string): Promise<DualMomentumForwardCycleResult> {
    if (this.isRunning) {
      this.logger.warn('[DualMomFwd] 이전 사이클 진행 중 — 스킵');
      const holding = await this.currentOpenHolding();
      return {
        tradeDate,
        portfolioId: '',
        filled: 0,
        rebalance: 'NOT_MONTH_END',
        holding: holding?.etfCode ?? null,
        pendingTarget: null,
        equity: await this.computeEquity(tradeDate),
        message: '이전 사이클 진행 중',
      };
    }
    this.isRunning = true;
    try {
      const pf = await this.getOrCreatePortfolio();

      // 0) 만기 도래 예약(익일 시가) 체결 — 매도(현금 확보) 후 매수 순서.
      const { filled } = await this.fillDuePending(pf.id, tradeDate);

      // 1) 월말 거래일이면 판정 → 익일 예약. (nest cron 'L' 미지원 → 매일 발화 후 P09 게이트.)
      let rebalance: RebalanceOutcome = 'NOT_MONTH_END';
      if (isLastTradingDayOfMonth(tradeDate)) {
        // ★데이터 주도 가드: 오늘 유니버스 ETF 일봉이 실재할 때만 판정한다(휴장 오발화 방지).
        //   forward 에선 actualTradingDays 를 lastTradingDayOfMonth 에 넘기면 "당일까지 수집분"이라
        //   매일 max=오늘 → 상시 true 로 오발화한다. 그래서 판정일 확정은 P09 캘린더(휴장일 SSOT)를
        //   쓰고, '오늘이 실거래일인지'는 당일 데이터 존재로 확인한다(둘의 조합 = 안전한 forward 게이트).
        const todayBar = await this.etfBarOn(CORE_OFFENSE_DOMESTIC_CODE, tradeDate);
        if (todayBar) {
          rebalance = await this.decideAndReserve(pf.id, tradeDate);
        } else {
          this.logger.log(`[DualMomFwd] 월말(${tradeDate}) 이나 당일 ETF 데이터 없음 — 판정 보류`);
        }
      }

      // 2) 일일 평가 스냅샷(자산곡선).
      const equity = await this.computeEquity(tradeDate);
      await this.snapshotEquity(pf.id, tradeDate, equity);

      const holding = await this.currentOpenHolding();
      const pending = await this.currentPending();
      this.logger.log(
        `[DualMomFwd] date=${tradeDate} 체결=${filled} 리밸=${rebalance} 보유=${holding?.etfCode ?? '현금'} 평가=${Math.round(equity)}`,
      );
      return {
        tradeDate,
        portfolioId: pf.id,
        filled,
        rebalance,
        holding: holding?.etfCode ?? null,
        pendingTarget: pending?.etfCode ?? null,
        equity,
      };
    } catch (e) {
      this.logger.error(`[DualMomFwd] 사이클 오류: ${(e as Error).message}`);
      return {
        tradeDate,
        portfolioId: '',
        filled: 0,
        rebalance: 'NOT_MONTH_END',
        holding: null,
        pendingTarget: null,
        equity: DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
        message: (e as Error).message,
      };
    } finally {
      this.isRunning = false;
    }
  }

  // ─── 예약 체결기: 매도(현금 확보) → 매수 (익일 시가) ──────────────────────
  private async fillDuePending(
    portfolioId: string,
    tradeDate: string,
  ): Promise<{ filled: number }> {
    const pendings = await this.prisma.dualMomentumForwardTrade.findMany({
      where: { styleTag: CORE_STYLE_TAG, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    let filled = 0;

    for (const p of pendings) {
      if (p.entryTradeDate > tradeDate) continue; // 아직 체결 예정일 전
      // 이월 상한 초과 → 예약 취소(무한 이월 방지).
      if (this.tradingDaysBetween(p.entryTradeDate, tradeDate) > PENDING_FILL_MAX_CARRY_TRADING_DAYS) {
        await this.cancelTrade(p.id, '이월 상한 초과');
        continue;
      }
      const targetBar = await this.etfBarOn(p.etfCode, tradeDate);
      if (!targetBar) continue; // 당일 목표 시세 없음 → 이월(스테일 체결 금지)

      const holding = await this.currentOpenHolding();
      // 목표 == 현재 보유 → 회전 불필요(예약 취소·무행동).
      if (holding && holding.etfCode === p.etfCode) {
        await this.cancelTrade(p.id, '목표 == 현재 보유');
        continue;
      }

      const killActive = this.killSwitch?.isActive() ?? false;

      // 1) 매도(현재 보유 전량) — 현금 확보.
      if (holding) {
        const holdBar = await this.etfBarOn(holding.etfCode, tradeDate);
        if (!holdBar) continue; // 보유 시세 없음 → 블라인드 매도 금지(이월).
        const sell = simulateFill(
          { direction: 'SELL', orderedShares: holding.shares, entryPrice: holdBar.open, liquidityRatio: 1 },
          ETF_FILL_PARAMS,
        );
        const entryPrice = Number(holding.entryPrice ?? 0);
        const entryVal = entryPrice * holding.shares;
        const buyComm = Number(holding.commission ?? 0); // 진입 시 적재한 매수 수수료
        const grossPnl = (sell.filledPrice - entryPrice) * sell.filledShares;
        const netPnl = grossPnl - buyComm - sell.commission - sell.tax;
        const returnPct = entryVal > 0 ? (netPnl / entryVal) * 100 : 0;
        await this.prisma.dualMomentumForwardTrade.update({
          where: { id: holding.id },
          data: {
            status: 'CLOSED',
            exitTs: new Date(),
            exitDate: tradeDate,
            exitPrice: sell.filledPrice,
            commission: buyComm + sell.commission,
            tax: sell.tax,
            slippage: Number(holding.slippage ?? 0) + sell.slippageCost,
            grossPnl,
            netPnl,
            returnPct,
          },
        });
        filled++;
      }

      // 킬스위치 발동(REDUCE_ONLY): 매도(축소)만 하고 신규 매수는 차단 → 현금 보유.
      if (killActive) {
        await this.cancelTrade(p.id, '킬스위치 REDUCE_ONLY — 매수 보류(현금 보유)');
        this.logger.warn('[DualMomFwd][체결기] 킬스위치 발동 — 매도만 집행·매수 예약 취소');
        continue;
      }

      // 2) 매수(목표 전량) — 매도 후 가용현금 전량 투입(단일 자산 100% 배분).
      const cash = await this.computeCash(); // 매도로 보유 없음 → cash = 초기 + 실현
      const open = targetBar.open;
      const effBuy = roundToTick(open * (1 + ETF_FILL_PARAMS.slippagePct), 'BUY');
      const perShareCost = effBuy * (1 + ETF_FILL_PARAMS.commissionRate);
      const shares = perShareCost > 0 ? Math.floor(cash / perShareCost) : 0;
      if (shares <= 0) {
        await this.cancelTrade(p.id, '가용현금 부족 — 매수 불가');
        continue;
      }
      const buy = simulateFill(
        { direction: 'BUY', orderedShares: shares, entryPrice: open, liquidityRatio: 1 },
        ETF_FILL_PARAMS,
      );
      if (buy.filledShares <= 0) {
        await this.cancelTrade(p.id, '매수 체결 0');
        continue;
      }
      await this.prisma.dualMomentumForwardTrade.update({
        where: { id: p.id },
        data: {
          status: 'OPEN',
          entryTs: new Date(),
          entryPrice: buy.filledPrice,
          shares: buy.filledShares,
          commission: buy.commission,
          slippage: buy.slippageCost,
        },
      });
      filled++;
    }
    return { filled };
  }

  // ─── 월말 판정 → 익일 매수 예약 ───────────────────────────────────────────
  private async decideAndReserve(portfolioId: string, tradeDate: string): Promise<RebalanceOutcome> {
    const [barsA, barsB, barsT] = await Promise.all([
      this.momentumBarsAsOf(CORE_OFFENSE_INTL_CODE, tradeDate),
      this.momentumBarsAsOf(CORE_OFFENSE_DOMESTIC_CODE, tradeDate),
      this.momentumBarsAsOf(CORE_ABS_MOMENTUM_FILTER_CODE, tradeDate),
    ]);
    const holding = await this.currentOpenHolding();
    const decision = decideMonthlyRebalance(barsA, barsB, barsT, holding?.etfCode ?? null, MOMENTUM_LOOKBACK_DAYS);

    if (decision.suspended || decision.target === null) {
      // fail-safe: 판정 불가(결측) → 무행동 + 전월 유지 + OPS_ALERT(월 1회 멱등).
      await this.emitSuspendedAlert(tradeDate, decision.detail);
      this.logger.warn(`[DualMomFwd] 판정 보류(${tradeDate}): ${decision.detail}`);
      return 'SUSPENDED';
    }
    if (decision.action === 'HOLD') {
      this.logger.log(`[DualMomFwd] HOLD(${tradeDate}) 목표=${decision.target} == 현재 보유`);
      return 'HOLD';
    }

    // SWITCH — 목표 ETF 익일 시가 매수 예약(체결기가 매도→매수 순서로 집행).
    // 멱등: 같은 판정일의 예약이 이미 있으면 재생성 금지(재실행 안전).
    const existing = await this.prisma.dualMomentumForwardTrade.findFirst({
      where: { styleTag: CORE_STYLE_TAG, status: 'PENDING', decisionDate: tradeDate },
      select: { id: true },
    });
    if (existing) return 'SWITCH';
    // 미체결 잔여 예약(전월 이월 등) 정리 — 최신 판정만 유효.
    await this.prisma.dualMomentumForwardTrade.updateMany({
      where: { styleTag: CORE_STYLE_TAG, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    const reservedPrice = (await this.etfCloseAsOf(decision.target, tradeDate)) ?? 0;
    // 명목 수량(사이징 근거·리포트용) — 체결기는 매도 후 실가용현금 전량으로 재산정한다.
    const projected = await this.computeEquity(tradeDate);
    const reservedShares = reservedPrice > 0 ? Math.floor((projected * 0.999) / reservedPrice) : 0;
    await this.prisma.dualMomentumForwardTrade.create({
      data: {
        etfCode: decision.target,
        styleTag: CORE_STYLE_TAG,
        status: 'PENDING',
        decisionDate: tradeDate,
        entryTradeDate: nextTradingDay(tradeDate),
        reservedShares,
        reservedPrice,
      },
    });
    this.logger.log(
      `[DualMomFwd] SWITCH(${tradeDate}) ${holding?.etfCode ?? '현금'} → ${decision.target} 예약(익일 시가)`,
    );
    return 'SWITCH';
  }

  // ─── 평가·현금·스냅샷 ─────────────────────────────────────────────────────
  /** 현금(원) = 초기자본 + 실현손익(CLOSED net) − 보유 진입원가(진입금액 + 매수수수료). */
  private async computeCash(): Promise<number> {
    const realized = await this.realizedNetPnl();
    const open = await this.currentOpenHolding();
    const openCost = open
      ? Number(open.entryPrice ?? 0) * open.shares + Number(open.commission ?? 0)
      : 0;
    return DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL + realized - openCost;
  }

  /** 평가액(원) = 초기자본 + 실현손익 + 미실현(보유 종가 마크 − 진입 − 매수수수료). */
  async computeEquity(tradeDate: string): Promise<number> {
    const realized = await this.realizedNetPnl();
    const open = await this.currentOpenHolding();
    if (!open) return DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL + realized;
    const entryPrice = Number(open.entryPrice ?? 0);
    const mark = (await this.etfCloseAsOf(open.etfCode, tradeDate)) ?? entryPrice;
    const unrealized = (mark - entryPrice) * open.shares - Number(open.commission ?? 0);
    return DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL + realized + unrealized;
  }

  private async realizedNetPnl(): Promise<number> {
    const closed = await this.prisma.dualMomentumForwardTrade.findMany({
      where: { styleTag: CORE_STYLE_TAG, status: 'CLOSED' },
      select: { netPnl: true },
    });
    return closed.reduce((s, r) => s + Number(r.netPnl ?? 0), 0);
  }

  private async snapshotEquity(portfolioId: string, tradeDate: string, equity: number): Promise<void> {
    const unrealizedPnl = equity - DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL;
    const cumulativeReturnPct = (unrealizedPnl / DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL) * 100;
    await this.prisma.portfolioRiskSnapshot.upsert({
      where: { portfolioId_snapshotDate: { portfolioId, snapshotDate: tradeDate } },
      create: {
        portfolioId,
        snapshotDate: tradeDate,
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: cumulativeReturnPct,
        topPositionPct: 0,
        openPositionCount: (await this.currentOpenHolding()) ? 1 : 0,
        riskLevel: 'NORMAL',
      },
      update: {
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: cumulativeReturnPct,
      },
    });
  }

  // ─── 상태 조회(read-only) ─────────────────────────────────────────────────
  async getStatus(): Promise<DualMomentumForwardStatus> {
    const pf = await this.getOrCreatePortfolio();
    const holding = await this.currentOpenHolding();
    const pending = await this.currentPending();
    const tradeDate = await this.latestTradeDate();
    const equity = await this.computeEquity(tradeDate);
    const realized = await this.realizedNetPnl();

    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const closedRows = await this.prisma.dualMomentumForwardTrade.findMany({
      where: { styleTag: CORE_STYLE_TAG, status: { in: ['OPEN', 'CLOSED'] } },
      orderBy: { decisionDate: 'asc' },
    });
    const closedCount = closedRows.filter((r) => r.status === 'CLOSED').length;

    return {
      styleTag: CORE_STYLE_TAG,
      initialCapital: DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
      holding: holding?.etfCode ?? null,
      pendingTarget: pending?.etfCode ?? null,
      equity,
      realizedNetPnl: realized,
      cumulativeReturnPct:
        ((equity - DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL) / DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL) * 100,
      closedTrades: closedCount,
      lowSample: closedCount < DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD,
      lowSampleThreshold: DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD,
      equityCurve: snapshots.map((s) => ({ snapshotDate: s.snapshotDate, totalValue: s.totalValue })),
      rebalanceHistory: closedRows.map((r) => ({
        decisionDate: r.decisionDate,
        etfCode: r.etfCode,
        status: r.status,
        entryPrice: r.entryPrice !== null ? Number(r.entryPrice) : null,
        exitDate: r.exitDate,
        exitPrice: r.exitPrice !== null ? Number(r.exitPrice) : null,
        netPnl: r.netPnl !== null ? Number(r.netPnl) : null,
        returnPct: r.returnPct !== null ? Number(r.returnPct) : null,
      })),
    };
  }

  // ─── 스코어카드 조회(read-only, DAR-495 [견고화 W1·P17]) ──────────────────
  /**
   * 코어 트랙 스코어카드 — 자산곡선·누적수익·거래 이력·현재 보유·다음 판정 예정일을
   * 통일 성적표(trade-scorecard SSOT)와 함께 반환한다. read-only(신규 수집·체결·AI 0).
   *
   * ★ getStatus(DAR-494)와 별개 표면 — 기존 응답 무변경(하위호환). 통일 정의 재사용:
   *   buildEquityCurve(자산곡선)·calculateTradeScorecard(승률·평균손익·표본). LOW_SAMPLE 은
   *   월단위 트랙 임계(=6, 느린 표본 축적)로 정직 표기한다.
   */
  async getScorecard(): Promise<DualMomentumForwardScorecard> {
    const pf = await this.getOrCreatePortfolio();
    const holding = await this.currentOpenHolding();
    const pending = await this.currentPending();
    const tradeDate = await this.latestTradeDate();
    const equity = await this.computeEquity(tradeDate);

    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    const equityCurve = buildEquityCurve(snapshots, DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL);

    const rows = await this.prisma.dualMomentumForwardTrade.findMany({
      where: { styleTag: CORE_STYLE_TAG, status: { in: ['OPEN', 'CLOSED'] } },
      orderBy: { decisionDate: 'asc' },
    });

    // 통일 성적표: CLOSED 회전을 trade-scorecard 정의(승률·평균손익·누적수익률)로 집계.
    // ETF 는 corpCode 가 없어 stockCode 자리에 etfCode 를 넣고 corpCode 는 빈 문자열(표시 미사용).
    const closedRationales = rows
      .filter((r) => r.status === 'CLOSED')
      .map((r) =>
        buildTradeRationale({
          positionId: r.id,
          corpCode: '',
          stockCode: r.etfCode,
          corpName: etfByCode(r.etfCode)?.name ?? null,
          status: 'CLOSED',
          // CLOSED 는 항상 진입 체결(entryTs) 후이지만, 방어적으로 예약생성일(createdAt) 폴백.
          entryDate: r.entryTs ?? r.createdAt,
          entryPrice: r.entryPrice !== null ? Number(r.entryPrice) : 0,
          quantity: r.shares,
          closedAt: r.exitTs,
          pnl: r.netPnl !== null ? Number(r.netPnl) : 0,
          pnlPct: r.returnPct !== null ? Number(r.returnPct) : 0,
          stopLossPct: null,
          takeProfitPct: null,
          maxHoldDays: null,
          entryReason: null,
          initialThesis: null,
          exitAction: null,
          exitTriggers: [],
        }),
      );
    const scorecard = calculateTradeScorecard(
      closedRationales,
      DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
    );

    return {
      styleTag: CORE_STYLE_TAG,
      trackTypeLabel: CORE_TRACK_TYPE_LABEL,
      rebalanceFrequency: 'MONTHLY',
      tagline: CORE_TRACK_TAGLINE,
      initialCapital: DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
      holding: holding?.etfCode ?? null,
      holdingName: holding ? (etfByCode(holding.etfCode)?.name ?? null) : null,
      pendingTarget: pending?.etfCode ?? null,
      pendingTargetName: pending ? (etfByCode(pending.etfCode)?.name ?? null) : null,
      equity,
      cumulativeReturnPct:
        ((equity - DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL) /
          DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL) *
        100,
      scorecard,
      equityCurve,
      latestSnapshotDate:
        equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].snapshotDate : null,
      rebalanceHistory: rows.map((r) => ({
        decisionDate: r.decisionDate,
        etfCode: r.etfCode,
        etfName: etfByCode(r.etfCode)?.name ?? null,
        status: r.status,
        entryPrice: r.entryPrice !== null ? Number(r.entryPrice) : null,
        exitDate: r.exitDate,
        exitPrice: r.exitPrice !== null ? Number(r.exitPrice) : null,
        netPnl: r.netPnl !== null ? Number(r.netPnl) : null,
        returnPct: r.returnPct !== null ? Number(r.returnPct) : null,
      })),
      // 다음 판정 예정일은 '오늘(KST)' 기준 — 데이터가 아닌 캘린더 스케줄(월 1회 안내).
      nextDecisionDate: nextMonthEndDecisionDate(formatKstDateCompact(new Date())),
      lowSample: scorecard.sampleSize < DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD,
      lowSampleThreshold: DUAL_MOMENTUM_FORWARD_LOW_SAMPLE_THRESHOLD,
    };
  }

  // ─── 조회 헬퍼 ────────────────────────────────────────────────────────────
  private currentOpenHolding() {
    return this.prisma.dualMomentumForwardTrade.findFirst({
      where: { styleTag: CORE_STYLE_TAG, status: 'OPEN' },
    });
  }

  private currentPending() {
    return this.prisma.dualMomentumForwardTrade.findFirst({
      where: { styleTag: CORE_STYLE_TAG, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** code 의 tradeDate 정확 일치 바(체결용 시가). 없으면 null. */
  private async etfBarOn(etfCode: string, tradeDate: string): Promise<EtfBar | null> {
    const row = await this.prisma.etfDailyPrice.findFirst({
      where: { etfCode, tradeDate },
      select: { tradeDate: true, openPrice: true, closePrice: true },
    });
    if (!row || row.openPrice <= 0) return null;
    return { tradeDate: row.tradeDate, open: row.openPrice, close: row.closePrice };
  }

  /** code 의 tradeDate 이하 마지막 종가(carry-forward 마크). 없으면 null. */
  private async etfCloseAsOf(etfCode: string, tradeDate: string): Promise<number | null> {
    const row = await this.prisma.etfDailyPrice.findFirst({
      where: { etfCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: { closePrice: true },
    });
    return row ? row.closePrice : null;
  }

  /** code 의 tradeDate 이하 종가 배열(asOf 절단, 오름차순) — 모멘텀 판정 입력. */
  private async momentumBarsAsOf(etfCode: string, tradeDate: string): Promise<MomentumBar[]> {
    const rows = await this.prisma.etfDailyPrice.findMany({
      where: { etfCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'asc' },
      select: { closePrice: true },
    });
    return rows.map((r) => ({ close: r.closePrice }));
  }

  /** 유니버스 전체에서 가장 최근 거래일(상태 조회 마크 기준). 없으면 today(KST). */
  private async latestTradeDate(): Promise<string> {
    const row = await this.prisma.etfDailyPrice.findFirst({
      where: { etfCode: { in: [...CORE_UNIVERSE] } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return row?.tradeDate ?? '99999999';
  }

  private async cancelTrade(id: string, reason: string): Promise<void> {
    await this.prisma.dualMomentumForwardTrade.update({ where: { id }, data: { status: 'CANCELLED' } });
    this.logger.warn(`[DualMomFwd] 예약 취소(${reason}) trade=${id}`);
  }

  /** from~to 사이 거래일 수(nextTradingDay 반복). 이월 상한 판정용. */
  private tradingDaysBetween(fromYmd: string, toYmd: string): number {
    if (fromYmd >= toYmd) return 0;
    let d = fromYmd;
    let n = 0;
    // 안전 상한(과도 루프 방지) — 60 거래일 이상이면 그대로 상한 초과 취급.
    while (d < toYmd && n < 60) {
      d = nextTradingDay(d);
      n++;
    }
    return n;
  }

  /** fail-safe OPS_ALERT — 판정 결측(월 1회 멱등). notifyProducer 미주입 시 no-op. */
  private async emitSuspendedAlert(tradeDate: string, detail: string): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      await this.notifyProducer.enqueueOpsAlert(
        'WARNING',
        'dual-momentum-forward',
        `듀얼모멘텀 코어 forward 월말 판정 보류(${tradeDate}) — ${detail}. 전월 포지션 유지(무주문).`,
        {
          dedupeKey: `dual-momentum-forward:suspended:${tradeDate}`,
          deepLink: '/portfolio',
          data: { tradeDate, styleTag: CORE_STYLE_TAG },
        },
      );
    } catch (e) {
      this.logger.error(`[DualMomFwd] OPS_ALERT 발행 실패(무시): ${(e as Error).message}`);
    }
  }
}
