import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BacktestSignalAssemblyService } from '../replay/backtest-signal-assembly.service';
import {
  BacktestReplayService,
  DEFAULT_REPLAY_COSTS,
} from '../replay/backtest-replay.service';
import { PrismaBacktestPriceAdapter } from '../ports/prisma-price-data.adapter';
import { StrategyParams, BacktestCostParams } from '../ports/backtest.types';
import { StrategyPreset, findPreset } from './strategy-presets';
import { EventEdgeSelectorService } from './event-edge-selector.service';
import {
  ParameterSweepReport,
  SweepPoint,
  SweepMetricSnapshot,
  buildSweepGrid,
  buildSweepReport,
  toSweepSnapshot,
} from './parameter-sweep';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParameterSweepInput {
  /** 스윕 대상 전략 프리셋 키(event-edge | short-momentum | conservative-value | aggressive-diversified | 향후 P12/P14). */
  presetKey: string;
  /** 리플레이 시작일 YYYY-MM-DD. */
  startDate: string;
  /** 리플레이 종료일 YYYY-MM-DD(가격 asOf 상한 겸용). */
  endDate: string;
  /** 비용 override(선택). 미지정 시 DEFAULT_REPLAY_COSTS(라이브 정렬). */
  costs?: Partial<BacktestCostParams>;
}

/**
 * ParameterSweepService — DAR-485 전략 파라미터 민감도 스윕 하니스(견고화 W3·P24).
 *
 * 무엇: 프리셋 파라미터를 축별(손절·익절·보유일·minBuyScore)로 ±스텝 흔든 이웃값 그리드를
 *   backtest-runner(러너) 를 재사용해 point-in-time 리플레이로 각각 실행하고, 이웃 대비 성과
 *   급변 여부(안정성)를 리포트로 낸다. 파라미터 고원(plateau) 위에 앉은 프리셋인지 스파이크(과최적화)
 *   인지 측정한다.
 *
 * ★★ AI 자동 파라미터 조정 절대 금지(불가침): 이 서비스는 측정·리포트만 한다. 결과로 프리셋
 *   파라미터(strategy-presets.ts)를 자동 변경하는 경로가 없으며, 추가 금지. 반영은 오직
 *   docs/trading/strategy-rulebook.md §8 변경 절차(문서 개정 → 재검증 → 사람 승인)로.
 *
 * ★ read-only(운용·측정 트랙 무접촉):
 *  - BacktestRun/Trade 를 쓰지 않는다(영속 0). 리포트는 응답으로만 반환하는 휘발 산출물.
 *  - 실행은 BacktestReplayService.executeReplay(러너+성과계산, DB 영속 분리부)를 재사용한다.
 *  - 신호는 그리드 최저 minBuyScore 로 1회만 조립하고, 각 실행의 러너가 자기 minBuyScore 로
 *    재필터한다(per-run 조립과 동일한 결과의 point-in-time 안전 최적화).
 *  - 상시 크론 없음. 수동 트리거(API/스크립트)만.
 *
 * AI 금지영역 불가침: 신호·체결·손절·청산 전부 순수 Rule(리플레이와 동일). AI 개입 0.
 */
@Injectable()
export class ParameterSweepService {
  private readonly logger = new Logger(ParameterSweepService.name);

  /**
   * DAR-489: 프리셋 키 단위 in-flight 가드 — 동일 프리셋 스윕(9회 리플레이)의 병렬 폭주 방지.
   * 실행 제어만 담당(결과·파라미터 무변경, read-only 성격 유지). 완료·실패 모두 finally 에서 해제.
   */
  private readonly inFlightPresets = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembly: BacktestSignalAssemblyService,
    private readonly replay: BacktestReplayService,
    private readonly eventEdgeSelector: EventEdgeSelectorService,
  ) {}

  /** 프리셋 1종의 이웃값 그리드 민감도 스윕을 실행하고 안정성 리포트를 반환한다(read-only). */
  async run(input: ParameterSweepInput): Promise<ParameterSweepReport> {
    this.assertDate(input.startDate, 'startDate');
    this.assertDate(input.endDate, 'endDate');
    if (input.endDate < input.startDate) {
      throw new BadRequestException('endDate 는 startDate 이후여야 합니다.');
    }

    const preset = findPreset(input.presetKey);
    if (!preset) {
      throw new NotFoundException(`알 수 없는 전략 키: ${input.presetKey}`);
    }

    // DAR-489: 동일 프리셋 스윕이 이미 실행 중이면 409 — 병렬 재실행 대신 즉시 거절(결정론).
    if (this.inFlightPresets.has(preset.key)) {
      throw new ConflictException(
        `전략 '${preset.key}' 민감도 스윕이 이미 실행 중입니다 — 완료 후 다시 시도하세요.`,
      );
    }
    this.inFlightPresets.add(preset.key);
    try {
      return await this.runSweep(preset, input);
    } finally {
      this.inFlightPresets.delete(preset.key);
    }
  }

  /** 실제 스윕 본체 — in-flight 가드(run) 내부에서만 호출된다. */
  private async runSweep(
    preset: StrategyPreset,
    input: ParameterSweepInput,
  ): Promise<ParameterSweepReport> {
    // 프리셋 실제 트레이딩과 동일하게 base 파라미터를 해석(robustEventGate → eventTypes 주입).
    // 이벤트 allowlist 는 4축 흔들기와 무관하므로 base 에 1회 baked 한 뒤 그리드를 얹는다.
    const base = await this.resolveBaseParams(preset);
    const grid = buildSweepGrid(base);

    // 그리드 최저 minBuyScore 로 신호 1회 조립(각 러너가 자기 minBuyScore 로 재필터).
    const minBuyScoreAcrossGrid = Math.min(...grid.map((p) => p.params.minBuyScore));
    const signals = await this.assembly.assemble(input.startDate, input.endDate, {
      minBuyScore: minBuyScoreAcrossGrid,
      personas: base.personas,
    });

    const costs: BacktestCostParams = { ...DEFAULT_REPLAY_COSTS, ...input.costs };
    // asOf=endDate 상한 어댑터를 전 실행에 공유(point-in-time 일관).
    const adapter = new PrismaBacktestPriceAdapter(this.prisma, input.endDate);

    this.logger.log(
      `[${preset.key}] 민감도 스윕 시작: ${grid.length}개 파라미터 집합 · 신호 ${signals.length}건 · ${input.startDate}~${input.endDate}`,
    );

    const results: Array<{ point: SweepPoint; snapshot: SweepMetricSnapshot }> = [];
    for (const point of grid) {
      // 러너 재사용(executeReplay 내부에서 BacktestRunnerService 생성·실행). 영속 없음.
      const { metrics } = await this.replay.executeReplay(
        signals,
        adapter,
        point.params,
        costs,
        input.startDate,
        input.endDate,
      );
      results.push({ point, snapshot: toSweepSnapshot(metrics) });
    }

    const report = buildSweepReport({
      presetKey: preset.key,
      presetLabel: preset.label,
      window: { startDate: input.startDate, endDate: input.endDate },
      base,
      results,
    });

    this.logger.log(
      `[${preset.key}] 민감도 스윕 완료: overall=${report.overallVerdict} · baseline 거래 ${report.baselineTrades}건 · 최민감축=${report.mostSensitiveAxisKey ?? '-'}`,
    );
    return report;
  }

  /**
   * StrategyTrackService.resolveParams 와 동일 규칙 — robustEventGate 프리셋은 EventStudy robust
   * 통계로 매수 eventTypes 를 주입한다(양-edge 없으면 빈 allowlist → 진입 0). 게이트 없는 프리셋은
   * preset.params 그대로. 스윕이 '실제 프리셋'의 이웃을 측정하도록 baseline 을 정합화한다.
   */
  private async resolveBaseParams(preset: StrategyPreset): Promise<StrategyParams> {
    if (!preset.robustEventGate) return preset.params;
    const selection = await this.eventEdgeSelector.selectPositiveEdgeEventTypes();
    return { ...preset.params, eventTypes: selection.eventTypes };
  }

  private assertDate(value: string, field: string): void {
    if (!ISO_DATE.test(value)) {
      throw new BadRequestException(`${field} 는 YYYY-MM-DD 형식이어야 합니다: ${value}`);
    }
  }
}
