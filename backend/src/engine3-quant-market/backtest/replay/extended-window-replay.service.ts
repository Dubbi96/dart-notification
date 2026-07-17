import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StrategyParams, BacktestCostParams } from '../ports/backtest.types';
import { PrismaBacktestPriceAdapter } from '../ports/prisma-price-data.adapter';
import { BacktestSignalAssemblyService } from './backtest-signal-assembly.service';
import {
  BacktestReplayService,
  DEFAULT_REPLAY_STRATEGY,
  DEFAULT_REPLAY_COSTS,
} from './backtest-replay.service';
import { CachingBacktestPriceAdapter } from './caching-price-data.adapter';

/** 확장 검증 창 기본값 — 11년(2015~2026). DAR-544. */
export const DEFAULT_EXTENDED_START_YEAR = 2015;
export const DEFAULT_EXTENDED_END_YEAR = 2026;

export interface ExtendedWindowReplayInput {
  /** 창 시작 연도(포함). 기본 2015. */
  startYear?: number;
  /** 창 종료 연도(포함). 기본 2026. */
  endYear?: number;
  /**
   * 청크 크기(연). 기본 1(연 단위 청크). 창 전체 길이 이상이면 단일 패스(MONOLITHIC).
   * 청크는 성능·메모리 상한을 주지만 청크 경계에서 미청산 포지션이 강제청산(FORCE_EXIT)되므로
   * 청크별 성과는 단일창 전략 성과와 동일하지 않다(완주·성능 프로브 — 측정 인프라).
   */
  chunkYears?: number;
  /** 전략 override(선택). 기본 DEFAULT_REPLAY_STRATEGY(시스템 하드룰 트랙). ★값 변경 아님. */
  strategy?: Partial<StrategyParams>;
  /** 비용 override(선택). 기본 DEFAULT_REPLAY_COSTS(라이브 정렬). */
  costs?: Partial<BacktestCostParams>;
  /** 종료 상한 YYYY-MM-DD(포함). 진행 중 마지막 연도 절단용. 기본 = 현재 KST 날짜. */
  asOf?: string;
}

export interface ChunkRunResult {
  startDate: string;
  endDate: string;
  signals: number;
  trades: number;
  totalReturnPct: number;
  winRatePct: number;
  elapsedMs: number;
  priceLoads: number;
  priceCacheHits: number;
}

export interface ExtendedWindowRunReport {
  window: { startDate: string; endDate: string };
  mode: 'MONOLITHIC' | 'CHUNKED';
  chunkYears: number;
  chunks: ChunkRunResult[];
  totals: { signals: number; trades: number; elapsedMs: number; chunks: number };
  completed: boolean;
  notes: string[];
}

/**
 * ExtendedWindowReplayService — 백테스트 러너 11년 완주 하니스 (DAR-544, 데이터게이트 §2 청크 실행).
 *
 * 무엇: 확장 창(기본 2015~2026)을 연 단위(설정 가능) 청크로 나눠, 각 청크를 신호 조립 →
 *   러너(BacktestReplayService.executeReplay, DB 영속 분리부) → 성과 산출로 완주시키고, 청크별
 *   완주 로그(신호·거래·성과·경과·캐시통계)를 남긴다. 가격 조회는 CachingBacktestPriceAdapter 로
 *   종목당 창 1회 적재해 러너의 일자별 질의 팬아웃을 O(1)로 접는다(성능 처리).
 *
 * ★ read-only(불가침): executeReplay 는 BacktestRun/Trade 를 쓰지 않는 순수 실행부다. 이 서비스는
 *   영속 0 — M10 측정 트랙·운용 트랙 무접촉. 리포트는 휘발 산출물.
 * ★ 측정 인프라만: 전략 파라미터를 만들거나 바꾸지 않는다(기본 = 기존 DEFAULT_REPLAY_STRATEGY).
 *   결과의 코드 반영은 오직 룰북 §8 변경 절차로(§8.4). AI 개입 0.
 * ★ 청크 경계 주의: 연 단위 청크는 경계에서 포지션을 강제청산한다 → 청크별 성과 합은 단일 11년
 *   창 성과가 아니다. 단일창 성과가 필요하면 chunkYears 를 창 길이 이상으로(MONOLITHIC) 준다.
 */
@Injectable()
export class ExtendedWindowReplayService {
  private readonly logger = new Logger(ExtendedWindowReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembly: BacktestSignalAssemblyService,
    private readonly replay: BacktestReplayService,
  ) {}

  async run(input: ExtendedWindowReplayInput = {}): Promise<ExtendedWindowRunReport> {
    const startYear = input.startYear ?? DEFAULT_EXTENDED_START_YEAR;
    const endYear = input.endYear ?? DEFAULT_EXTENDED_END_YEAR;
    const span = endYear - startYear + 1;
    const chunkYears = Math.max(1, Math.floor(input.chunkYears ?? 1));
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
      throw new BadRequestException(
        `유효하지 않은 연도 창: startYear=${startYear}, endYear=${endYear}`,
      );
    }

    const strategy: StrategyParams = { ...DEFAULT_REPLAY_STRATEGY, ...input.strategy };
    const costs: BacktestCostParams = { ...DEFAULT_REPLAY_COSTS, ...input.costs };

    const windowStart = `${startYear}-01-01`;
    const hardEnd = `${endYear}-12-31`;
    const windowEnd = input.asOf && input.asOf < hardEnd ? input.asOf : hardEnd;
    const mode: 'MONOLITHIC' | 'CHUNKED' = chunkYears >= span ? 'MONOLITHIC' : 'CHUNKED';

    this.logger.log(
      `[11년 러너] 창 ${windowStart}~${windowEnd} · mode=${mode} · chunkYears=${chunkYears} 시작`,
    );

    const chunks: ChunkRunResult[] = [];
    let completed = true;
    for (let cy = startYear; cy <= endYear; cy += chunkYears) {
      const chunkStart = `${cy}-01-01`;
      const chunkEndHard = `${Math.min(cy + chunkYears - 1, endYear)}-12-31`;
      const chunkEnd = chunkEndHard < windowEnd ? chunkEndHard : windowEnd;
      if (chunkEnd < chunkStart) continue;

      try {
        const result = await this.runChunk(chunkStart, chunkEnd, strategy, costs);
        chunks.push(result);
        this.logger.log(
          `[11년 러너] 청크 완주 ${chunkStart}~${chunkEnd}: 신호 ${result.signals}건 → 거래 ${result.trades}건 · ` +
            `수익률 ${result.totalReturnPct.toFixed(2)}% · 승률 ${result.winRatePct.toFixed(1)}% · ` +
            `${result.elapsedMs}ms · 가격적재 ${result.priceLoads}종목/캐시히트 ${result.priceCacheHits}`,
        );
      } catch (err) {
        completed = false;
        this.logger.error(
          `[11년 러너] 청크 실패 ${chunkStart}~${chunkEnd}: ${(err as Error).message}`,
        );
        break;
      }
    }

    const totals = {
      signals: chunks.reduce((s, c) => s + c.signals, 0),
      trades: chunks.reduce((s, c) => s + c.trades, 0),
      elapsedMs: chunks.reduce((s, c) => s + c.elapsedMs, 0),
      chunks: chunks.length,
    };

    const notes: string[] = [
      'read-only: BacktestRun/PaperTrade 영속 0 — M10 측정 트랙 무접촉.',
      '측정 인프라만: 전략 파라미터 무변경(기본 DEFAULT_REPLAY_STRATEGY). 반영은 룰북 §8 절차로만(§8.4).',
    ];
    if (mode === 'CHUNKED') {
      notes.push(
        '청크 경계 강제청산: 청크별 성과 합은 단일 11년창 성과가 아니다(완주·성능 프로브). 단일창은 chunkYears≥창길이(MONOLITHIC).',
      );
    }

    this.logger.log(
      `[11년 러너] 완주=${completed} · 청크 ${totals.chunks}개 · 총 신호 ${totals.signals} · 총 거래 ${totals.trades} · 총 ${totals.elapsedMs}ms`,
    );

    return {
      window: { startDate: windowStart, endDate: windowEnd },
      mode,
      chunkYears,
      chunks,
      totals,
      completed,
      notes,
    };
  }

  /** 단일 청크 완주 — 신호 조립 → 캐시 어댑터 러너 실행 → 성과·경과 산출(영속 0). */
  private async runChunk(
    startDate: string,
    endDate: string,
    strategy: StrategyParams,
    costs: BacktestCostParams,
  ): Promise<ChunkRunResult> {
    const startedAt = Date.now();
    const signals = await this.assembly.assemble(startDate, endDate, {
      minBuyScore: strategy.minBuyScore,
      personas: strategy.personas,
    });
    // 종목당 창 1회 적재로 러너의 일자별 질의 팬아웃을 접는다(결과 불변).
    const inner = new PrismaBacktestPriceAdapter(this.prisma, endDate);
    const adapter = new CachingBacktestPriceAdapter(inner, startDate, endDate);
    const { trades, metrics } = await this.replay.executeReplay(
      signals,
      adapter,
      strategy,
      costs,
      startDate,
      endDate,
    );
    const stats = adapter.stats();
    return {
      startDate,
      endDate,
      signals: signals.length,
      trades: trades.length,
      totalReturnPct: metrics.totalReturn,
      winRatePct: metrics.winRate,
      elapsedMs: Date.now() - startedAt,
      priceLoads: stats.loads,
      priceCacheHits: stats.hits,
    };
  }
}
