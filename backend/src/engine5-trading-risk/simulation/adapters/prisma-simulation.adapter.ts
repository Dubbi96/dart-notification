// 졸업지표 조회 전용 Prisma 어댑터 (M10 졸업 측정, DAR-67)
//
// GraduationMetricsService(SIMULATION_PORT 의존)를 실제 모의운용 데이터에 배선하기 위한
// READ-ONLY 어댑터. paper-simulation(DAR-40)이 영속화한 동일 테이블
// (Portfolio·Position·PositionDailySnapshot·StockDailyPrice·AIUsageLog)을 집계만 한다.
//
// ★ read-only — 신규 수집·외부호출·체결·AI 개입 0. 쓰기/오케스트레이션 메서드는
//   호출 자체가 계약 위반이므로 명시적으로 예외를 던진다(졸업지표 조회는 reads 만 사용).
// ★ 스키마 변경 0 — 기존 모델 재사용. 초기원금/환산환율은 paper-simulation 상수와 단일 출처 공유.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaperSimulationService } from '../../paper-simulation/paper-simulation.service';
import {
  ExitAccuracySample,
  HitRateSample,
} from '../domain/graduation-metrics.calculator';
import {
  BuyCandidate,
  ClosePositionInput,
  DailySnapshotInput,
  OpenPositionInput,
  OpenPositionView,
  RiskSnapshotInput,
} from '../domain/simulation.types';
import { CumulativeState, ISimulationPort } from '../ports/simulation.port';

/** 모의 포트폴리오가 아직 없을 때 사용하는 비존재 sentinel id(하위 조회는 빈 결과 → 0 지표) */
const NO_PORTFOLIO = '__no_sim_portfolio__';

@Injectable()
export class PrismaSimulationAdapter implements ISimulationPort {
  constructor(private readonly prisma: PrismaService) {}

  /** 모의 포트폴리오 id 확보 — read-only(없으면 sentinel 반환, 생성하지 않음) */
  async resolveSimPortfolioId(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { email: PaperSimulationService.SIM_USER_EMAIL },
      select: { id: true },
    });
    if (!user) return NO_PORTFOLIO;
    const pf = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name: PaperSimulationService.SIM_PORTFOLIO_NAME },
      select: { id: true },
    });
    return pf?.id ?? NO_PORTFOLIO;
  }

  /** G2/G3 누적 상태 — 초기원금 + 실현/미실현 손익으로 평가자산·순익 산출 */
  async getCumulativeState(portfolioId: string): Promise<CumulativeState> {
    const initialCapital = PaperSimulationService.INITIAL_CAPITAL;
    if (portfolioId === NO_PORTFOLIO) {
      return { initialCapital, currentValue: initialCapital, cash: initialCapital, netPnlKrw: 0 };
    }
    const [open, closed] = await Promise.all([
      this.prisma.position.findMany({
        where: { portfolioId, status: 'OPEN' },
        select: { entryPrice: true, quantity: true, unrealizedPnl: true, currentValue: true },
      }),
      this.prisma.position.findMany({
        where: { portfolioId, status: 'CLOSED' },
        select: { unrealizedPnl: true },
      }),
    ]);
    const unrealizedPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const realizedNetPnl = closed.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
    const holdingsValue = open.reduce(
      (s, p) => s + (p.currentValue ?? p.entryPrice * p.quantity),
      0,
    );
    const currentValue = initialCapital + realizedNetPnl + unrealizedPnl;
    return {
      initialCapital,
      currentValue,
      cash: currentValue - holdingsValue,
      netPnlKrw: realizedNetPnl,
    };
  }

  /** G1 적중률(D+N) — 포지션별 일일 스냅샷 D0..D+N 의 진입가 대비 D+N 수익률 표본 */
  async getHitRateSamples(
    portfolioId: string,
    horizonDays: number,
  ): Promise<HitRateSample[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const positions = await this.prisma.position.findMany({
      where: { portfolioId },
      select: { id: true, entryPrice: true },
    });
    const samples: HitRateSample[] = [];
    for (const p of positions) {
      if (p.entryPrice <= 0) continue;
      const snaps = await this.prisma.positionDailySnapshot.findMany({
        where: { positionId: p.id },
        orderBy: { snapshotDate: 'asc' },
        select: { closePrice: true },
        take: horizonDays + 1,
      });
      const dn = snaps.length >= horizonDays + 1 ? snaps[horizonDays].closePrice : null;
      if (dn !== null && dn !== undefined) {
        samples.push({ returnPct: ((dn - p.entryPrice) / p.entryPrice) * 100 });
      }
    }
    return samples;
  }

  /** G5 Exit 정확도(D+N) — 청산 포지션의 청산가 vs 청산 후 D+N 종가 표본 */
  async getExitAccuracySamples(
    portfolioId: string,
    horizonDays: number,
  ): Promise<ExitAccuracySample[]> {
    if (portfolioId === NO_PORTFOLIO) return [];
    const closed = await this.prisma.position.findMany({
      where: { portfolioId, status: 'CLOSED', closedAt: { not: null } },
      select: { corpCode: true, currentPrice: true, closedAt: true },
    });
    const samples: ExitAccuracySample[] = [];
    for (const p of closed) {
      const priceAtExit = p.currentPrice;
      if (!priceAtExit || priceAtExit <= 0 || !p.closedAt) continue;
      const closeDate = this.toBasDd(p.closedAt);
      const after = await this.prisma.stockDailyPrice.findMany({
        where: { corpCode: p.corpCode, tradeDate: { gt: closeDate } },
        orderBy: { tradeDate: 'asc' },
        select: { closePrice: true },
        take: horizonDays,
      });
      if (after.length >= horizonDays) {
        samples.push({ priceAtExit, priceAfterHorizon: after[horizonDays - 1].closePrice });
      }
    }
    return samples;
  }

  /** G3 누적 AI 비용(KRW 환산) — AIUsageLog 전체 costUsd 합 × 환율 */
  async getAiCostKrw(usdKrwRate: number): Promise<number> {
    const agg = await this.prisma.aIUsageLog.aggregate({ _sum: { costUsd: true } });
    return (agg._sum.costUsd ?? 0) * usdKrwRate;
  }

  // ── 쓰기/오케스트레이션 경로: 졸업지표 조회 어댑터는 지원하지 않음(read-only 계약) ──
  getBuyCandidates(): Promise<BuyCandidate[]> {
    return this.unsupported('getBuyCandidates');
  }
  getOpenPositions(): Promise<OpenPositionView[]> {
    return this.unsupported('getOpenPositions');
  }
  getLatestClose(): Promise<number | null> {
    return this.unsupported('getLatestClose');
  }
  openPosition(_portfolioId: string, _input: OpenPositionInput): Promise<void> {
    return this.unsupported('openPosition');
  }
  closePosition(_input: ClosePositionInput): Promise<void> {
    return this.unsupported('closePosition');
  }
  saveDailySnapshot(_input: DailySnapshotInput): Promise<void> {
    return this.unsupported('saveDailySnapshot');
  }
  saveRiskSnapshot(_input: RiskSnapshotInput): Promise<void> {
    return this.unsupported('saveRiskSnapshot');
  }

  private unsupported(method: string): never {
    throw new Error(
      `PrismaSimulationAdapter.${method}: read-only 졸업지표 어댑터는 쓰기/오케스트레이션을 지원하지 않습니다.`,
    );
  }

  private toBasDd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
