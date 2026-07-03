/**
 * PaperSimulationService — 일일 모의운용 오케스트레이터 (M10 모의운용, DAR-40)
 *
 * ★장외 체결 의미론(2026-07 정정): "19:30 = 주문 결정, 익일 개장 = 체결".
 *   장 마감 후 사이클이 당일 종가로 즉시 체결하면 정보시점>가격시점 상향 편향이 생긴다
 *   (진단: 매수 78.8%가 장외 즉시 체결, 개장 직후 손절 평균 -14.99% = 갭 리스크 실재).
 *   엔진 정본 규칙("다음거래일 시가 진입")·백테스트 규칙(익일 시가)과 일치하도록:
 *
 * 한 사이클(장마감 후 19:30):
 *   0) 만기 도래한 매수 예약(PENDING PaperTrade)·이연 청산 판정 → '당일 시가'로 체결
 *      (장중이면 09:00~ 장중 모니터 첫 유효 틱이 먼저 체결 — 여기는 폴백 경로)
 *   1) 신규 BUY 후보 → 매수 '예약'(PENDING PaperTrade, entryDate=다음 거래일 — 즉시 체결 금지)
 *   2) 보유 포지션 일일 시가평가 → PositionDailySnapshot 적재
 *   3) 보유 포지션 Exit Score 평가 → 트리거 시 판정·기록만(ExitSignal deferredFill) — 체결은
 *      익일 시가로 이연(갭다운 정직 반영). 장중 실효 손절은 장중 모니터가 즉시 체결(변경 없음).
 *   4) 누적 졸업지표 산출(적중률 D+5·누적수익·Exit정확도 D+3·AI비용/순익) → PortfolioRiskSnapshot
 *
 * ★ 모의 전용 — 실주문 절대 금지(OrderRequest/OrderExecution 미사용, M11 미진입).
 * AI 금지영역: 매수점수·Exit·체결은 순수 Rule(engine3/4 + fill-simulator). engine2/AI import 0.
 * 스키마 변경 0 — 기존 모델(Portfolio·Position·PositionDailySnapshot·PaperTrade·ExitSignal·
 *   PortfolioRiskSnapshot) 재사용. 예약은 PaperTrade 의 기존 PENDING status + entryDate(체결
 *   예정 거래일) + styleTag('paper-simulation' 네임스페이스)로 표현 — 신규 컬럼 0.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KillSwitchManager } from '../domain/kill-switch';
import {
  formatKstDateCompact,
  isKstRegularMarketHours,
  kstMonthStart,
} from '../../common/time/kst';
import { KisApiService } from '../../engine3-quant-market/market-data/kis-api.service';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';
import { PaperTradeService } from '../services/paper-trade.service';
import { DEFAULT_FILL_PARAMS, roundToTick, simulateFill } from '../domain/fill-simulator';
// 시장 캘린더 순수 함수(주말·KRX 공휴일) — 익일 시가 체결 예약일 산정에 재사용(서비스 호출 아님).
import { nextTradingDay } from '../../engine3-quant-market/event-study/utils/d0-calculator';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { RiskGuardService } from '../services/risk-guard.service';
import { OrderShadowLedgerService } from '../services/order-shadow-ledger.service';
import { PrismaExitSignalRepository } from '../../engine4-portfolio-exit/repositories/prisma-exit-signal.repository';
import {
  calculateExitScore,
  HIGH_RISK_EVENT_TYPES,
} from '../../engine4-portfolio-exit/domain/exit-score.calculator';
import {
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
  DisclosureEvent,
} from '../../engine4-portfolio-exit/domain/exit-engine.types';
import {
  calculateSimulationMetrics,
  SimulationMetrics,
  SignalOutcome,
  ExitOutcome,
} from './simulation-metrics';
import {
  toSimPositionDetail,
  dedupeOpenPositionRows,
  SimPositionDetail,
} from './simulation-positions';
import {
  SIM_MIN_ENTRY_GRADE,
  entryEligibleGrades,
  entryBudgetScored,
  buildEntryMeta,
  dedupeCandidatesByCorpCode,
  sectorHeadroomBudget,
  ENTRY_FALLBACK_MIN_BUY_SCORE,
} from './simulation-entry';
import { Prisma } from '@prisma/client';
import { SimulationPriceSourceService, SimPriceRow } from './simulation-price-source.service';
import { buildEquityCurve, withLivePoint, EquityCurvePoint } from './equity-curve';
import {
  buildTradeRationale,
  calculateTradeScorecard,
  calculateScorecardByDimension,
  DimensionScorecard,
  TradeRationale,
  TradeRationaleInput,
  TradeScorecard,
} from './trade-scorecard';

export interface DailyCycleResult {
  tradeDate: string;
  /** 이번 사이클에 '당일 시가'로 체결된 매수 수(이전 예약분 체결 — 장중 모니터 미체결 폴백). */
  bought: number;
  /** 이번 사이클에 새로 예약된 매수 주문 수(PENDING, 익일 시가 체결 예정). */
  reserved: number;
  snapshotted: number;
  /** 이번 사이클에 '당일 시가'로 체결된 매도 수(이연 청산 체결 — 장중 모니터 미체결 폴백). */
  exited: number;
  /** 이번 사이클에 새로 기록된 이연 청산 판정 수(체결은 익일 시가 — 갭 정직 반영). */
  exitDeferred: number;
  /** DAR-135·DAR-139: 이번 사이클에 현재-소스(실가|합성) 종가로 재기준한 레거시 포지션 수
   *  (합성/하이브리드 모드에서만 >0, REAL 기본·미주입은 항상 0). */
  rebased: number;
  openPositions: number;
  equity: number;
  metrics: SimulationMetrics;
  message?: string;
}

/** DAR-429: 시스템 모의 클린 리셋 결과(삭제 건수 + 리셋 후 불변식 확인값). */
export interface SimulationResetResult {
  portfolioId: string;
  deletedPositions: number;
  /** Position 삭제로 캐스케이드된 일일 스냅샷 수(삭제 직전 카운트). */
  deletedDailySnapshots: number;
  /** Position 삭제로 캐스케이드된 Exit 신호 수(삭제 직전 카운트). */
  deletedExitSignals: number;
  /** sim 포지션 thesis 에 연결된 PaperTrade 원장 삭제 수. */
  deletedPaperTrades: number;
  /** 시스템 모의 네임스페이스(styleTag)의 매수 예약(PENDING) 삭제 수 — 리셋 후 예약이
   *  익일 시가 체결로 되살아나 오염 이력을 재생성하는 것을 방지. */
  deletedPendingEntries: number;
  deletedRiskSnapshots: number;
  deletedFunnelDaily: number;
  /** 리셋 후 가용현금(불변식: = INITIAL_CAPITAL). */
  cashAfter: number;
  /** 리셋 후 OPEN 포지션 수(불변식: = 0). */
  openPositionsAfter: number;
}

const EXIT_ACTIONS = new Set(['EXIT', 'BLOCK_REBUY']);

/**
 * F1(2026-06-26): 두 YYYYMMDD 사이의 '거래일(월~금) 차'. 금→월=1(주말 흡수), 같은날=0.
 * 장중 실시간 손절의 'REAL 일봉 신선도' 판정에 쓴다. 달력일이 아니라 거래일로 계산해야
 * 금→월(달력 3일)·연휴 직후가 가드를 오발동(실시간 손절 억제)시키지 않는다.
 * (공휴일 미반영 — 거래일수를 과대평가하는 보수 방향이라 신선도 가드엔 안전.)
 * 명백한 정체(달력 14일 초과)는 루프 회피 위해 999 반환.
 */
export function tradingDayDiff(earlierYmd: string, laterYmd: string): number {
  const toUtc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const a = toUtc(earlierYmd);
  const b = toUtc(laterYmd);
  const calDays = Math.round((b - a) / 86_400_000);
  if (calDays <= 0) return 0;
  if (calDays > 14) return 999;
  let count = 0;
  for (let i = 1; i <= calDays; i++) {
    const dow = new Date(a + i * 86_400_000).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

@Injectable()
export class PaperSimulationService {
  private readonly logger = new Logger(PaperSimulationService.name);
  private isRunning = false;
  // DAR-366: 장중 손절 모니터 단일 실행 락 — N분 cron 이 능동 fetch+평가가 길어져 겹치면
  //   KIS rate-limit·중복 매도 위험. 진행 중이면 이번 틱을 건너뛴다(일일 사이클 isRunning 과 분리).
  private isIntradayRunning = false;

  static readonly SIM_USER_EMAIL = 'paper-sim@system.local';
  static readonly SIM_PORTFOLIO_NAME = '모의운용 포트폴리오';
  static readonly INITIAL_CAPITAL = 10_000_000; // 초기 가상원금 1천만원
  static readonly MAX_HOLDINGS = 50;
  static readonly USD_TO_KRW = 1380;
  static readonly DEFAULT_STOP_LOSS_PCT = 8;
  static readonly DEFAULT_TAKE_PROFIT_PCT = 20;
  static readonly DEFAULT_MAX_HOLD_DAYS = 20;
  // F2(2026-06-27): 익절 도달 시 부분 스케일아웃 매도 비율(잔량은 계속 보유). floor 적용 —
  //   잔량이 1주 미만이 되는 소량 포지션은 전량 청산으로 폴백(partial 판정에서 제외).
  static readonly TAKE_PROFIT_SCALE_OUT_FRACTION = 0.5;
  // F1(2026-06-26): 장중 실시간 손절 한정 — 진입소스(REAL) 일봉이 실시간 날짜 대비 며칠(거래일)까지
  //   지연돼야 '신선'으로 보고 실시간 하락을 신뢰할지. 이하면 실시간 손절 발화, 초과(정체 일봉)면
  //   DAR-433 정렬로 폴백(가짜손절 차단). 거래일 기준이라 금→월(1)·연휴가 가드를 오발동시키지 않음.
  static readonly INTRADAY_REAL_FRESH_MAX_DAYS = 2;
  // DAR-424 체결 알림 — 트랙 식별·딥링크 상수(시스템 모의).
  // DAR-431: 딥링크를 포트폴리오 루트(`/portfolio`)에서 ★시스템 모의 서브탭(`?tab=sim`)으로
  //   고정해 체결 알림 탭이 해당 트랙 보유·성과로 직행한다(루트 폴백 제거). 화이트리스트는
  //   `/portfolio` prefix 로 쿼리(`?`)까지 허용(@utils/deeplink.isAllowedDeepLink).
  static readonly TRADE_STRATEGY_KEY = 'paper-simulation';
  static readonly TRADE_STRATEGY_LABEL = '시스템 모의';
  static readonly TRADE_DEEP_LINK = '/portfolio?tab=sim';
  // 장외 체결 의미론(2026-07): 매수 예약(PENDING)이 당일 시가 데이터 부재로 체결되지 못하면
  //   다음 거래일로 이월한다. 예약 체결 예정일로부터 이 거래일 수를 초과하면 취소(무한 이월 방지).
  static readonly PENDING_ENTRY_MAX_CARRY_TRADING_DAYS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paperTrade: PaperTradeService,
    // DAR-85: 청산 권고 시점에 NOTIFY 큐로 enqueue(엔진 직접 발송 금지).
    // @Optional — 큐/모듈 미주입 환경에서도 안전. ★권고일 뿐 실주문 직결 아님.
    @Optional()
    private readonly notifyProducer?: NotificationProducerService,
    // DAR-124: 시세 소스 추상화(실데이터 vs 결정적 합성). @Optional — 미주입 환경(기존 테스트)은
    // 종전대로 StockDailyPrice 직접 읽기로 폴백(회귀 0). 합성 모드는 플래그로만 활성.
    @Optional()
    private readonly priceSource?: SimulationPriceSourceService,
    // DAR-366: 장중 손절 모니터의 '능동 fetch'용 KIS 현재가 조회. @Optional — 미주입/키 미설정이면
    //   능동 fetch no-op(캐시에 남은 값만 사용). 시세 수집 primitive(engine3·market-data) — AI 무관.
    @Optional()
    private readonly kis?: KisApiService,
    // DAR-366: 능동 fetch 한 실시간가를 적재할 전역 캐시(@Global). 미주입이면 fetch 결과를 적재하지
    //   못하므로 능동 fetch 비활성(평가는 priceSource 폴백). evaluateExits 가 이 캐시를 실가 1순위로 읽는다.
    @Optional()
    private readonly realtimeCache?: RealtimeQuoteCache,
    // ★F6(2026-06-27): kill-switch 영속 상태(TradingRiskModule 공유 싱글톤). 운영자가 발동하면
    //   시스템 모의 신규 진입을 차단한다(F5 단타와 동일 보장 — kill-switch 가 모든 모의 진입을 멈춤).
    //   @Optional — 미주입(단위 테스트)이면 비활성 폴백(회귀 0). 청산은 계속 허용(오버나잇 회피).
    @Optional()
    private readonly killSwitch?: KillSwitchManager,
    // DAR-496(견고화 W2·P18): 공용 진입 게이트(일일손실·현금) — SHADOW 배선(기록만·차단 0).
    //   @Optional — 미주입(단위 테스트)이면 no-op. ★측정 트랙이라 SHADOW 는 절대 BLOCK 없음 → 매매 무변경.
    @Optional()
    private readonly riskGuard?: RiskGuardService,
    // DAR-498(견고화 W2·P22): 주문 6관문 섀도 원장 — 예약→체결/취소를 OrderRequest/OrderExecution 에
    //   병행 기록(PaperTrade 경로 무변경). @Optional·섀도 라이트: 미주입이면 no-op, 기록 실패는
    //   서비스 내부에서 삼켜 체결·매매 흐름에 영향 0(M10 클록 보호).
    @Optional()
    private readonly shadowLedger?: OrderShadowLedgerService,
  ) {}

  /** 모의운용 전용 포트폴리오 find-or-create (고정 시스템 유저) */
  async getOrCreateSimPortfolio(): Promise<{
    id: string;
    maxSinglePositionPct: number;
    maxSectorPct: number;
  }> {
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
    let pf = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name: PaperSimulationService.SIM_PORTFOLIO_NAME },
      select: { id: true, maxSinglePositionPct: true, maxSectorPct: true },
    });
    if (!pf) {
      pf = await this.prisma.portfolio.create({
        data: {
          userId: user.id,
          name: PaperSimulationService.SIM_PORTFOLIO_NAME,
          maxSinglePositionPct: 10,
        },
        select: { id: true, maxSinglePositionPct: true, maxSectorPct: true },
      });
    }
    return pf;
  }

  /**
   * DAR-429 — 시스템 모의 포트폴리오 클린 리셋.
   *
   * 과레버리지(DAR-426 이전 현금 -11.3M·자본초과 보유)+리베이스로 오염된 이력을 제거하고
   * 초기상태(현금 = 초기자본 10,000,000 · OPEN 0)로 되돌린다. 이후 cron 은 현재 코드의
   * 현금가드(DAR-426 openNewPositions 가용현금 가드) + 매수기준(SIM_MIN_ENTRY_GRADE/buyScore)
   * 적용 상태로 0포지션·현금 10M 에서 원칙적으로 재누적한다.
   *
   * 안전 규칙(이슈 제약):
   *   - ★해당 sim 유저(paper-sim@system.local)의 단일 포트폴리오 범위 DELETE 만.
   *     DB 전역 파괴(truncate/drop) 금지. portfolioId 가 모든 삭제의 가드.
   *   - 멱등: 재실행 시 0건 삭제·현금 10M 유지(이미 비어 있으면 no-op).
   *   - 트랜잭션: 부분 실패 시 전체 롤백(중간 상태로 남지 않게 한다).
   *   - 자연키 정합: Position 삭제는 PositionDailySnapshot·ExitSignal 을 캐스케이드(스키마
   *     onDelete: Cascade). PaperTrade 는 포트폴리오 컬럼이 없으므로 sim 포지션의 positionThesisId
   *     (Position 당 @unique → 타 트랙 무침범)로만 한정 삭제(thesis 미연결 행은 식별 불가라 보존).
   *   - 자동 실행 금지: 이 메서드는 cron 이 호출하지 않는다. 컨트롤러의 인증·확인 게이트를 통해서만 트리거.
   *
   * 현금 정의는 computeMetrics/openNewPositions 와 동일한 SSOT(저장 컬럼 아님 · 파생):
   *   cash = INITIAL_CAPITAL + 실현손익(CLOSED net) − 보유 진입원가(OPEN entryAmount)
   * → 모든 Position 삭제 시 realized=0·invested=0 → cash = INITIAL_CAPITAL 로 자동 복원.
   */
  async resetSimulation(): Promise<SimulationResetResult> {
    const pf = await this.getOrCreateSimPortfolio();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1) sim 포지션 + 연결 thesis id 수집(PaperTrade 한정·캐스케이드 카운트용).
      const positions = await tx.position.findMany({
        where: { portfolioId: pf.id },
        select: { id: true, positionThesisId: true },
      });
      const positionIds = positions.map((p) => p.id);
      const thesisIds = positions.map((p) => p.positionThesisId).filter((x): x is string => !!x);

      // 캐스케이드로 사라질 자식 건수를 삭제 직전에 카운트(증거·반환용).
      const deletedDailySnapshots = positionIds.length
        ? await tx.positionDailySnapshot.count({
            where: { positionId: { in: positionIds } },
          })
        : 0;
      const deletedExitSignals = positionIds.length
        ? await tx.exitSignal.count({ where: { positionId: { in: positionIds } } })
        : 0;

      // 2) PaperTrade 원장 — sim 포지션 thesis 에 연결된 행만 삭제(타 트랙·전역 원장 무침범).
      const paperTrades = thesisIds.length
        ? await tx.paperTrade.deleteMany({
            where: { positionThesisId: { in: thesisIds } },
          })
        : { count: 0 };

      // 2-b) 매수 예약(PENDING) 정리 — 시스템 모의 네임스페이스(styleTag)만.
      //   리셋 후 남은 예약이 익일 시가 체결로 포지션을 재생성하면 클린 리셋이 깨진다.
      //   styleTag='paper-simulation' 은 이 서비스 예약 전용 태그(타 트랙 무침범).
      const pendingEntries = await tx.paperTrade.deleteMany({
        where: {
          styleTag: PaperSimulationService.TRADE_STRATEGY_KEY,
          status: 'PENDING',
        },
      });

      // 3) Position 삭제 → PositionDailySnapshot·ExitSignal 캐스케이드(onDelete: Cascade).
      const deletedPositions = await tx.position.deleteMany({
        where: { portfolioId: pf.id },
      });

      // 4) 포트폴리오 스냅샷·신호퍼널 일별 계측 초기화(포트폴리오 범위 — 자산곡선/진척 리셋).
      const riskSnaps = await tx.portfolioRiskSnapshot.deleteMany({
        where: { portfolioId: pf.id },
      });
      const funnel = await tx.signalEntryFunnelDaily.deleteMany({
        where: { portfolioId: pf.id },
      });

      return {
        deletedPositions: deletedPositions.count,
        deletedDailySnapshots,
        deletedExitSignals,
        deletedPaperTrades: paperTrades.count,
        deletedPendingEntries: pendingEntries.count,
        deletedRiskSnapshots: riskSnaps.count,
        deletedFunnelDaily: funnel.count,
      };
    });

    this.logger.log(
      `[PaperSim][리셋] 포트폴리오=${pf.id} 포지션=${result.deletedPositions} ` +
        `스냅샷=${result.deletedDailySnapshots} Exit=${result.deletedExitSignals} ` +
        `PaperTrade=${result.deletedPaperTrades} 예약=${result.deletedPendingEntries} ` +
        `리스크스냅=${result.deletedRiskSnapshots} ` +
        `퍼널=${result.deletedFunnelDaily} → 현금=${PaperSimulationService.INITIAL_CAPITAL} 보유=0`,
    );
    return {
      portfolioId: pf.id,
      ...result,
      // 리셋 후 불변식: 포지션 0 → cash = INITIAL_CAPITAL · OPEN 0.
      cashAfter: PaperSimulationService.INITIAL_CAPITAL,
      openPositionsAfter: 0,
    };
  }

  /** 한 사이클 실행 (수동 run-once / Cron 공통 진입점) */
  async runDailyCycle(tradeDate: string): Promise<DailyCycleResult> {
    if (this.isRunning) {
      this.logger.warn('[PaperSim] 이전 사이클 진행 중 — 스킵');
      return this.emptyResult(tradeDate, '이전 사이클 진행 중');
    }
    this.isRunning = true;
    try {
      const feedLabel = this.priceSource?.modeLabel ?? '실데이터(미주입 폴백)';
      this.logger.log(`[PaperSim] 일일 사이클 시작 tradeDate=${tradeDate} 시세=${feedLabel}`);
      const pf = await this.getOrCreateSimPortfolio();

      // DAR-124: 합성 모드면 사이클 직전 유니버스 시세를 멱등 적재(실데이터 모드는 no-op).
      //   환경 시계가 미래라 실 KRX 일봉이 없을 때 매수·스냅샷·Exit가 가격변동을 평가하게 한다.
      await this.priceSource?.prepareUniverse(pf.id, tradeDate);

      // DAR-135·DAR-139: 레거시 포지션(이전 소스 진입 ↔ 현재 소스 평가 불일치) 재기준 —
      //   합성/하이브리드(실가 전환) 모드에서만. 유니버스 적재 직후·신규 매수 전 1회. 신규 매수는
      //   이미 현재 소스로 일관(openNewPositions → latestClose → priceSource)이라 대상이 아니다.
      //   실데이터 전용(REAL 기본)/미주입은 no-op(회귀 0).
      const rebased = await this.rebaseLegacyPositions(pf.id, tradeDate);

      // 0) 만기 도래 예약·이연 청산 체결 — '당일 시가'로. 정상 운영은 장중 모니터(09:00~)가
      //    먼저 체결하므로 여기는 KIS 미가동/휴장 익일 등에서의 폴백(당일 REAL 일봉 open 사용).
      const bought = await this.fillPendingEntries(pf.id, tradeDate);
      const exited = await this.executePendingExits(pf.id, tradeDate);

      // 1) 신규 후보 → 매수 예약(익일 시가 체결 예정, 즉시 체결 금지 — lookahead 편향 차단).
      const reserved = await this.openNewPositions(pf, tradeDate);
      const snapshotted = await this.snapshotOpenPositions(pf.id, tradeDate);
      // 3) Exit 판정·기록만 — 체결은 익일 시가(executePendingExits)로 이연.
      const exitDeferred = await this.evaluateExits(pf.id, tradeDate);
      const { metrics, equity, openPositions } = await this.computeMetrics(pf.id);
      await this.savePortfolioSnapshot(pf.id, tradeDate, equity, metrics, openPositions);

      // DAR-497(P19): 계좌 고점(HWM) 추적 + 드로다운 컷 — 측정 트랙은 **SHADOW**(기록만·차단 0).
      //   순수 게이트 불변식상 BLOCK 이 나오지 않아 매매 행동 무변경(M10 클록 보호). graceful(관측 부수효과).
      await this.riskGuard
        ?.evaluateDrawdownCut({
          track: 'paper-simulation',
          portfolioId: pf.id,
          tradeDate,
          currentEquity: equity,
        })
        ?.catch((e) =>
          this.logger.error(`[PaperSim] 드로다운 SHADOW 평가 실패(무시): ${(e as Error).message}`),
        );

      this.logger.log(
        `[PaperSim] 사이클 완료 체결매수=${bought} 예약=${reserved} 스냅샷=${snapshotted} ` +
          `체결매도=${exited} 청산이연=${exitDeferred} 재기준=${rebased} 보유=${openPositions} 평가자산=${equity}`,
      );
      return {
        tradeDate,
        bought,
        reserved,
        snapshotted,
        exited,
        exitDeferred,
        rebased,
        openPositions,
        equity,
        metrics,
      };
    } catch (e) {
      this.logger.error(`[PaperSim] 사이클 오류: ${(e as Error).message}`);
      return this.emptyResult(tradeDate, (e as Error).message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * DAR-366(★②의 효력을 살리는 필수 경로) — 장중 연속 손절 모니터.
   *
   * 라이브 검증(2026-06-19)으로 확정: KIS 실시간가는 KRX 정규장(09:00~15:30 KST)에만 존재하고,
   * 일배치 손절 cron 은 장 마감 후(19:30)라 그 시각엔 실시간이 영영 없다 → ① 단독은 정체된 일봉만
   * 평가해 손절이 영영 미발화. 따라서 '장중에 실시간 실가로 평가'하는 것이 손절이 작동하는 유일한 경로다.
   *
   * 동작(능동 fetch 우선): ① 장시간 게이트 → ② forward 트랙 포트폴리오(시스템 모의 + styleTag
   *   네임스페이스, 이름 규약 `모의운용 포트폴리오*`) 전부에 대해 보유 종목 실시간 현재가를 KIS 에서
   *   능동 조회해 캐시 적재 → ③ 이연 청산·매수 예약을 '당일 시가'로 체결(첫 유효 틱 = 개장 체결기)
   *   → ④ evaluateExits(실가 1순위 즉시 손절 — 변경 없음).
   *   장외/휴장/키 미설정이면 평가 없이 스킵(거짓 손절 방지·로그/호출 0). throw 없이 결과로만 보고.
   */
  async runIntradayExitMonitor(now: Date = new Date()): Promise<{
    ran: boolean;
    skipped: boolean;
    reason?: string;
    fetched: number;
    cached: number;
    exited: number;
    /** 이번 틱에 당일 시가로 체결된 매수 예약 수(시스템 모의 네임스페이스). */
    entryFilled: number;
    /** 이번 틱에 당일 시가로 체결된 이연 청산 수(전 forward 트랙). */
    exitFilled: number;
    /** 모니터링한 forward 트랙 포트폴리오 수. */
    portfolios: number;
    tradeDate: string;
  }> {
    const tradeDate = formatKstDateCompact(now);
    const empty = {
      fetched: 0,
      cached: 0,
      exited: 0,
      entryFilled: 0,
      exitFilled: 0,
      portfolios: 0,
      tradeDate,
    };
    // ① 장시간 게이트 — 평일 09:00~15:30 KST 만. 장외/주말은 실시간 부재 → 평가 스킵(정직).
    if (!isKstRegularMarketHours(now)) {
      return { ran: false, skipped: true, reason: '장외(정규장 09:00~15:30 KST 아님)', ...empty };
    }
    // 겹침 가드 — 이전 틱이 아직 fetch/평가 중이면 이번 틱 건너뜀.
    if (this.isIntradayRunning) {
      return { ran: false, skipped: true, reason: '이전 장중 모니터 진행 중', ...empty };
    }
    this.isIntradayRunning = true;
    try {
      const systemPf = await this.getOrCreateSimPortfolio();
      // 다중 포트폴리오: 시스템 모의 + 스타일/전략 트랙(이름 규약) — 하드코딩 목록 금지.
      const portfolios = await this.listForwardTrackPortfolios(systemPf.id);
      let fetched = 0;
      let cached = 0;
      let exited = 0;
      let exitFilled = 0;
      // 매수 예약 체결은 시스템 모의 네임스페이스(styleTag='paper-simulation')만 — 타 트랙 예약은
      //   각 트랙 러너 소관(PaperTrade 에 portfolioId 가 없어 styleTag 규약으로만 안전 식별 가능).
      const entryFilled = await this.fillPendingEntries(systemPf.id, tradeDate, { now });
      for (const pf of portfolios) {
        const isSystem = pf.id === systemPf.id;
        // ② 보유 종목 실시간 현재가 능동 fetch → 캐시 적재(실가 1순위 평가의 전제).
        const w = await this.refreshHoldingsRealtime(pf.id, now);
        fetched += w.fetched;
        cached += w.cached;
        // ③ 전일 이연 청산 판정 → 당일 시가 체결(갭 정직 반영). 체결 알림은 시스템 모의만
        //    (타 트랙 라벨 오표기 방지 — 트랙별 알림은 각 러너 소관).
        exitFilled += await this.executePendingExits(pf.id, tradeDate, {
          now,
          emitTrades: isSystem,
        });
        // ④ 실가 기준 Exit 평가 — F1: intraday=true 로 실시간 1순위 + REAL 신선도 가드 적용.
        exited += await this.evaluateExits(pf.id, tradeDate, {
          intraday: true,
          emitTrades: isSystem,
        });
      }
      if (exited > 0 || cached > 0 || entryFilled > 0 || exitFilled > 0) {
        this.logger.log(
          `[PaperSim][장중모니터] tradeDate=${tradeDate} pf=${portfolios.length} fetch=${fetched} ` +
            `cached=${cached} 매도=${exited} 예약체결=${entryFilled} 이연청산체결=${exitFilled}`,
        );
      }
      return {
        ran: true,
        skipped: false,
        fetched,
        cached,
        exited,
        entryFilled,
        exitFilled,
        portfolios: portfolios.length,
        tradeDate,
      };
    } catch (e) {
      // cron 스케줄 유지 위해 흡수(결과로 보고). 부분 매도는 evaluateExits 내에서 종목별 독립.
      this.logger.error(`[PaperSim][장중모니터] 오류: ${(e as Error).message}`);
      return { ran: false, skipped: true, reason: (e as Error).message, ...empty };
    } finally {
      this.isIntradayRunning = false;
    }
  }

  /**
   * forward 트랙 포트폴리오 목록 — 시스템 모의 + styleTag 네임스페이스(철학 스타일/전략 트랙).
   * 식별은 규약으로만: 시스템 유저(SIM_USER_EMAIL) 소유 + 이름이 SIM_PORTFOLIO_NAME
   * ('모의운용 포트폴리오') prefix. 예: '모의운용 포트폴리오 [BUFFETT]'. 하드코딩 목록 금지 —
   * 다른 트랙이 규약대로 포트폴리오를 만들면 자동 편입된다. 시스템 모의는 항상 포함 보장.
   */
  private async listForwardTrackPortfolios(
    systemPortfolioId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const user = await this.prisma.user.findFirst({
      where: { email: PaperSimulationService.SIM_USER_EMAIL },
      select: { id: true },
    });
    const rows = user
      ? await this.prisma.portfolio.findMany({
          where: {
            userId: user.id,
            name: { startsWith: PaperSimulationService.SIM_PORTFOLIO_NAME },
          },
          select: { id: true, name: true },
        })
      : [];
    if (!rows.some((r) => r.id === systemPortfolioId)) {
      rows.unshift({
        id: systemPortfolioId,
        name: PaperSimulationService.SIM_PORTFOLIO_NAME,
      });
    }
    return rows;
  }

  /**
   * DAR-366: 보유 OPEN 포지션 종목의 실시간 현재가를 KIS 에서 능동 조회해 RealtimeQuoteCache 에 적재한다.
   *   - KIS 미주입/키 미설정·캐시 미주입이면 no-op(fetched=0) → 평가는 priceSource 폴백(회귀 0).
   *   - 보유 종목(≤MAX_HOLDINGS)만, corpCode 중복 제거 → 레이트리밋·비용 가드. 순차 호출(겹침 락이 보호).
   *   - 한 종목 실패는 건너뛰고 계속(graceful) — 장중 모니터를 깨지 않는다.
   *   ★시세 수집 primitive(HTTP/캐시)만 — 체결·주문수량·하드룰 무관(AI 금지영역 미접촉).
   */
  private async refreshHoldingsRealtime(
    portfolioId: string,
    now: Date = new Date(),
  ): Promise<{ fetched: number; cached: number }> {
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { corpCode: true, stockCode: true },
    });
    return this.warmRealtimeQuotes(open, now);
  }

  /**
   * DAR-433: 주어진 종목 목록의 실시간 현재가를 KIS 에서 능동 조회해 RealtimeQuoteCache 에 적재한다.
   *   보유종목(refreshHoldingsRealtime)뿐 아니라 '진입 후보'도 진입 직전 동일하게 warm 해, 장중
   *   진입이 청산과 같은 REALTIME 소스로 평가되도록(cross-source 비대칭 제거). 장외엔 실시간 부재라
   *   no-op(fetched=0) → 진입·청산 모두 일봉(REAL)으로 대칭(정렬 가드가 추가 보장).
   *   - KIS 미주입/키 미설정·캐시 미주입이면 no-op(fetched=0) → 평가는 priceSource 폴백(회귀 0).
   *   - corpCode 중복 제거 → 레이트리밋·비용 가드. 순차 호출(겹침 락이 보호). 상한 MAX_HOLDINGS.
   *   - 한 종목 실패는 건너뛰고 계속(graceful). ★시세 수집 primitive(HTTP/캐시)만 — AI 금지영역 미접촉.
   *   - ★정규장 시간 게이트(2026-07): 장외(19:30 사이클 등)의 KIS fetch 는 전일 종가를 REALTIME 으로
   *     둔갑시켜 캐시를 오염시킨다 → 정규장(평일 09:00~15:30 KST) 외에는 no-op. now 는 호출측
   *     시각 주입(장중 모니터의 tick 시각) — 미지정 시 실제 벽시계.
   */
  private async warmRealtimeQuotes(
    targets: Array<{ corpCode: string | null; stockCode: string | null }>,
    now: Date = new Date(),
  ): Promise<{ fetched: number; cached: number }> {
    if (!isKstRegularMarketHours(now)) return { fetched: 0, cached: 0 };
    if (!this.kis?.isConfigured || !this.realtimeCache) return { fetched: 0, cached: 0 };
    const byCorp = new Map<string, { corpCode: string; stockCode: string }>();
    for (const r of targets) {
      if (!r.corpCode || !r.stockCode) continue;
      if (!byCorp.has(r.corpCode))
        byCorp.set(r.corpCode, { corpCode: r.corpCode, stockCode: r.stockCode });
      if (byCorp.size >= PaperSimulationService.MAX_HOLDINGS) break;
    }
    let fetched = 0;
    let cached = 0;
    for (const { corpCode, stockCode } of byCorp.values()) {
      fetched++;
      const q = await this.kis.fetchCurrentPrice(stockCode);
      if (!q || q.price <= 0) continue;
      this.realtimeCache.set({
        corpCode,
        stockCode,
        price: q.price,
        open: q.open,
        high: q.high,
        low: q.low,
        volume: q.volume,
        fetchedAtMs: Date.now(),
      });
      cached++;
    }
    return { fetched, cached };
  }

  /**
   * 진척 조회 — 최신 누적지표 + 포트폴리오 현황 + 보유 포지션 상세 (실주문 없음)
   *
   * 모바일 포트폴리오 화면용(DAR-42): 평가금액·초기원금·보유 포지션[종목·수량·평가손익]·
   * 청산 건수·누적 졸업지표·최신 스냅샷일을 한 번에 반환한다.
   */
  async getSimulationStatus(): Promise<{
    portfolioId: string;
    initialCapital: number;
    equity: number;
    /** 보유 포지션 수 */
    openPositionCount: number;
    /** 보유 포지션 상세(종목·수량·평가손익) */
    positions: SimPositionDetail[];
    closedPositions: number;
    latestSnapshotDate: string | null;
    metrics: SimulationMetrics;
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    // DAR-364/393: 표시·엔진 동일 가격 — 헤더와 자산곡선이 같은 live 평가를 쓰도록 단일 헬퍼로 산출.
    const live = await this.computeLiveEquity(pf.id);
    const closedPositions = await this.prisma.position.count({
      where: { portfolioId: pf.id, status: 'CLOSED' },
    });
    const latest = await this.prisma.portfolioRiskSnapshot.findFirst({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    });
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      equity: live.equity,
      openPositionCount: live.openPositionCount,
      positions: live.positions,
      closedPositions,
      latestSnapshotDate: latest?.snapshotDate ?? null,
      metrics: live.metrics,
    };
  }

  /**
   * 헤더·자산곡선 공용 'live 평가' 산출(DAR-393).
   * 보유 포지션을 '지금'(오늘 KST) 실시간 실가로 재평가하고(positions), 그 미실현손익 합을 equity 산식에
   * 그대로 넘긴다 — 헤더 평가금액·등락률과 자산곡선 최신점이 **동일 계산(같은 priceSource·같은 시점)**을 쓴다.
   * asOf = 재평가 앵커일(YYYYMMDD KST) = 자산곡선 live 점의 날짜.
   */
  private async computeLiveEquity(portfolioId: string): Promise<{
    asOf: string;
    positions: SimPositionDetail[];
    equity: number;
    metrics: SimulationMetrics;
    openPositionCount: number;
  }> {
    const asOf = this.todayBasDd();
    const positions = await this.getOpenPositionDetails(portfolioId, asOf);
    const liveOpenUnrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const { metrics, equity, openPositions } = await this.computeMetrics(
      portfolioId,
      liveOpenUnrealizedPnl,
    );
    return { asOf, positions, equity, metrics, openPositionCount: openPositions };
  }

  /**
   * 모의 자산곡선 + 졸업 진척(DAR-60).
   * PortfolioRiskSnapshot 의 일별 totalValue 시계열을 초기원금 기준 수익률과 함께 반환하고,
   * getSimulationStatus 와 동일한 누적 졸업지표(gates 포함)를 재사용해 스코어보드 데이터로 제공한다.
   * 스냅샷이 없으면 points=[](점 0개), 1개면 점 1개 — 추세를 가공하지 않는다(가짜 추세선 금지).
   */
  async getEquityCurve(): Promise<{
    portfolioId: string;
    initialCapital: number;
    /** 일별 자산곡선 점(오름차순). 0개·1개도 정직하게 그대로 반환 */
    points: EquityCurvePoint[];
    latestSnapshotDate: string | null;
    /** 누적 졸업지표(gates 포함) — getSimulationStatus 재사용 */
    metrics: SimulationMetrics;
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    const snapshots = await this.prisma.portfolioRiskSnapshot.findMany({
      where: { portfolioId: pf.id },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, totalValue: true },
    });
    // DAR-393: 헤더와 동일한 live 평가를 곡선에도 정합. 과거 스냅샷(kind='snapshot')은 그대로 두되,
    //   곡선 끝에 '현재(실시간)' 점(kind='live')을 정합 병합해 곡선 최신점 totalValue === 헤더 equity (±0)로
    //   맞춘다. metrics 도 헤더와 같은 live 계산을 재사용 → 등락률·부호 일치.
    const snapshotPoints = buildEquityCurve(snapshots, PaperSimulationService.INITIAL_CAPITAL);
    const live = await this.computeLiveEquity(pf.id);
    const points = withLivePoint(
      snapshotPoints,
      live.asOf,
      live.equity,
      PaperSimulationService.INITIAL_CAPITAL,
    );
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      points,
      // 저장 스냅샷(과거) 최신일 — 신선도 라벨용. live 점 날짜와 구분(stale 표기 근거).
      latestSnapshotDate:
        snapshotPoints.length > 0 ? snapshotPoints[snapshotPoints.length - 1].snapshotDate : null,
      metrics: live.metrics,
    };
  }

  /**
   * 매매 사유 추적 + 성적표(DAR-64).
   * 모의 포지션(OPEN+CLOSED)의 진입 사유(PositionThesis)·청산 사유(ExitSignal)를 기존 저장값에서
   * 추출하고, CLOSED 포지션을 매매 성적표(승률·평균손익·평균보유기간·누적수익률)로 집계한다.
   * ★ read-only — 신규 수집·외부호출·AI 개입 0. 기존 모델 조합만(스키마 변경 0).
   */
  async getTradeHistory(): Promise<{
    portfolioId: string;
    initialCapital: number;
    scorecard: TradeScorecard;
    /** eventType 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
    byEventType: DimensionScorecard[];
    /** signalGrade 별 성적표(CLOSED, 표본 많은 순) — DAR-73 */
    bySignalGrade: DimensionScorecard[];
    /** 진입일 최신순 매매 사유 목록(OPEN+CLOSED) */
    trades: TradeRationale[];
  }> {
    const pf = await this.getOrCreateSimPortfolio();
    const rows = await this.prisma.position.findMany({
      where: { portfolioId: pf.id },
      orderBy: { entryDate: 'desc' },
      select: {
        id: true,
        corpCode: true,
        stockCode: true,
        status: true,
        entryDate: true,
        entryPrice: true,
        quantity: true,
        closedAt: true,
        unrealizedPnl: true,
        unrealizedPnlPct: true,
        stopLossPct: true,
        takeProfitPct: true,
        maxHoldDays: true,
        positionThesis: {
          select: {
            entryReason: true,
            initialThesis: true,
            // DAR-73: 진입 신호의 eventType·등급을 성적표 차원으로 노출(기존 링크 재사용)
            tradingSignal: { select: { eventType: true, signal: true } },
          },
        },
      },
    });

    if (rows.length === 0) {
      return {
        portfolioId: pf.id,
        initialCapital: PaperSimulationService.INITIAL_CAPITAL,
        scorecard: calculateTradeScorecard([], PaperSimulationService.INITIAL_CAPITAL),
        byEventType: [],
        bySignalGrade: [],
        trades: [],
      };
    }

    // 회사명 보강
    const corpCodes = Array.from(new Set(rows.map((r) => r.corpCode)));
    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes } },
      select: { corpCode: true, corpName: true },
    });
    const corpNameByCode: Record<string, string> = {};
    for (const c of companies) corpNameByCode[c.corpCode] = c.corpName;

    // CLOSED 포지션의 청산 트리거(ExitSignal) — 포지션별 최신 1건 매핑
    const closedIds = rows.filter((r) => r.status === 'CLOSED').map((r) => r.id);
    const exitByPosition = await this.loadExitSignals(closedIds);

    const trades = rows.map((r) => {
      const exit = exitByPosition[r.id];
      const input: TradeRationaleInput = {
        positionId: r.id,
        corpCode: r.corpCode,
        stockCode: r.stockCode,
        corpName: corpNameByCode[r.corpCode] ?? null,
        status: r.status,
        entryDate: r.entryDate,
        entryPrice: r.entryPrice,
        quantity: r.quantity,
        closedAt: r.closedAt,
        pnl: r.unrealizedPnl,
        pnlPct: r.unrealizedPnlPct,
        stopLossPct: r.stopLossPct,
        takeProfitPct: r.takeProfitPct,
        maxHoldDays: r.maxHoldDays,
        entryReason: r.positionThesis?.entryReason ?? null,
        initialThesis: r.positionThesis?.initialThesis ?? null,
        exitAction: exit?.exitAction ?? null,
        exitTriggers: exit?.triggerTypes ?? [],
        eventType: r.positionThesis?.tradingSignal?.eventType ?? null,
        signalGrade: r.positionThesis?.tradingSignal?.signal ?? null,
      };
      return buildTradeRationale(input);
    });

    const closed = trades.filter((t) => t.status === 'CLOSED');
    return {
      portfolioId: pf.id,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      scorecard: calculateTradeScorecard(closed, PaperSimulationService.INITIAL_CAPITAL),
      byEventType: calculateScorecardByDimension(
        closed,
        PaperSimulationService.INITIAL_CAPITAL,
        'eventType',
      ),
      bySignalGrade: calculateScorecardByDimension(
        closed,
        PaperSimulationService.INITIAL_CAPITAL,
        'signalGrade',
      ),
      trades,
    };
  }

  /** 청산 포지션별 최신 ExitSignal(청산 액션·트리거) 매핑 — read-only */
  private async loadExitSignals(
    positionIds: string[],
  ): Promise<Record<string, { exitAction: string; triggerTypes: string[] }>> {
    if (positionIds.length === 0) return {};
    const signals = await this.prisma.exitSignal.findMany({
      where: { positionId: { in: positionIds } },
      orderBy: { checkedAt: 'desc' },
      select: { positionId: true, exitAction: true, triggerTypes: true },
    });
    const map: Record<string, { exitAction: string; triggerTypes: string[] }> = {};
    for (const s of signals) {
      // findMany 가 checkedAt desc 이므로 최초 등장이 최신 — 이미 있으면 건너뜀.
      if (!map[s.positionId]) {
        map[s.positionId] = { exitAction: s.exitAction, triggerTypes: s.triggerTypes };
      }
    }
    return map;
  }

  /** 보유(OPEN) 포지션을 모바일 표시용으로 매핑 — 회사명 보강, 평가손익 큰 순 정렬.
   *  DAR-364: 표시 currentPrice·평가손익을 '엔진이 손절을 평가하는 가격'(실시간 실가 1순위)과
   *  동일 소스로 재평가한다(표시=엔진). 실가 미가용 종목은 저장 스냅샷값으로 정직 폴백. */
  private async getOpenPositionDetails(
    portfolioId: string,
    asOf: string,
  ): Promise<SimPositionDetail[]> {
    const rows = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: {
        corpCode: true,
        stockCode: true,
        quantity: true,
        entryPrice: true,
        currentPrice: true,
        currentValue: true,
        unrealizedPnl: true,
        unrealizedPnlPct: true,
        entryPriceSource: true,
      },
      orderBy: { currentValue: 'desc' },
    });
    if (rows.length === 0) return [];

    // DAR-122: 종목당 1행으로 디듑(중복 OPEN 행이 남아 있어도 화면엔 종목당 1카드).
    const deduped = dedupeOpenPositionRows(rows);

    const corpCodes = Array.from(new Set(deduped.map((r) => r.corpCode)));
    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes } },
      select: { corpCode: true, corpName: true },
    });
    const corpNameByCode: Record<string, string> = {};
    for (const c of companies) corpNameByCode[c.corpCode] = c.corpName;

    // DAR-364: 종목별 실시간 실가 재평가(표시=엔진). 실가 미가용이면 저장값 그대로(폴백).
    return Promise.all(
      deduped.map(async (r) => {
        const base = toSimPositionDetail(r, corpNameByCode);
        const live = await this.revalueLive(
          r.corpCode,
          r.entryPrice,
          r.quantity,
          asOf,
          r.entryPriceSource,
        );
        if (!live) return base;
        return {
          ...base,
          currentPrice: live.currentPrice,
          currentValue: live.currentValue,
          unrealizedPnl: live.unrealizedPnl,
          unrealizedPnlPct: live.unrealizedPnlPct,
          priceSource: live.source,
          priceSourceDate: live.sourceDate,
        };
      }),
    );
  }

  /**
   * DAR-364: 보유 포지션을 '표시·엔진 동일' 가격으로 재평가한다.
   *   latestPriceRow(실시간 실가 1순위 → 실 KRX 일봉 → 합성 폴백)로 현재가를 구하고 진입가 대비
   *   평가손익(원·%)을 산출한다. 손절/익절 평가가 쓰는 바로 그 가격이므로 사용자가 보는 손실 =
   *   엔진이 손절하는 손실이 된다.
   *   priceSource 미주입(레거시 테스트)·실가 미가용(closePrice≤0/null)이면 null → 호출측이
   *   저장 스냅샷값으로 정직 폴백(회귀 0).
   */
  private async revalueLive(
    corpCode: string,
    entryPrice: number,
    quantity: number,
    asOf: string,
    entryPriceSource?: string | null,
  ): Promise<{
    currentPrice: number;
    currentValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    source: SimPriceRow['source'];
    sourceDate?: string;
  } | null> {
    // DAR-433: 표시 현재가도 진입 소스로 정렬(표시=엔진 일관 — cross-source 가짜갭을 화면에도 안 보이게).
    const row = await this.alignedPriceRow(corpCode, asOf, entryPriceSource);
    if (!row || row.closePrice <= 0) return null;
    const currentPrice = row.closePrice;
    return {
      currentPrice,
      currentValue: currentPrice * quantity,
      unrealizedPnl: (currentPrice - entryPrice) * quantity,
      unrealizedPnlPct: entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0,
      source: row.source,
      sourceDate: row.sourceDate,
    };
  }

  // ─── 1) 신규 매수 예약 ────────────────────────────────────────────────
  // 장외 체결 의미론(2026-07): 즉시 placeOrder+Position 생성 대신 **PENDING PaperTrade 예약**만
  //   만든다(entryDate=다음 거래일). 체결은 개장 체결기(장중 모니터 첫 유효 틱) 또는 일일 사이클
  //   폴백(fillPendingEntries)이 '당일 시가'로 수행 — "19:30 = 주문 결정, 익일 개장 = 체결".
  private async openNewPositions(
    pf: { id: string; maxSinglePositionPct: number; maxSectorPct: number },
    tradeDate: string,
  ): Promise<number> {
    // 기존 OPEN 포지션(종목 제외 + 섹터 노출 초기값 산정에 재사용).
    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId: pf.id, status: 'OPEN' },
      select: { corpCode: true, currentValue: true, entryAmount: true },
    });
    // 미체결 매수 예약(PENDING, 시스템 모의 네임스페이스) — 슬롯·현금·종목 디듑에 포함해야
    //   예약↔체결 사이(하루)의 이중 예약·현금 초과 배분을 막는다.
    const pendingEntries = await this.prisma.paperTrade.findMany({
      where: {
        status: 'PENDING',
        direction: 'BUY',
        styleTag: PaperSimulationService.TRADE_STRATEGY_KEY,
      },
      select: { corpCode: true, orderedShares: true, entryPrice: true },
    });
    const available =
      PaperSimulationService.MAX_HOLDINGS - openPositions.length - pendingEntries.length;
    if (available <= 0) return 0;
    // F6(2026-06-27): kill-switch 발동 시 시스템 모의 신규 진입 전면 차단(청산은 계속 — 오버나잇 회피).
    if (this.killSwitch?.isActive()) {
      this.logger.warn('[PaperSim] 킬스위치 발동 — 신규 진입 차단');
      return 0;
    }
    const openCorpCodes = [
      ...openPositions.map((p) => p.corpCode),
      ...pendingEntries.map((t) => t.corpCode),
    ];

    // DAR-426(★핵심): 가용현금 가드 준비 — 사이징(가상원금×비율) 만으로는
    //   MAX_HOLDINGS(50) × 종목당 비율(maxSinglePositionPct 10% × 등급계수)의 합이 100%
    //   자본을 초과해 현금이 음수가 된다(실측 -11M). 현 가용현금을 산정하고 진입마다 차감해,
    //   매수 예산을 절대 가용현금 이내로 묶는다(cash ≥ 0 불변식 — 페이퍼심 정합성의 하드룰).
    //   현금 정의(SSOT, computeMetrics/computeSimSnapshot 와 동일):
    //     cash = 초기자본 + 실현손익(CLOSED net) − 보유 진입원가(OPEN entryAmount)
    //   진입 직후 currentValue=entryAmount·미실현 0 이므로, 신규 진입원가 차감분이 곧 현금 감소분.
    const closedForCash = await this.prisma.position.findMany({
      where: { portfolioId: pf.id, status: 'CLOSED' },
      select: { unrealizedPnl: true, closedAt: true },
    });
    const realizedNetPnl = closedForCash.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    // DAR-496(P18): 당일 실현손익 — 오늘(KST) 청산분만 합산(일일손실 게이트 입력).
    //   사이클 순서(평가→Exit→신규진입)상 오늘 청산은 이미 완료돼 이 시점에 확정돼 있다.
    const todayKstMidnight = this.kstMidnight(tradeDate);
    const dailyRealizedPnl = closedForCash.reduce(
      (s, p) => (p.closedAt && p.closedAt >= todayKstMidnight ? s + (p.unrealizedPnl ?? 0) : s),
      0,
    );
    // DAR-501(P21): 당월(KST) 실현손익 — 이번 달 1일 이후 청산분 합산(월간 손실 한도 게이트 입력).
    //   월 경계는 KST SSOT(kstMonthStart) — 월이 바뀌면 합이 리셋돼 익월 자동 재개(명세 3-3).
    const monthStartKst = kstMonthStart(todayKstMidnight);
    const monthlyRealizedPnl = closedForCash.reduce(
      (s, p) => (p.closedAt && p.closedAt >= monthStartKst ? s + (p.unrealizedPnl ?? 0) : s),
      0,
    );
    const investedPrincipal = openPositions.reduce((s, p) => s + (p.entryAmount ?? 0), 0);
    // 미체결 예약이 잡아둔 금액(기준가×주문수량)도 차감 — 체결 전이라 SSOT 현금엔 없지만
    //   여기서 빼지 않으면 예약이 이틀 연속 같은 현금을 이중 배분한다(체결 시 재클램프가 최종 방어).
    const reservedCash = pendingEntries.reduce(
      (s, t) => s + t.orderedShares * Number(t.entryPrice),
      0,
    );
    let availableCash =
      PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl - investedPrincipal - reservedCash;

    // DAR-362: 후보 pool 확대 — entryReady=true 만으로는 BUY 희소 시 pool이 인위적으로 협소.
    //   ① entryReady WATCH+ 후보를 우선 채우고(진입품질 우선),
    //   ② 슬롯이 남으면 entryReady 아니어도 buyScore≥ENTRY_FALLBACK_MIN_BUY_SCORE 인 상위
    //      후보로 보강한다(무차별 확대 아님 — 품질 하한 유지). 변경 근거: BUY/STRONG 신호가
    //      희소해 entryReady 통과 후보만으로는 다양성이 막힘.
    // DAR-122: 한 종목은 4 Persona(또는 다수 공시)당 신호 행을 가지므로 take 전 디듑이 필요하다.
    //   디듑 없이 take/loop를 돌면 동일 corpCode에 Position이 중복 생성된다. Persona 최대 4를
    //   고려해 넉넉히 조회(available×4) 후 종목당 1건으로 디듑하고 available개로 절단한다.
    const PERSONA_FANOUT = 4;
    const eligibleGrades = entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never;
    const excludeCorp = openCorpCodes.length ? openCorpCodes : ['__none__'];

    const readyRaw = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: eligibleGrades },
        entryReady: true,
        corpCode: { notIn: excludeCorp },
        // ★DAR-389/DAR-129(불가침): 과거 공시 point-in-time 백필 신호(분석·백테스트 전용)는
        //   라이브 모의 진입 후보에서 원천 배제한다. 백필 신호는 과거 시점 가격으로 채점되어
        //   당일 현재가 진입과 맞지 않으므로 라이브 포트폴리오를 오염시키면 안 된다.
        disclosure: { isBackfill: false },
      },
      orderBy: { buyScore: 'desc' },
      take: available * PERSONA_FANOUT,
    });
    let candidates = dedupeCandidatesByCorpCode(readyRaw).slice(0, available);

    // ② 부족분만 비-entryReady 상위 buyScore로 보강(품질 하한 적용·기보유/선정 종목 제외).
    if (candidates.length < available) {
      const need = available - candidates.length;
      const already = new Set<string>([...openCorpCodes, ...candidates.map((c) => c.corpCode)]);
      const fallbackRaw = await this.prisma.tradingSignal.findMany({
        where: {
          signal: { in: eligibleGrades },
          entryReady: false,
          buyScore: { gte: ENTRY_FALLBACK_MIN_BUY_SCORE },
          corpCode: { notIn: Array.from(already).length ? Array.from(already) : ['__none__'] },
          // ★DAR-389/DAR-129(불가침): 백필 신호는 라이브 보강 후보에서도 배제(위 ① 동일 근거).
          disclosure: { isBackfill: false },
        },
        orderBy: { buyScore: 'desc' },
        take: need * PERSONA_FANOUT,
      });
      const fallback = dedupeCandidatesByCorpCode(fallbackRaw)
        .filter((c) => !already.has(c.corpCode))
        .slice(0, need);
      candidates = [...candidates, ...fallback];
    }

    // 한 사이클 안에서 이미 매수한 종목 추적(디듑된 후보라도 방어선 유지).
    const openedCorpCodes = new Set<string>(openCorpCodes);

    // DAR-362: 섹터 분산 가드 준비 — 섹터(업종)는 CompanyOverview.industryCode 로 식별(스키마 변경 0).
    //   기보유 + 후보 corpCode 의 industryCode 를 1회 조회해 매핑하고, 기보유 포지션 가치로
    //   섹터별 현재 노출을 초기화한다. industryCode 미상(null)은 가드 면제(데이터 없는 상한 강제 금지).
    const sectorCorpCodes = Array.from(
      new Set<string>([...openCorpCodes, ...candidates.map((c) => c.corpCode)]),
    );
    const overviews = sectorCorpCodes.length
      ? await this.prisma.companyOverview.findMany({
          where: { corpCode: { in: sectorCorpCodes } },
          select: { corpCode: true, industryCode: true },
        })
      : [];
    const sectorByCorp = new Map<string, string | null>();
    for (const o of overviews) sectorByCorp.set(o.corpCode, o.industryCode ?? null);
    const sectorValue = new Map<string, number>();
    for (const p of openPositions) {
      const sector = sectorByCorp.get(p.corpCode) ?? null;
      if (!sector) continue;
      const val = p.currentValue ?? p.entryAmount ?? 0;
      sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + val);
    }
    const portfolioTotalValue = PaperSimulationService.INITIAL_CAPITAL;

    // 종목별 기본 배분 예산(가상원금 × 단일종목 최대비중). 등급+buyScore 차등은 entryBudgetScored 적용.
    const baseBudget = PaperSimulationService.INITIAL_CAPITAL * (pf.maxSinglePositionPct / 100);

    // DAR-433: 진입 직전 후보 종목 실시간가 능동 warm — 장중 진입이 청산과 같은 REALTIME 소스로
    //   기록되게 정렬(cross-source 비대칭 제거). 장외/키 미설정이면 no-op → 진입·청산 모두 일봉(REAL).
    await this.warmRealtimeQuotes(candidates);

    let opened = 0;
    for (const sig of candidates) {
      // DAR-426: 현금 소진 시 추가 매수 중단(현금<0 절대 금지). 후보는 buyScore desc 정렬이라
      //   남은 현금으로 가장 확신 높은 종목부터 채운다.
      if (availableCash <= 0) break;
      // DAR-122: 같은 종목 재진입 방지(동일 사이클 내 중복 0).
      if (openedCorpCodes.has(sig.corpCode)) continue;
      // 예약 기준가 취득 — 사이징(주문수량) 근거. 체결가는 익일 시가에서 별도 결정되며,
      //   entryPriceSource(진입 소스 정렬)는 체결기(fillPendingEntries)가 체결 시가 행에서 영속한다.
      const priceRow = await this.latestPriceRow(sig.corpCode, tradeDate);
      const price = priceRow?.closePrice ?? null;
      if (price === null || price <= 0) continue;
      // DAR-362: 등급 + buyScore 차등 사이징(고확신 더, 저확신 덜 — 균일 탈피).
      let budget = entryBudgetScored(baseBudget, sig.signal as string, sig.buyScore);
      // DAR-362: 섹터 분산 가드 — 동일 섹터 비중 상한(maxSectorPct) enforce.
      //   섹터 식별 가능 시 잔여 허용 예산으로 예산을 절감(상한 초과 진입 차단). 미상은 면제.
      const sector = sectorByCorp.get(sig.corpCode) ?? null;
      if (sector) {
        const headroom = sectorHeadroomBudget(
          sectorValue.get(sector) ?? 0,
          portfolioTotalValue,
          pf.maxSectorPct,
        );
        budget = Math.min(budget, headroom);
      }
      // DAR-426(★핵심): 가용현금 가드 — 예산을 남은 현금 이내로 묶는다.
      budget = Math.min(budget, availableCash);
      if (budget <= 0) continue;
      // 체결가는 슬리피지가 더해진다(BUY = price×(1+slippage)). 진입원가가 예산을 넘지 않도록
      //   슬리피지 반영가로 수량을 산정한다 → 진입원가(=체결가×수량) ≤ budget ≤ availableCash 보장.
      // F8: 사이징 단가를 체결가와 동일하게 호가단위 정렬(BUY 올림) — shares×fillPrice ≤ budget
      //   ≤ availableCash 보장(DAR-426 현금≥0 불변식이 틱반올림 후에도 유지).
      // F8 Phase2: 동적 슬리피지(시장충격)를 반영한 보수적 사이징 — DAR-426 현금≥0 불변식 보존.
      //   참여율을 base 사이징 주수로 상한 추정 → effPrice 상향 → shares 하향(보수). 실제 체결가는
      //   최종 주수(≤baseShares)의 더 작은 참여율로 산정되므로 항상 effPrice 이하 → 진입원가 ≤ budget.
      const dayVol = Number(priceRow?.volume ?? 0);
      const baseEffPrice = roundToTick(price * (1 + DEFAULT_FILL_PARAMS.slippagePct), 'BUY');
      const baseShares = Math.floor(budget / baseEffPrice);
      const estParticipation = dayVol > 0 ? baseShares / dayVol : 0;
      const effSlippage =
        DEFAULT_FILL_PARAMS.slippagePct +
        (DEFAULT_FILL_PARAMS.impactCoeff ?? 0.015) * Math.sqrt(estParticipation);
      const effPrice = roundToTick(price * (1 + effSlippage), 'BUY');
      const shares = Math.floor(budget / effPrice);
      if (shares <= 0) continue;

      const thesis = await this.prisma.positionThesis.findUnique({
        where: { tradingSignalId: sig.id },
        select: { id: true },
      });

      // DAR-496(P18): 공용 진입 게이트(일일손실·현금) — SHADOW 배선. 진입 확정(예약 create) 직전 1줄.
      //   ★측정 트랙이라 mode=SHADOW → 절대 BLOCK 없음 → 후보·수량·예약 무변경(M10 클록 보호).
      //   BLOCK 은 ENFORCE 트랙에서만 나오므로 이 가드는 SHADOW 에서 사실상 dead-branch(구조적 무변경).
      const gate = await this.riskGuard?.evaluateEntry({
        track: 'paper-simulation',
        tradeDate,
        totalCapital: PaperSimulationService.INITIAL_CAPITAL,
        dailyRealizedPnl,
        monthlyRealizedPnl,
        availableCash,
        entryBudget: shares * effPrice,
        killSwitchActive: this.killSwitch?.isActive() ?? false,
        corpCode: sig.corpCode,
        stockCode: sig.stockCode,
      });
      if (gate?.action === 'BLOCK') continue;

      // ★즉시 체결 금지 — PENDING 예약만 기록. entryDate=다음 거래일(주말·KRX 공휴일 스킵,
      //   nextTradingDay 순수 함수 재사용). entryPrice=예약 기준가(당일 평가가 — 사이징 근거,
      //   체결가 아님). 체결·Position 생성은 fillPendingEntries 가 '당일 시가'로 수행.
      const entryTradeYmd = nextTradingDay(tradeDate);
      const reservation = await this.prisma.paperTrade.create({
        data: {
          corpCode: sig.corpCode,
          stockCode: sig.stockCode,
          direction: 'BUY',
          orderedShares: shares,
          filledShares: 0,
          fillRate: 0,
          entryPrice: price,
          // DAR-474: 신호시점 기대가 보존 — 체결기가 entryPrice를 체결일 시가로 덮어써도
          //   이 값은 유지되어 신호→체결 슬리피지 측정의 기준가로 쓰인다(측정 표면 전용).
          expectedPrice: price,
          status: 'PENDING',
          entryDate: this.kstMidnight(entryTradeYmd),
          tradingSignalId: sig.id,
          positionThesisId: thesis?.id ?? null,
          // 시스템 모의 예약 네임스페이스 — 타 트랙(단타/철학 스타일) PaperTrade 와 안전 분리.
          styleTag: PaperSimulationService.TRADE_STRATEGY_KEY,
        },
        select: { id: true },
      });
      openedCorpCodes.add(sig.corpCode);
      // DAR-498(P22): 주문 6관문 섀도 원장 — 예약(PENDING) 확정 직후 병행 기록(OrderRiskService
      //   evaluateOrder 첫 실소비). availableCash 는 선차감 전(잔고 관문 스냅샷). ★섀도 라이트:
      //   실패해도 예약·매매 무영향(서비스 내부 try/catch). PaperTrade 경로·현금·수량 무변경.
      await this.shadowLedger?.recordReservation({
        tradingSignalId: sig.id,
        paperTradeId: reservation.id,
        corpCode: sig.corpCode,
        stockCode: sig.stockCode,
        orderedShares: shares,
        referencePrice: price,
        totalCapital: PaperSimulationService.INITIAL_CAPITAL,
        dailyRealizedPnl,
        availableCash,
        openOrderCount: pendingEntries.length + opened,
        todayTradeCount: opened,
        buyScore: sig.buyScore ?? undefined,
        killSwitchActive: this.killSwitch?.isActive() ?? false,
      });
      // DAR-426: 예약 몫(≈ 슬리피지 반영가 × 주문수량 ≤ budget)만큼 가용현금에서 선차감 —
      //   같은 사이클 내 후보 간 이중 배분 방지. SSOT 현금은 체결 시점에만 변한다(체결기 재클램프).
      availableCash -= shares * effPrice;
      // DAR-362: 예약 몫을 섹터 노출에 누적(다음 후보의 섹터 가드에 반영).
      if (sector) {
        sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + shares * price);
      }
      opened++;
      // 주문 예약 알림(phase=RESERVED) — "익일 시가 체결 예정" 의미. 체결 알림(FILLED)과 분리.
      await this.emitTradeEntry({
        portfolioId: pf.id,
        refId: reservation.id,
        corpCode: sig.corpCode,
        stockCode: sig.stockCode,
        price,
        shares,
        phase: 'RESERVED',
      });
    }
    return opened;
  }

  // DAR-498(P22): 섀도 원장 예약 취소 기록(guarded no-op). PaperTrade 취소 지점마다 1줄로 호출 —
  //   미체결 OrderRequest 를 CANCELLED 로 종결(섀도 라이트: 실패해도 매매 무영향).
  private async shadowCancel(
    t: { id: string; tradingSignalId: string | null },
    reason: string,
  ): Promise<void> {
    if (!t.tradingSignalId) return;
    await this.shadowLedger?.recordCancellation({
      tradingSignalId: t.tradingSignalId,
      paperTradeId: t.id,
      reason,
    });
  }

  // ─── 1-b) 개장 체결기: 매수 예약 → 당일 시가 체결 ─────────────────────
  /**
   * 만기 도래(entryDate ≤ tradeDate)한 PENDING 매수 예약을 '당일 시가'로 체결한다.
   *   - 시가 소스: 장중은 KIS 실시간 quote 의 open 필드(당일 시가·REALTIME), 장 마감 후 폴백은
   *     당일 REAL 일봉 open(KRX 18:30 게시). 당일 데이터 자체가 없으면 이월(PENDING 유지).
   *   - 이월 상한: 예약 체결 예정일로부터 PENDING_ENTRY_MAX_CARRY_TRADING_DAYS(3) 거래일 초과
   *     → CANCELLED 기록(무한 이월 방지).
   *   - 현금 재클램프: 체결 시점 SSOT 현금(초기+실현−보유원가) 이내로 수량 절삭 — cash≥0 불변식.
   *   - 예산 envelope: 주문수량×예약 기준가 이내(갭업 시 수량 축소 — maxSinglePositionPct 보존).
   *   ★순수 Rule 체결(simulateFill) — AI 개입 0. 실주문 경로 0.
   */
  private async fillPendingEntries(
    portfolioId: string,
    tradeDate: string,
    opts: { now?: Date } = {},
  ): Promise<number> {
    const pending = await this.prisma.paperTrade.findMany({
      where: {
        status: 'PENDING',
        direction: 'BUY',
        styleTag: PaperSimulationService.TRADE_STRATEGY_KEY,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length === 0) return 0;

    // 만기 도래분만(미래 예약은 그대로). 이월 상한 초과분은 취소 기록.
    const due: typeof pending = [];
    for (const t of pending) {
      const entryYmd = formatKstDateCompact(t.entryDate);
      if (entryYmd > tradeDate) continue; // 아직 체결 예정일 전
      if (
        tradingDayDiff(entryYmd, tradeDate) >
        PaperSimulationService.PENDING_ENTRY_MAX_CARRY_TRADING_DAYS
      ) {
        await this.prisma.paperTrade.update({
          where: { id: t.id },
          data: { status: 'CANCELLED' },
        });
        this.logger.warn(
          `[PaperSim][체결기] 예약 취소(이월 상한 초과) trade=${t.id} corp=${t.corpCode} 예정일=${entryYmd}`,
        );
        await this.shadowCancel(t, '이월 상한 초과(미체결 예약)');
        continue;
      }
      due.push(t);
    }
    if (due.length === 0) return 0;
    // F6: kill-switch 발동 시 신규 진입(예약 체결 포함) 차단 — 예약은 유지(이월 상한이 정리).
    if (this.killSwitch?.isActive()) {
      this.logger.warn('[PaperSim][체결기] 킬스위치 발동 — 예약 체결 보류');
      return 0;
    }

    // 체결 직전 대상 종목 실시간 warm(장중만 유효 — 장외 게이트가 no-op) → 당일 시가(REALTIME open).
    await this.warmRealtimeQuotes(due, opts.now ?? new Date());

    // 체결 시점 현금 재산정(SSOT) + 보유 종목 디듑.
    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { corpCode: true, entryAmount: true },
    });
    const closedForCash = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED' },
      select: { unrealizedPnl: true },
    });
    const realizedNetPnl = closedForCash.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const investedPrincipal = openPositions.reduce((s, p) => s + (p.entryAmount ?? 0), 0);
    let availableCash = PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl - investedPrincipal;
    const heldCorpCodes = new Set(openPositions.map((p) => p.corpCode));

    let filled = 0;
    for (const t of due) {
      // 이미 보유(중복 방지 — 예약 후 다른 경로 진입 등) → 예약 취소 기록.
      if (heldCorpCodes.has(t.corpCode)) {
        await this.prisma.paperTrade.update({
          where: { id: t.id },
          data: { status: 'CANCELLED' },
        });
        await this.shadowCancel(t, '이미 보유(중복 진입 방지)');
        continue;
      }
      if (availableCash <= 0) continue; // 현금 없음 — 이월(청산으로 회복 가능, 상한이 정리)

      // 당일 시가 행 — 당일 데이터 없으면 이월(스테일 가격 체결 금지).
      const openRow = await this.openPriceRowFor(t.corpCode, tradeDate);
      if (!openRow) continue;
      const openPrice = openRow.openPrice > 0 ? openRow.openPrice : openRow.closePrice;
      if (openPrice <= 0) continue;

      // 예산 envelope = 주문수량 × 예약 기준가(결정 시점 사이징 보존) ∧ 가용현금.
      const reservedBudget = t.orderedShares * Number(t.entryPrice);
      const budget = Math.min(reservedBudget, availableCash);
      if (budget <= 0) continue;
      // F8 Phase2 보수 사이징(동적 슬리피지 반영가 기준) — openNewPositions 와 동일 규칙.
      const dayVol = Number(openRow.volume ?? 0);
      const baseEffPrice = roundToTick(openPrice * (1 + DEFAULT_FILL_PARAMS.slippagePct), 'BUY');
      const baseShares = Math.floor(budget / baseEffPrice);
      const estParticipation = dayVol > 0 ? baseShares / dayVol : 0;
      const effSlippage =
        DEFAULT_FILL_PARAMS.slippagePct +
        (DEFAULT_FILL_PARAMS.impactCoeff ?? 0.015) * Math.sqrt(estParticipation);
      const effPrice = roundToTick(openPrice * (1 + effSlippage), 'BUY');
      const shares = Math.min(t.orderedShares, Math.floor(budget / effPrice));
      if (shares <= 0) continue; // 갭업 등으로 1주도 불가 — 이월(상한이 정리)

      const fill = simulateFill(
        { direction: 'BUY', orderedShares: shares, entryPrice: openPrice, dayVolume: dayVol },
        DEFAULT_FILL_PARAMS,
      );
      if (fill.filledShares <= 0) continue;
      const fillPrice = fill.filledPrice;

      // 청산 파라미터는 체결 시점에 thesis 에서 도출(예약엔 미저장 — 스키마 변경 0).
      const thesis = t.positionThesisId
        ? await this.prisma.positionThesis.findUnique({
            where: { id: t.positionThesisId },
            select: { exitRules: true },
          })
        : null;
      const { stopLossPct, maxHoldDays } = this.deriveExitParams(thesis?.exitRules);

      let createdPositionId: string | null = null;
      try {
        const createdPos = await this.prisma.position.create({
          data: {
            portfolioId,
            corpCode: t.corpCode,
            stockCode: t.stockCode,
            positionThesisId: t.positionThesisId ?? null,
            entryDate: new Date(),
            entryPrice: fillPrice,
            // DAR-433 정렬용 진입 소스 = 체결에 실제 쓴 시가 행의 소스(REALTIME|REAL|SYNTHETIC).
            entryPriceSource: openRow.source,
            quantity: fill.filledShares,
            entryAmount: fillPrice * fill.filledShares,
            currentPrice: fillPrice,
            currentValue: fillPrice * fill.filledShares,
            unrealizedPnl: 0,
            unrealizedPnlPct: 0,
            highestPrice: fillPrice,
            highestAt: new Date(),
            stopLossPct,
            takeProfitPct: PaperSimulationService.DEFAULT_TAKE_PROFIT_PCT,
            maxHoldDays,
            status: 'OPEN',
          },
          select: { id: true },
        });
        createdPositionId = createdPos.id;
      } catch (err) {
        // DAR-122: 부분 유니크(portfolioId, stockCode WHERE status='OPEN') 충돌 → 이미 보유 →
        //   예약 취소(멱등).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          await this.prisma.paperTrade.update({
            where: { id: t.id },
            data: { status: 'CANCELLED' },
          });
          await this.shadowCancel(t, '부분 유니크 충돌(이미 보유)');
          heldCorpCodes.add(t.corpCode);
          continue;
        }
        throw err;
      }

      // 예약(PENDING) → 체결 확정: 같은 원장 행을 갱신(주문 1건 = 행 1건 보존).
      //   entryPrice 는 '진입 기준가(체결일 시가)'로 갱신 — 스키마 주석 시맨틱과 일치.
      //   ★DAR-474: expectedPrice(신호시점 기대가)는 여기서 **덮어쓰지 않는다** — 예약 시점 값을
      //     보존해야 신호→체결 슬리피지가 측정 가능하다(측정 표면 전제).
      await this.prisma.paperTrade.update({
        where: { id: t.id },
        data: {
          orderedShares: shares,
          filledShares: fill.filledShares,
          fillRate: fill.fillRate,
          entryPrice: openPrice,
          filledPrice: fillPrice,
          commission: fill.commission,
          tax: fill.tax,
          slippage: fill.slippageCost,
          status: fill.status,
          filledAt: new Date(),
        },
      });
      heldCorpCodes.add(t.corpCode);
      // DAR-498(P22): 섀도 원장 — 체결(FILLED) 확정 직후 병행 기록. ExecutionPort(전송·체결확인)가
      //   동일 입력(수량·시가·거래량)으로 결정론적 체결을 확인해 OrderExecution 생성 + OrderRequest
      //   EXECUTED 연결. ★섀도 라이트: 실패해도 체결·현금·매매 무영향(서비스 내부 try/catch).
      if (t.tradingSignalId) {
        await this.shadowLedger?.recordFill({
          tradingSignalId: t.tradingSignalId,
          paperTradeId: t.id,
          corpCode: t.corpCode,
          stockCode: t.stockCode,
          orderedShares: shares,
          referencePrice: openPrice,
          dayVolume: dayVol,
          executedAt: new Date(),
        });
      }
      // F7: 매수 수수료 포함 실지출 차감 — cash≥0 불변식.
      availableCash -= fillPrice * fill.filledShares + fill.commission;
      filled++;
      // 체결 알림(phase=FILLED) — 예약 알림과 별개 refId(포지션)로 발행.
      if (createdPositionId) {
        await this.emitTradeEntry({
          portfolioId,
          refId: createdPositionId,
          corpCode: t.corpCode,
          stockCode: t.stockCode,
          price: fillPrice,
          shares: fill.filledShares,
          phase: 'FILLED',
        });
      }
    }
    if (filled > 0) {
      this.logger.log(`[PaperSim][체결기] 예약 ${filled}건 당일 시가 체결 tradeDate=${tradeDate}`);
    }
    return filled;
  }

  // ─── 1-c) 개장 체결기: 이연 청산 판정 → 당일 시가 체결 ────────────────
  /**
   * 전일(장외) Exit 판정이 이연 마킹(ExitSignal.scoreDetail.deferredFill=true)된 OPEN 포지션을
   * '당일 시가'로 매도 체결한다 — 장외 악재 판정의 갭다운이 체결가에 정직하게 반영된다.
   *   - 포지션별 최신 EXIT 판정 신호만 본다(과거 잔여 신호 무시). 체결 후 신호에 소진 마킹.
   *   - 당일 시가 데이터 없으면 이월(다음 틱/사이클 재시도 — 포지션은 반드시 청산 경로 유지).
   *   ★순수 Rule — AI 개입 0.
   */
  private async executePendingExits(
    portfolioId: string,
    tradeDate: string,
    opts: { now?: Date; emitTrades?: boolean } = {},
  ): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });
    if (positions.length === 0) return 0;
    const signals = await this.prisma.exitSignal.findMany({
      where: {
        positionId: { in: positions.map((p) => p.id) },
        exitAction: { in: [...EXIT_ACTIONS] as never },
      },
      orderBy: { checkedAt: 'desc' },
      select: {
        id: true,
        positionId: true,
        exitAction: true,
        triggerType: true,
        scoreDetail: true,
      },
    });
    // 포지션별 최신 EXIT 신호 1건(checkedAt desc → 최초 등장이 최신).
    const latestByPosition = new Map<string, (typeof signals)[number]>();
    for (const s of signals) {
      if (!latestByPosition.has(s.positionId)) latestByPosition.set(s.positionId, s);
    }

    let executed = 0;
    for (const p of positions) {
      const sig = latestByPosition.get(p.id);
      if (!sig) continue;
      const detail =
        sig.scoreDetail && typeof sig.scoreDetail === 'object'
          ? (sig.scoreDetail as Record<string, unknown>)
          : {};
      if (detail.deferredFill !== true) continue; // 이연 마킹 없는 신호(장중 즉시 체결분 등)

      const openRow = await this.openPriceRowFor(p.corpCode, tradeDate);
      if (!openRow) continue; // 당일 시가 부재 — 이월(스테일 체결 금지)
      const sellPrice = openRow.openPrice > 0 ? openRow.openPrice : openRow.closePrice;
      if (sellPrice <= 0) continue;

      const sold = await this.executeSell(
        portfolioId,
        p,
        sellPrice,
        sig.triggerType ?? null,
        sig.exitAction,
        opts.emitTrades !== false,
      );
      if (!sold) continue;
      executed++;
      // 신호 소진 마킹 — 부분 익절(잔량 OPEN)이 다음 체결기에서 재발화하지 않게.
      await this.prisma.exitSignal.update({
        where: { id: sig.id },
        data: {
          scoreDetail: {
            ...detail,
            deferredFill: false,
            deferredFilledDate: tradeDate,
            deferredFillPrice: sellPrice,
          } as Prisma.InputJsonValue,
        },
      });
    }
    if (executed > 0) {
      this.logger.log(
        `[PaperSim][체결기] 이연 청산 ${executed}건 당일 시가 체결 tradeDate=${tradeDate}`,
      );
    }
    return executed;
  }

  /**
   * 체결기용 '해당 거래일 당일' 시가 행. priceSource 주입 시 소스 추상화(openRowForDate —
   * 실시간 open 1순위, 당일 REAL/SYNTHETIC 일봉 폴백)에 위임하고, 미주입(레거시 테스트)은
   * StockDailyPrice 당일 행 직접 조회. 당일 데이터 없으면 null(호출측 이월).
   */
  private async openPriceRowFor(corpCode: string, tradeDate: string): Promise<SimPriceRow | null> {
    if (this.priceSource) return this.priceSource.openRowForDate(corpCode, tradeDate);
    const row = await this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate },
      select: {
        openPrice: true,
        highPrice: true,
        lowPrice: true,
        closePrice: true,
        volume: true,
      },
    });
    return row ? { ...row, source: 'REAL', sourceDate: tradeDate } : null;
  }

  /** YYYYMMDD → 그 KST 날짜 자정의 절대 시각(Date). 예약 체결 예정 거래일 영속용. */
  private kstMidnight(ymd: string): Date {
    return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);
  }

  // ─── 2) 일일 시가평가 ─────────────────────────────────────────────────
  private async snapshotOpenPositions(portfolioId: string, tradeDate: string): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });
    let n = 0;
    for (const p of positions) {
      // DAR-433: 스냅샷 평가가도 진입 소스로 정렬(영속 미실현손익이 cross-source 가짜갭으로 깔리지 않게).
      const day = await this.alignedPriceRow(p.corpCode, tradeDate, p.entryPriceSource);
      if (!day) continue;
      const close = day.closePrice;
      const positionValue = close * p.quantity;
      const unrealizedPnl = (close - p.entryPrice) * p.quantity;
      const unrealizedPnlPct = p.entryPrice > 0 ? ((close - p.entryPrice) / p.entryPrice) * 100 : 0;
      const highest = Math.max(p.highestPrice ?? p.entryPrice, close);

      await this.prisma.positionDailySnapshot.upsert({
        where: { positionId_snapshotDate: { positionId: p.id, snapshotDate: tradeDate } },
        create: {
          positionId: p.id,
          snapshotDate: tradeDate,
          openPrice: day.openPrice,
          closePrice: close,
          highPrice: day.highPrice,
          lowPrice: day.lowPrice,
          volume: day.volume,
          quantity: p.quantity,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
        },
        update: {
          closePrice: close,
          positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
        },
      });
      await this.prisma.position.update({
        where: { id: p.id },
        data: {
          currentPrice: close,
          currentValue: positionValue,
          unrealizedPnl,
          unrealizedPnlPct,
          highestPrice: highest,
          highestAt: highest > (p.highestPrice ?? 0) ? new Date() : p.highestAt,
        },
      });
      n++;
    }
    return n;
  }

  // ─── 3) Exit 평가 ─────────────────────────────────────────────────────
  // DAR-364: 손절/익절 평가가 쓰는 현재가는 latestPriceRow = 실시간 실가(REALTIME) 1순위 →
  //   실 KRX 일봉(REAL) → 합성(SYNTHETIC) 폴백이다. 사용자가 화면에서 보는 실시간 실가가
  //   곧 하드 스탑로스 평가에 쓰이는 가격이므로(표시=엔진), 실가 -8% 이하면 손절 EXIT 이 발화한다.
  //
  // ★장외 체결 의미론(2026-07): 경로별 체결 시점이 다르다.
  //   - intraday=true(장중 모니터): 실시간 실가 판정 → **즉시 체결**(기존 동작 유지 — 실효 손절).
  //   - intraday=false(19:30 일일 사이클): **판정·기록만**(ExitSignal.scoreDetail.deferredFill=true).
  //     체결은 익일 시가(executePendingExits) — 장외 악재의 갭다운이 체결가에 정직 반영.
  //   반환값: intraday 는 체결 건수, 일일 경로는 '이연 판정' 건수.
  private async evaluateExits(
    portfolioId: string,
    tradeDate: string,
    opts: { intraday?: boolean; emitTrades?: boolean } = {},
  ): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });
    const exitRepo = new PrismaExitSignalRepository(this.prisma);
    let exited = 0;

    for (const p of positions) {
      // DAR-433 + F1: 일일 경로는 진입소스 정렬(가짜손절 차단). 장중 경로는 실시간 1순위로 평가하되
      //   진입=REAL 정체 일봉이면 신선도 가드로 폴백(장중 실시간 손절 복원 ↔ 가짜손절 차단 양립).
      const day = await this.exitPriceRow(
        p.corpCode,
        tradeDate,
        p.entryPriceSource,
        opts.intraday === true,
      );
      if (!day) continue;
      const close = day.closePrice;

      const posSnap: PositionSnapshot = {
        id: p.id,
        corpCode: p.corpCode,
        stockCode: p.stockCode,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        entryAmount: p.entryAmount,
        currentPrice: close,
        highestPrice: p.highestPrice ?? close,
        stopLossPct: p.stopLossPct,
        takeProfitPct: p.takeProfitPct,
        maxHoldDays: p.maxHoldDays,
        entryDate: p.entryDate,
        portfolioTotalValue: PaperSimulationService.INITIAL_CAPITAL,
        portfolioMaxSinglePositionPct: 10,
        portfolioMaxSectorPct: 30,
        portfolioMaxDailyLossPct: 2,
        portfolioDailyLossPct: null,
      };
      // F3(2026-06-26): 실 기술지표·악재 공시를 주입해 6 Exit 트리거를 복원
      //   (과거 tech=null·events=[] 빈 입력 → 사실상 -8% 단일 하드스탑으로 붕괴하던 결함 해소).
      const tech = await this.loadExitTechnicalSnapshot(p.stockCode, p.corpCode, day, close);
      const events = await this.loadNegativeDisclosureEvents(
        p.corpCode,
        p.entryDate,
        day,
        tradeDate,
      );
      const thesisSnap = await this.loadThesisSnapshot(p.positionThesisId);

      const exit = calculateExitScore(posSnap, tech, thesisSnap, events);
      const isExitAction = EXIT_ACTIONS.has(exit.exitAction);

      await exitRepo.save({
        positionId: p.id,
        // 경로별 정직 표기: 장중 모니터 평가는 INTRADAY, 19:30 일일 사이클은 POST_MARKET.
        checkTime: opts.intraday ? 'INTRADAY' : 'POST_MARKET',
        components: exit.components,
        exitScore: exit.exitScore,
        exitAction: exit.exitAction,
        triggerTypes: exit.triggerTypes,
        primaryTrigger: exit.primaryTrigger,
        scoreDetail: {
          source: 'DAR-40 paper-sim',
          tradeDate,
          triggers: exit.triggerTypes,
          // DAR-364: 평가에 쓴 가격의 출처/원일자 — 정직 고지(REALTIME 이면 실시간 실가로 손절 평가).
          priceSource: day.source,
          priceSourceDate: day.sourceDate ?? null,
          // 장외 체결 의미론: 일일 경로의 EXIT 판정은 체결을 익일 시가로 이연 — 체결기가 이
          //   마킹을 보고 당일 시가로 매도한 뒤 소진(false) 처리한다.
          ...(isExitAction && !opts.intraday ? { deferredFill: true } : {}),
        },
      });

      // 스냅샷에 exit 결과 기록(있으면)
      await this.prisma.positionDailySnapshot.updateMany({
        where: { positionId: p.id, snapshotDate: tradeDate },
        data: { exitScore: exit.exitScore, exitAction: exit.exitAction },
      });

      if (isExitAction) {
        // DAR-85: 청산 권고 통지 enqueue(graceful — 모의 매도 체결을 깨지 않음).
        // ★권고일 뿐 자동 실주문/Kill 직결 아님. 수신자는 포트폴리오 소유자.
        await this.notifyProducer?.enqueueExit({
          positionId: p.id,
          corpCode: p.corpCode,
          stockCode: p.stockCode,
          exitAction: exit.exitAction,
          triggerTypes: exit.triggerTypes,
        });
        if (!opts.intraday) {
          // 일일(장외) 경로: 판정·기록만 — 체결은 익일 시가(executePendingExits)로 이연.
          //   당일 종가 즉시 체결은 정보시점>가격시점 상향 편향(진단 확정 결함)이라 금지.
          exited++;
          continue;
        }
        const sold = await this.executeSell(
          portfolioId,
          p,
          close,
          exit.primaryTrigger ?? null,
          exit.exitAction,
          opts.emitTrades !== false,
        );
        if (sold) exited++;
      }
    }
    return exited;
  }

  /**
   * 모의 매도 체결 실행(공용) — 장중 즉시 손절(evaluateExits intraday)과 이연 청산 체결기
   * (executePendingExits)가 동일 로직을 쓴다. F2 부분 익절(TAKE_PROFIT 스케일아웃)·F7 매수
   * 수수료 회계 포함. ★순수 Rule 체결(simulateFill 경유 placeOrder) — 실주문 0·AI 개입 0.
   */
  private async executeSell(
    portfolioId: string,
    p: {
      id: string;
      corpCode: string;
      stockCode: string;
      entryPrice: number;
      quantity: number;
      entryAmount: number;
      entryDate: Date;
      positionThesisId: string | null;
      entryPriceSource?: string | null;
    },
    sellBasePrice: number,
    primaryTrigger: string | null,
    exitAction: string,
    emitTrades: boolean,
  ): Promise<boolean> {
    // F2(2026-06-27): 익절(TAKE_PROFIT)은 부분 스케일아웃(잔량 보유), 그 외 EXIT 은 전량 청산.
    const isTakeProfit = primaryTrigger === 'TAKE_PROFIT';
    const scaleOutQty = isTakeProfit
      ? Math.floor(p.quantity * PaperSimulationService.TAKE_PROFIT_SCALE_OUT_FRACTION)
      : p.quantity;
    const partial = isTakeProfit && scaleOutQty >= 1 && scaleOutQty < p.quantity;
    const sellQty = partial ? scaleOutQty : p.quantity;
    if (sellQty <= 0) return false;

    const sell = await this.paperTrade.placeOrder({
      corpCode: p.corpCode,
      stockCode: p.stockCode,
      direction: 'SELL',
      orderedShares: sellQty,
      entryPrice: sellBasePrice,
      entryDate: new Date(),
      liquidityRatio: 1.0,
      positionThesisId: p.positionThesisId ?? undefined,
    });
    if (sell.filledShares <= 0) return false;
    const sellPrice = sell.filledPrice ?? sellBasePrice;
    const grossPnl = (sellPrice - p.entryPrice) * sell.filledShares;
    // F7(2026-06-27): 매수 수수료(체결 시 부과되나 회계서 누락되던) 차감 — 보고 순손익 정확화.
    //   매도분(부분/전량 공통) 비례 매수 수수료 = 진입원가×(매도주수/총주수)×commissionRate.
    const buyCommission =
      p.quantity > 0
        ? ((p.entryAmount * sell.filledShares) / p.quantity) * DEFAULT_FILL_PARAMS.commissionRate
        : 0;
    const netPnl = grossPnl - buyCommission - sell.commission - sell.tax;
    const returnPct = p.entryPrice > 0 ? ((sellPrice - p.entryPrice) / p.entryPrice) * 100 : 0;

    // 모의 매도 체결에 실현손익 기록
    await this.prisma.paperTrade.update({
      where: { id: sell.id },
      data: { grossPnl, netPnl, returnPct },
    });

    if (partial) {
      // 부분 익절: 매도분을 합성 CLOSED 행으로 기록(기존 CLOSED 실현손익 집계가 자동 반영)하고
      //   OPEN 잔량(quantity·entryAmount)을 비례 축소해 잔량을 계속 보유한다. 스키마 변경 0.
      //   ★현금 정합: 매도분이 CLOSED net 으로 실현손익에 들어가고 OPEN entryAmount 가 줄어
      //   cash(=초기+실현−보유원가)가 정확히 매도대금만큼 증가(검증식 확인).
      const soldEntryAmount = p.entryAmount * (sell.filledShares / p.quantity);
      const remainingQty = p.quantity - sell.filledShares;
      await this.prisma.position.create({
        data: {
          portfolioId,
          corpCode: p.corpCode,
          stockCode: p.stockCode,
          positionThesisId: null, // @unique — OPEN 원포지션이 thesisId 보유, 합성행은 null
          entryDate: p.entryDate,
          entryPrice: p.entryPrice,
          quantity: sell.filledShares,
          entryAmount: soldEntryAmount,
          entryPriceSource: p.entryPriceSource,
          status: 'CLOSED',
          closedAt: new Date(),
          currentPrice: sellPrice,
          currentValue: sellPrice * sell.filledShares,
          unrealizedPnl: netPnl, // 실현손익(CLOSED unrealizedPnl 오버로드 — 기존 회계 규약)
          unrealizedPnlPct: returnPct,
        },
      });
      await this.prisma.position.update({
        where: { id: p.id },
        data: {
          quantity: remainingQty,
          entryAmount: p.entryAmount - soldEntryAmount,
          currentPrice: sellBasePrice,
          currentValue: sellBasePrice * remainingQty,
          unrealizedPnl: (sellBasePrice - p.entryPrice) * remainingQty,
          unrealizedPnlPct:
            p.entryPrice > 0 ? ((sellBasePrice - p.entryPrice) / p.entryPrice) * 100 : 0,
        },
      });
    } else {
      await this.prisma.position.update({
        where: { id: p.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          currentPrice: sellPrice,
          currentValue: sellPrice * sell.filledShares,
          unrealizedPnl: netPnl,
          unrealizedPnlPct: returnPct,
        },
      });
    }
    // DAR-424 매도 체결 알림(graceful — CLOSED 영속 직후 스냅샷 산출).
    //   exitReason 은 주 트리거(없으면 exitAction) 사용. 시스템 모의 외 트랙은 emitTrades=false
    //   (라벨 오표기 방지 — 트랙별 알림은 각 러너 소관).
    if (emitTrades) {
      await this.emitTradeExit({
        portfolioId,
        refId: p.id,
        corpCode: p.corpCode,
        stockCode: p.stockCode,
        price: sellPrice,
        shares: sell.filledShares,
        pnlPct: returnPct,
        exitReason: primaryTrigger ?? exitAction,
      });
    }
    return true;
  }

  // ─── DAR-424 체결 알림 ────────────────────────────────────────────────
  /**
   * 체결 알림용 포트폴리오 스냅샷 — 현금·전체 평가금. computeMetrics 의 equity 정의와 일치:
   *   totalValue = 초기자본 + 실현손익(CLOSED unrealizedPnl) + 미실현손익(OPEN unrealizedPnl)
   *   cash = totalValue − 보유 평가합(OPEN currentValue)
   *   (저장 스냅샷값 사용 — 보유 종목 시세 재조회 없음·N+1 미발생.)
   */
  private async computeSimSnapshot(
    portfolioId: string,
  ): Promise<{ cash: number; totalValue: number }> {
    const [open, closed] = await Promise.all([
      this.prisma.position.findMany({
        where: { portfolioId, status: 'OPEN' },
        select: { currentValue: true, entryAmount: true, unrealizedPnl: true },
      }),
      this.prisma.position.findMany({
        where: { portfolioId, status: 'CLOSED' },
        select: { unrealizedPnl: true },
      }),
    ]);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const unrealizedPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const totalValue = PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;
    const openValue = open.reduce((s, p) => s + (p.currentValue ?? p.entryAmount ?? 0), 0);
    return { cash: totalValue - openValue, totalValue };
  }

  /** DAR-424: 종목명(Company.corpName) — 없으면 stockCode 폴백. */
  private async corpNameOf(corpCode: string, stockCode: string): Promise<string> {
    const c = await this.prisma.company.findUnique({
      where: { corpCode },
      select: { corpName: true },
    });
    return c?.corpName ?? stockCode;
  }

  /** DAR-424: 매수 알림 발행(graceful — 체결을 깨지 않는다).
   *  장외 체결 의미론: phase='RESERVED'(주문 예약 — 익일 시가 체결 예정) vs 'FILLED'(시가 체결).
   *  phase 는 additive optional 필드 — 기존 소비자는 무시해도 동작(호환 유지). */
  private async emitTradeEntry(args: {
    portfolioId: string;
    refId: string;
    corpCode: string;
    stockCode: string;
    price: number;
    shares: number;
    phase: 'RESERVED' | 'FILLED';
  }): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      const [snapshot, corpName] = await Promise.all([
        this.computeSimSnapshot(args.portfolioId),
        this.corpNameOf(args.corpCode, args.stockCode),
      ]);
      await this.notifyProducer.enqueueTradeEntry({
        kind: 'ENTRY',
        phase: args.phase,
        refId: args.refId,
        strategyKey: PaperSimulationService.TRADE_STRATEGY_KEY,
        strategyLabel: PaperSimulationService.TRADE_STRATEGY_LABEL,
        corpCode: args.corpCode,
        stockCode: args.stockCode,
        corpName,
        price: args.price,
        shares: args.shares,
        cash: snapshot.cash,
        totalValue: snapshot.totalValue,
        deepLink: PaperSimulationService.TRADE_DEEP_LINK,
      });
    } catch (e) {
      this.logger.warn(`[PaperSim] 매수 체결 알림 발행 실패(graceful): ${(e as Error).message}`);
    }
  }

  /** DAR-424: 매도 체결 알림 발행(graceful). */
  private async emitTradeExit(args: {
    portfolioId: string;
    refId: string;
    corpCode: string;
    stockCode: string;
    price: number;
    shares: number;
    pnlPct: number;
    exitReason: string;
  }): Promise<void> {
    if (!this.notifyProducer) return;
    try {
      const [snapshot, corpName] = await Promise.all([
        this.computeSimSnapshot(args.portfolioId),
        this.corpNameOf(args.corpCode, args.stockCode),
      ]);
      await this.notifyProducer.enqueueTradeExit({
        kind: 'EXIT',
        refId: args.refId,
        strategyKey: PaperSimulationService.TRADE_STRATEGY_KEY,
        strategyLabel: PaperSimulationService.TRADE_STRATEGY_LABEL,
        corpCode: args.corpCode,
        stockCode: args.stockCode,
        corpName,
        price: args.price,
        shares: args.shares,
        pnlPct: args.pnlPct,
        exitReason: args.exitReason,
        cash: snapshot.cash,
        totalValue: snapshot.totalValue,
        deepLink: PaperSimulationService.TRADE_DEEP_LINK,
      });
    } catch (e) {
      this.logger.warn(`[PaperSim] 매도 체결 알림 발행 실패(graceful): ${(e as Error).message}`);
    }
  }

  // ─── 4) 누적 지표 ─────────────────────────────────────────────────────
  // DAR-364: openUnrealizedPnlOverride 가 주어지면(상태 조회 경로) 보유 포지션 미실현손익 합을
  //   '실시간 실가로 재평가한 표시값'으로 대체해 equity·누적수익률이 화면 표시와 동일 가격을 쓰게 한다
  //   (표시=엔진). 미지정(equity-curve·사이클 경로)이면 저장 스냅샷값 합을 쓴다 — DAR-206 grouped
  //   쿼리 형태 보존(보유 포지션당 시세 재조회 없음, N+1 미발생).
  private async computeMetrics(
    portfolioId: string,
    openUnrealizedPnlOverride?: number,
  ): Promise<{
    metrics: SimulationMetrics;
    equity: number;
    openPositions: number;
  }> {
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { id: true, entryPrice: true, quantity: true, unrealizedPnl: true, entryDate: true },
    });
    const closed = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED' },
      select: {
        id: true,
        entryPrice: true,
        currentPrice: true,
        quantity: true,
        unrealizedPnl: true,
        closedAt: true,
        corpCode: true,
      },
    });

    // DAR-364: 상태 조회는 표시(실시간 실가 재평가)와 동일한 보유 미실현손익을 쓴다(override).
    //   미지정이면 저장 스냅샷값 합(회귀 0·N+1 미발생).
    const unrealizedPnl =
      openUnrealizedPnlOverride ?? open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const equity = PaperSimulationService.INITIAL_CAPITAL + realizedNetPnl + unrealizedPnl;

    // 신호 적중률(D+5): 스냅샷 6개(D0~D5) 이상 보유한 포지션의 진입가 대비 D+5 수익률
    // DAR-206: 포지션별 findMany(N+1) → positionId in(...) 단일 grouped 쿼리 후 메모리 그룹핑.
    const allPositions = [...open, ...closed];
    const snapsByPosition = await this.snapshotsByPosition(
      allPositions.map((p) => p.id),
      6,
    );
    const signalOutcomes: SignalOutcome[] = allPositions.map((p) => {
      const snaps = snapsByPosition.get(p.id) ?? [];
      if (snaps.length >= 6 && snaps[5].closePrice && p.entryPrice > 0) {
        return {
          d5ReturnPct: ((snaps[5].closePrice - p.entryPrice) / p.entryPrice) * 100,
        };
      }
      return { d5ReturnPct: null };
    });

    // Exit 정확도(D+3): 청산 후 3거래일 종가 변화율 (음수면 손절 적중)
    // DAR-206: 청산 포지션별 closesAfter(N+1) → corpCode in(...) 단일 grouped 쿼리(폴백)/배치 소스.
    const exitRequests = closed
      .filter((p): p is typeof p & { closedAt: Date } => p.closedAt != null)
      .map((p) => ({ corpCode: p.corpCode, afterTradeDate: this.toBasDd(p.closedAt) }));
    const exitCloses = await this.closesAfterMany(exitRequests, 3);
    const exitOutcomes: ExitOutcome[] = [];
    let exitIdx = 0;
    for (const p of closed) {
      if (!p.closedAt) {
        exitOutcomes.push({ d3ReturnPct: null });
        continue;
      }
      const after = exitCloses[exitIdx++];
      // Exit Accuracy 는 '내가 청산한 가격 대비 이후 더 떨어졌나(=청산이 옳았나)'를 측정해야 한다.
      // CLOSED 포지션은 청산 시 currentPrice=청산가(sellPrice)로 저장된다(위 closePositions 참조).
      // 청산가 우선, 결측 시에만 보수적으로 entryPrice 폴백.
      const exitPx = p.currentPrice ?? p.entryPrice;
      if (after.length >= 3 && exitPx > 0) {
        exitOutcomes.push({ d3ReturnPct: ((after[2].closePrice - exitPx) / exitPx) * 100 });
      } else {
        exitOutcomes.push({ d3ReturnPct: null });
      }
    }

    // AI 비용 — AIUsageLog 전체 합(USD→KRW)
    const aiAgg = await this.prisma.aIUsageLog.aggregate({ _sum: { costUsd: true } });
    const totalAiCostKrw = (aiAgg._sum.costUsd ?? 0) * PaperSimulationService.USD_TO_KRW;

    const metrics = calculateSimulationMetrics({
      signalOutcomes,
      exitOutcomes,
      initialCapital: PaperSimulationService.INITIAL_CAPITAL,
      currentEquity: equity,
      realizedNetPnl,
      unrealizedPnl,
      totalAiCostKrw,
    });
    return { metrics, equity, openPositions: open.length };
  }

  private async savePortfolioSnapshot(
    portfolioId: string,
    tradeDate: string,
    equity: number,
    metrics: SimulationMetrics,
    openPositions: number,
  ): Promise<void> {
    const unrealizedPnl = metrics.netPnl;
    await this.prisma.portfolioRiskSnapshot.upsert({
      where: { portfolioId_snapshotDate: { portfolioId, snapshotDate: tradeDate } },
      create: {
        portfolioId,
        snapshotDate: tradeDate,
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: metrics.cumulativeReturnPct,
        topPositionPct: 0,
        openPositionCount: openPositions,
        riskLevel: 'NORMAL',
        hardRuleDetail: this.metricsSummary(metrics),
      },
      update: {
        totalValue: equity,
        unrealizedPnl,
        unrealizedPnlPct: metrics.cumulativeReturnPct,
        openPositionCount: openPositions,
        hardRuleDetail: this.metricsSummary(metrics),
      },
    });
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────────────────
  private metricsSummary(m: SimulationMetrics): string {
    const pct = (v: number | null) => (v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`);
    return `적중률D5=${pct(m.hitRateD5)}(n=${m.hitRateSampleSize}) 누적=${m.cumulativeReturnPct.toFixed(2)}% Exit정확도D3=${pct(m.exitAccuracyD3)}(n=${m.exitAccuracySampleSize}) AI/순익=${m.aiCostToNetPnlRatio === null ? 'N/A' : m.aiCostToNetPnlRatio.toFixed(3)}`;
  }

  private deriveExitParams(exitRules: unknown): { stopLossPct: number; maxHoldDays: number } {
    let stopLossPct = PaperSimulationService.DEFAULT_STOP_LOSS_PCT;
    let maxHoldDays = PaperSimulationService.DEFAULT_MAX_HOLD_DAYS;
    if (Array.isArray(exitRules)) {
      for (const r of exitRules) {
        if (r && typeof r === 'object' && 'type' in r && 'value' in r) {
          const rule = r as { type: string; value: number };
          if (rule.type === 'STOP_LOSS_PCT' && typeof rule.value === 'number')
            stopLossPct = rule.value;
          if (rule.type === 'MAX_HOLD_DAYS' && typeof rule.value === 'number')
            maxHoldDays = rule.value;
        }
      }
    }
    return { stopLossPct, maxHoldDays };
  }

  private async loadThesisSnapshot(positionThesisId: string | null): Promise<ThesisSnapshot> {
    if (!positionThesisId) return { invalidConditions: [], maxHoldDays: null };
    const thesis = await this.prisma.positionThesis.findUnique({
      where: { id: positionThesisId },
      select: { invalidConditions: true },
    });
    const raw = thesis?.invalidConditions;
    const invalidConditions = Array.isArray(raw)
      ? (raw as Array<{ type: string; [k: string]: unknown }>)
      : [];
    return { invalidConditions, maxHoldDays: null };
  }

  // DAR-124: 시세 소스 추상화 경유. priceSource 미주입(기존 테스트)이면 종전대로
  //   StockDailyPrice 직접 읽기로 폴백(회귀 0). 합성 모드는 소스 내부에서 SimulatedDailyPrice 만 읽음.
  private async latestPriceRow(corpCode: string, tradeDate: string): Promise<SimPriceRow | null> {
    if (this.priceSource) return this.priceSource.latestPriceRow(corpCode, tradeDate);
    const row = await this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: { openPrice: true, highPrice: true, lowPrice: true, closePrice: true, volume: true },
    });
    // 미주입 폴백은 StockDailyPrice(실 KRX) 직접 읽기 → source='REAL'.
    return row ? { ...row, source: 'REAL' } : null;
  }

  /**
   * DAR-433: 보유 포지션 평가가를 '진입 소스'에 정렬해 cross-source 가짜손절을 막는다.
   *   진입가가 정체 일봉(REAL)으로 기록됐는데 청산만 실시간(REALTIME)으로 평가되면, 일봉이
   *   며칠 정체된 환경에서 진입 직후 -8~-18% 가짜손절이 발화한다(DAR-433 근본원인). 평가 소스를
   *   진입 소스로 정렬해 '진입=일봉 ↔ 청산=실시간' 혼합을 원천 차단한다(같은 소스끼리만 비교).
   *
   *   동작:
   *     - entrySource 미상(레거시 null)·priceSource 미주입: latestPriceRow 그대로(기존 동작·회귀 0).
   *     - latestPriceRow 결과 소스가 진입 소스와 같으면 그대로.
   *     - 다르면 진입 소스로 고정 조회(priceRowForSource). 조회 성공 시 그 행으로 평가(정렬),
   *       실패(예: 진입=REALTIME인데 지금 실시간 stale)면 latestPriceRow 결과 유지(폴백·정직).
   */
  private async alignedPriceRow(
    corpCode: string,
    tradeDate: string,
    entrySource: string | null | undefined,
  ): Promise<SimPriceRow | null> {
    const day = await this.latestPriceRow(corpCode, tradeDate);
    if (!day || !entrySource || day.source === entrySource) return day;
    if (!this.priceSource) return day;
    const aligned = await this.priceSource.priceRowForSource(
      corpCode,
      tradeDate,
      entrySource as SimPriceRow['source'],
    );
    return aligned ?? day;
  }

  /**
   * F1(2026-06-26): 청산 평가가 해석. 일일 경로는 alignedPriceRow(DAR-433 정렬) 그대로.
   * 장중(intraday) 경로는 실시간(REALTIME) 1순위로 평가하되, 진입소스=REAL(정체 일봉) 포지션은
   * '일봉 신선도 가드'를 적용한다 — REAL 일봉 sourceDate 와 실시간 sourceDate 의 거래일 차가
   * 임계(INTRADAY_REAL_FRESH_MAX_DAYS) 이하면 실시간 신뢰(장중 손절 발화), 초과(정체)면 정렬된
   * REAL 로 폴백(DAR-433 가짜손절 차단). 진입=실시간/합성/레거시는 가드 없이 정렬 동작 유지.
   */
  private async exitPriceRow(
    corpCode: string,
    tradeDate: string,
    entrySource: string | null | undefined,
    intraday: boolean,
  ): Promise<SimPriceRow | null> {
    if (!intraday) return this.alignedPriceRow(corpCode, tradeDate, entrySource);
    const day = await this.latestPriceRow(corpCode, tradeDate);
    // 실시간 부재(REAL/SYNTHETIC 폴백) → 진입소스 정렬 보존(DAR-433).
    if (!day || day.source !== 'REALTIME') {
      return this.alignedPriceRow(corpCode, tradeDate, entrySource);
    }
    // 진입=실시간/합성/레거시(null) → 실시간 그대로(정렬 불요·기존 동작).
    if (entrySource !== 'REAL' || !this.priceSource) return day;
    // 진입=REAL → 일봉 신선도 가드.
    const real = await this.priceSource.priceRowForSource(corpCode, tradeDate, 'REAL');
    if (!real?.sourceDate || !day.sourceDate) return day;
    const gap = tradingDayDiff(real.sourceDate, day.sourceDate);
    return gap > PaperSimulationService.INTRADAY_REAL_FRESH_MAX_DAYS ? real : day;
  }

  /**
   * F3(2026-06-26): 청산 평가용 기술지표 스냅샷. SYNTHETIC 소스는 실지표 미혼합(정직).
   * 목/DB 부재 시 null degrade(과거 빈 입력 동작 보존 → 회귀 0).
   */
  private async loadExitTechnicalSnapshot(
    stockCode: string,
    corpCode: string,
    day: SimPriceRow,
    close: number,
  ): Promise<TechnicalSnapshot> {
    const base: TechnicalSnapshot = {
      closePrice: close,
      openPrice: day.openPrice ?? null,
      ma5: null,
      ma20: null,
      low20: null,
      vwap: null,
      atr14: null,
      volumeRatio3d: null,
      excessReturn5d: null,
      avgVolumeRatio5d: null,
    };
    if (day.source === 'SYNTHETIC') return base; // 합성 트랙: 실지표 혼입 금지
    const at = day.sourceDate ?? '99999999';
    try {
      const ti = await this.prisma.technicalIndicator.findFirst({
        where: { stockCode, tradeDate: { lte: at } },
        orderBy: { tradeDate: 'desc' },
        select: { ma5: true, ma20: true, atr14: true, vwap: true },
      });
      const low20 = await this.low20From(corpCode, at);
      return {
        ...base,
        ma5: ti?.ma5 ?? null,
        ma20: ti?.ma20 ?? null,
        atr14: ti?.atr14 ?? null,
        vwap: ti?.vwap ?? null,
        low20,
      };
    } catch {
      return base; // 목/DB 부재 → 빈 지표로 degrade
    }
  }

  /** F3: 최근 20거래일 최저가(20일 저가 이탈 가점용, day.lowPrice 오용 교정). graceful. */
  private async low20From(corpCode: string, asOf: string): Promise<number | null> {
    try {
      const rows = await this.prisma.stockDailyPrice.findMany({
        where: { corpCode, tradeDate: { lte: asOf } },
        orderBy: { tradeDate: 'desc' },
        take: 20,
        select: { lowPrice: true },
      });
      if (rows.length === 0) return null;
      return Math.min(...rows.map((r) => r.lowPrice));
    } catch {
      return null;
    }
  }

  /**
   * F3: 보유기간 내 악재(NEGATIVE)·고위험 공시만 주입(호재 누적 거짓 EXIT 방지).
   * SYNTHETIC 소스는 [](실 공시 혼입 금지). rcpDt 상한은 999999 천장(당일 타임스탬프 공시 누락 방지).
   * 목/DB 부재 시 [] degrade.
   */
  private async loadNegativeDisclosureEvents(
    corpCode: string,
    entryDate: Date,
    day: SimPriceRow,
    asOf: string,
  ): Promise<DisclosureEvent[]> {
    if (day.source === 'SYNTHETIC') return [];
    const since = this.toBasDd(entryDate);
    const until = day.sourceDate ?? asOf;
    try {
      const rows = await this.prisma.disclosureEvent.findMany({
        where: {
          corpCode,
          OR: [
            { polarity: 'NEGATIVE' },
            { eventType: { in: [...HIGH_RISK_EVENT_TYPES] as EventType[] } },
          ],
          disclosure: { rcpDt: { gte: since, lte: `${until}999999` } },
        },
        select: { eventType: true, rcpNo: true },
      });
      return rows.map((r) => ({ type: String(r.eventType), rcpNo: r.rcpNo }));
    } catch {
      return [];
    }
  }

  /** 청산 후 N거래일 종가(소스 경유). priceSource 미주입이면 StockDailyPrice 폴백. */
  private async closesAfter(
    corpCode: string,
    afterTradeDate: string,
    take: number,
  ): Promise<Array<{ closePrice: number }>> {
    if (this.priceSource) return this.priceSource.closesAfter(corpCode, afterTradeDate, take);
    return this.prisma.stockDailyPrice.findMany({
      where: { corpCode, tradeDate: { gt: afterTradeDate } },
      orderBy: { tradeDate: 'asc' },
      select: { closePrice: true },
      take,
    });
  }

  /**
   * DAR-206: 여러 청산 포지션의 closesAfter 를 N+1 없이 일괄 조회(요청 순서 보존).
   *   - priceSource 주입: 소스 추상화의 배치 메서드(closesAfterMany)에 위임.
   *   - 폴백(미주입): corpCode in(...) + tradeDate > 최소 청산일 단일 조회 후 메모리에서
   *     요청별 afterTradeDate 초과분만 오름차순 take 개로 절단(per-call closesAfter 와 동치).
   */
  private async closesAfterMany(
    requests: Array<{ corpCode: string; afterTradeDate: string }>,
    take: number,
  ): Promise<Array<Array<{ closePrice: number }>>> {
    if (requests.length === 0) return [];
    if (this.priceSource) return this.priceSource.closesAfterMany(requests, take);

    const corpCodes = [...new Set(requests.map((r) => r.corpCode))];
    const minAfter = requests.reduce(
      (m, r) => (r.afterTradeDate < m ? r.afterTradeDate : m),
      requests[0].afterTradeDate,
    );
    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { corpCode: { in: corpCodes }, tradeDate: { gt: minAfter } },
      orderBy: [{ corpCode: 'asc' }, { tradeDate: 'asc' }],
      select: { corpCode: true, tradeDate: true, closePrice: true },
    });
    const byCorp = new Map<string, Array<{ tradeDate: string; closePrice: number }>>();
    for (const row of rows) {
      const arr = byCorp.get(row.corpCode) ?? [];
      arr.push({ tradeDate: row.tradeDate, closePrice: row.closePrice });
      byCorp.set(row.corpCode, arr);
    }
    return requests.map((r) =>
      (byCorp.get(r.corpCode) ?? [])
        .filter((x) => x.tradeDate > r.afterTradeDate)
        .slice(0, take)
        .map((x) => ({ closePrice: x.closePrice })),
    );
  }

  /**
   * DAR-206: 포지션별 일일 스냅샷 앞 take 개(snapshotDate 오름차순)를 단일 grouped 쿼리로 적재.
   *   positionId in(...) 1회 조회 후 메모리 그룹핑 — positionId 당 앞 take 개만 보존(per-position
   *   findMany take 와 동치, N+1 제거). 빈 입력은 조회 없이 빈 Map.
   */
  private async snapshotsByPosition(
    positionIds: string[],
    take: number,
  ): Promise<Map<string, Array<{ closePrice: number | null }>>> {
    const grouped = new Map<string, Array<{ closePrice: number | null }>>();
    if (positionIds.length === 0) return grouped;
    const rows = await this.prisma.positionDailySnapshot.findMany({
      where: { positionId: { in: positionIds } },
      orderBy: [{ positionId: 'asc' }, { snapshotDate: 'asc' }],
      select: { positionId: true, closePrice: true },
    });
    for (const row of rows) {
      const arr = grouped.get(row.positionId) ?? [];
      if (arr.length < take) {
        arr.push({ closePrice: row.closePrice });
        grouped.set(row.positionId, arr);
      }
    }
    return grouped;
  }

  private async latestClose(corpCode: string, tradeDate: string): Promise<number | null> {
    const row = await this.latestPriceRow(corpCode, tradeDate);
    return row ? row.closePrice : null;
  }

  /**
   * 합성 모드 진입↔평가 일관 임계(DAR-135).
   * 신규 합성 포지션의 진입가(체결가)는 합성 종가와 슬리피지(기본 0.05%)만큼만 차이난다.
   * 레거시(실가격 진입) 포지션은 합성가와 수십~수백% 괴리하므로, 10% 임계로 둘을 안전히 분리한다.
   * (드물게 실가격이 합성 기준가의 ±10% 내인 레거시는 재기준에서 누락될 수 있으나 무해·재현됨.)
   */
  private static readonly LEGACY_REBASE_DRIFT = 0.1;

  /**
   * DAR-135 + DAR-139: 레거시 포지션 재기준(rebase) — 합성/하이브리드(REAL_THEN_SYNTHETIC) 모드.
   *   실데이터 전용(REAL 기본)·priceSource 미주입은 no-op(회귀 0).
   *
   * 배경: 시세 소스가 바뀐 뒤(합성 활성화 또는 실가 모드 전환) 열린 포지션은 진입가가 이전 소스
   *   기준이라, 이후 평가 소스와 어긋난다. 그 결과 첫 스냅샷에서 진입가↔평가 괴리가 통째로 평가
   *   손익으로 잡혀 equity 가 비현실적으로 점프한다(예: 합성가 83,050 진입 ↔ 실가 23,500 평가, 또는
   *   그 역). DAR-139 핵심: 모드 전환/run-once 시 기존 포지션을 '현재 소스'로 재평가한다.
   *
   * 처리(재기준): 보유 OPEN 포지션 중 진입가가 '진입일 시점의 현재-소스 종가'와 크게 어긋난 것을
   *   골라, 진입 기준을 그 종가로 재설정한다(수량 보존·평가손익 0으로 리셋). 소스는 종목 단위로
   *   결정되므로(latestPriceRow → resolveSource) 실데이터 보유 종목은 실가 종가로, 실데이터 없는
   *   종목은 합성 종가로 재기준된다 — 실/합성 혼합 없이 종목별 일관. 이후 스냅샷부터 진입↔평가가
   *   같은 소스라 일관되며, 누적 괴리 점프가 사라진다.
   *
   * 멱등: 재기준 후 진입가 = 현재-소스 종가 → 다음 사이클엔 drift ≤ 임계 → 재대상 아님. 같은 소스로
   *   진입한 신규 매수분(drift ≈ 슬리피지)도 건드리지 않는다.
   *
   * ★모의/시뮬 전용 — 실시세 오인 금지. 종목별로 라벨된 소스(REAL|SYNTHETIC) 종가만 참조한다.
   */
  private async rebaseLegacyPositions(portfolioId: string, tradeDate: string): Promise<number> {
    // SYNTHETIC + REAL_THEN_SYNTHETIC 에서 동작. REAL 기본 모드·미주입은 no-op(회귀 0).
    if (!this.priceSource || this.priceSource.mode === 'REAL') return 0;

    const positions = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
    });

    let rebased = 0;
    for (const p of positions) {
      // 진입일 시점(≤tradeDate 로 클램프)의 현재-소스 종가를 기준가로 사용(종목별 실가|합성).
      const entryYmd = this.toBasDd(p.entryDate);
      const anchorYmd = entryYmd <= tradeDate ? entryYmd : tradeDate;
      const srcRow = await this.latestPriceRow(p.corpCode, anchorYmd);
      if (!srcRow || srcRow.closePrice <= 0) continue; // 시세 공백 → 안전 스킵

      const srcEntry = srcRow.closePrice;
      const drift = Math.abs(p.entryPrice - srcEntry) / srcEntry;
      // 진입↔현재-소스 기준이 이미 일관(신규/재기준 완료) → 멱등 스킵.
      if (drift <= PaperSimulationService.LEGACY_REBASE_DRIFT) continue;

      await this.prisma.position.update({
        where: { id: p.id },
        data: {
          entryPrice: srcEntry,
          entryAmount: srcEntry * p.quantity,
          currentPrice: srcEntry,
          currentValue: srcEntry * p.quantity,
          unrealizedPnl: 0,
          unrealizedPnlPct: 0,
          // 최고가도 현재-소스 기준으로 리셋(이전-소스 잔재 제거 — 추적손절 왜곡 방지).
          highestPrice: srcEntry,
          highestAt: p.entryDate,
        },
      });
      rebased++;
    }

    if (rebased > 0) {
      this.logger.log(
        `[PaperSim][${this.priceSource.modeLabel}] 레거시 포지션 재기준 rebased=${rebased} tradeDate=${tradeDate}`,
      );
    }
    return rebased;
  }

  private toBasDd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  /** DAR-364: 오늘 거래일 YYYYMMDD(KST). 상태 조회의 '지금' 기준일 — 실시간 실가 재평가 앵커. */
  private todayBasDd(): string {
    return formatKstDateCompact(new Date());
  }

  private emptyResult(tradeDate: string, message: string): DailyCycleResult {
    return {
      tradeDate,
      bought: 0,
      reserved: 0,
      snapshotted: 0,
      exited: 0,
      exitDeferred: 0,
      rebased: 0,
      openPositions: 0,
      equity: PaperSimulationService.INITIAL_CAPITAL,
      metrics: calculateSimulationMetrics({
        signalOutcomes: [],
        exitOutcomes: [],
        initialCapital: PaperSimulationService.INITIAL_CAPITAL,
        currentEquity: PaperSimulationService.INITIAL_CAPITAL,
        realizedNetPnl: 0,
        unrealizedPnl: 0,
        totalAiCostKrw: 0,
      }),
      message,
    };
  }
}
