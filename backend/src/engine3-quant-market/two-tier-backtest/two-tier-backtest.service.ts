// Engine3 — 2단 프레임 신규 2트랙 백테스트 게이트 서비스 (DAR-493 [견고화 W1·P16])
//
// EtfDailyPrice(P10/P11 수집·백필) → DatedBar 조립 → 코어·위성 순수 백테스트 → 게이트 리포트.
// ★read-only: BacktestRun/Trade 영속 0. 측정 트랙·운용 무접촉. 상시 크론 아님(수동/JWT 트리거).
// ★AI 개입 0. 데이터 미가용(dev DB 미백필) 시 graceful — 커버리지 리포트만 반환(실행은 통합자).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
} from '../dual-momentum/dual-momentum.constants';
import { SATELLITE_TARGET_ETF_CODE } from '../volatility-breakout/volatility-breakout.constants';
import { DatedBar } from './two-tier-backtest.types';
import { backtestCoreDualMomentum } from './core-dual-momentum-backtest';
import { backtestSatelliteBreakout } from './satellite-breakout-backtest';
import {
  buildTrackGateMetrics,
  assembleGateReport,
  computeBuyHoldReturnPct,
  computeBuyHoldMddPct,
  GateReport,
} from './gate-report';

export interface TwoTierGateInput {
  /** 조회 시작일 YYYYMMDD(미지정 시 전 구간). */
  startDate?: string;
  /** 조회 종료일 YYYYMMDD(미지정 시 전 구간). */
  endDate?: string;
  /** 트랙별 초기 가상원금(원). 기본 10,000,000. */
  initialCapital?: number;
}

export interface CoverageEntry {
  etfCode: string;
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface TwoTierGateResult {
  coverage: CoverageEntry[];
  /** 데이터 충분 시에만 존재. 부족(백필 전) 시 null + note. */
  report: GateReport | null;
  note: string;
}

/** 코어(월단위) LOW_SAMPLE 임계 — 최소 리밸런싱 거래 건수. */
const CORE_MIN_TRADES = 8;
/** 위성(일단위) LOW_SAMPLE 임계 — 최소 돌파 진입 건수. */
const SATELLITE_MIN_TRADES = 20;
/** 코어 최소 이력(모멘텀 253봉 + 여유) — 이 미만이면 백필 부족으로 판정. */
const CORE_MIN_BARS = 260;

@Injectable()
export class TwoTierBacktestService {
  private readonly logger = new Logger(TwoTierBacktestService.name);

  private readonly allCodes = [
    CORE_OFFENSE_INTL_CODE,
    CORE_OFFENSE_DOMESTIC_CODE,
    CORE_ABS_MOMENTUM_FILTER_CODE,
    CORE_DEFENSE_BOND_CODE,
  ];

  constructor(private readonly prisma: PrismaService) {}

  /** EtfDailyPrice 조회 → code별 DatedBar[] 맵. */
  private async loadBars(input: TwoTierGateInput): Promise<Map<string, DatedBar[]>> {
    const where: { etfCode: { in: string[] }; tradeDate?: { gte?: string; lte?: string } } = {
      etfCode: { in: this.allCodes },
    };
    if (input.startDate || input.endDate) {
      where.tradeDate = {};
      if (input.startDate) where.tradeDate.gte = input.startDate;
      if (input.endDate) where.tradeDate.lte = input.endDate;
    }
    const rows = await this.prisma.etfDailyPrice.findMany({
      where,
      orderBy: [{ etfCode: 'asc' }, { tradeDate: 'asc' }],
    });
    const m = new Map<string, DatedBar[]>();
    for (const code of this.allCodes) m.set(code, []);
    for (const r of rows) {
      const arr = m.get(r.etfCode);
      if (!arr) continue;
      arr.push({
        date: r.tradeDate,
        open: r.openPrice,
        high: r.highPrice,
        low: r.lowPrice,
        close: r.closePrice,
      });
    }
    return m;
  }

  private coverageOf(bars: Map<string, DatedBar[]>): CoverageEntry[] {
    return this.allCodes.map((code) => {
      const arr = bars.get(code) || [];
      return {
        etfCode: code,
        rows: arr.length,
        firstDate: arr.length ? arr[0].date : null,
        lastDate: arr.length ? arr[arr.length - 1].date : null,
      };
    });
  }

  /**
   * 게이트 리포트 실행. 데이터 부족 시 report=null + 커버리지·실행절차 note 반환(graceful).
   */
  async runGateReport(input: TwoTierGateInput = {}): Promise<TwoTierGateResult> {
    const bars = await this.loadBars(input);
    const coverage = this.coverageOf(bars);

    const coreShortfall = coverage.some((c) => c.rows < CORE_MIN_BARS);
    const satelliteBars = bars.get(SATELLITE_TARGET_ETF_CODE) || [];

    if (coreShortfall || satelliteBars.length < CORE_MIN_BARS) {
      this.logger.warn('ETF 일봉 이력 부족 — 게이트 산출 보류(백필 필요). 커버리지만 반환.');
      return {
        coverage,
        report: null,
        note:
          'ETF 일봉 이력 부족(백필 전). P11 수동 백필 러너로 3년 구간 적재 후 재실행 필요. ' +
          '실행 절차: docs/trading/two-tier-backtest-gate-procedure.md',
      };
    }

    const initialCapital = input.initialCapital ?? 10_000_000;
    const universeBars: Record<string, DatedBar[]> = {};
    for (const code of this.allCodes) universeBars[code] = bars.get(code) || [];

    const coreResult = backtestCoreDualMomentum(universeBars, { initialCapital });
    const satelliteResult = backtestSatelliteBreakout(satelliteBars, { initialCapital });

    // 벤치마크 = KODEX200(069500) 매수후보유(국내주식 기준선). 두 트랙 공통.
    const benchmarkBars = bars.get(CORE_OFFENSE_DOMESTIC_CODE) || [];
    const benchmarkPct = computeBuyHoldReturnPct(benchmarkBars);
    // 코어 위험조정 게이트(DAR-494·§8 승인)용 벤치마크 MDD — GTAA 목적(수익률 유사 + MDD 축소).
    const benchmarkMddPct = computeBuyHoldMddPct(benchmarkBars);

    const coreMetrics = buildTrackGateMetrics(coreResult, benchmarkPct, {
      minTrades: CORE_MIN_TRADES,
      // 코어 한정 위험조정 기준: 수익률 ≥ 벤치×0.9 && MDD 개선(전략 > 벤치). 위성·기타는 미지정=엄격.
      riskAdjusted: { benchmarkMddPct },
      lowPowerNote: '코어=월단위 관측 ≈12회/년 — 통계 검증력 낮음(문헌 엣지 참조 불가피, 정직 고지)',
    });
    const satelliteMetrics = buildTrackGateMetrics(satelliteResult, benchmarkPct, {
      minTrades: SATELLITE_MIN_TRADES,
    });

    const report = assembleGateReport(coreMetrics, satelliteMetrics);

    return {
      coverage,
      report,
      note: `게이트 산출 완료. overall 엣지 양수=${report.overallEdgePositive}. 활성 결정은 통합자·사용자 소관.`,
    };
  }
}
