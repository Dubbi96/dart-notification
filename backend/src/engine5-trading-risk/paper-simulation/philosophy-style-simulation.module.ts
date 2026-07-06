/**
 * PhilosophyStyleSimulationModule — 철학 스타일별 모의운용 분기 운용·비교 배선 (DAR-76, P-D)
 *
 * 단일 시뮬(PaperSimulationModule)과 분리된 별도 모듈 — 기존 모듈의 "engine2/AI import 0" 불변식을
 * 보존하면서, 본 기능에 한해 engine2 philosophy-fit(Rule, AI 미개입)을 진입 필터로 사용한다.
 *
 * - TradingRiskModule: PaperTradeService(모의 체결) 주입
 * - PhilosophyModule(engine2): PhilosophyFitService(DB 재무 기반 적합도, 순수 Rule) 주입
 * - GraduationModule: GraduationMetricsService(Sharpe·MDD·벤치마크 alpha) 주입 — 스타일 포트폴리오별 재사용
 *
 * live-readiness W1 — forward 트랙 배선 추가:
 * - ForwardTracksScheduler: 스타일 4트랙(19:40)·전략 forward 4트랙(19:45) 일일 크론.
 *   ★TradingRiskModule 에 두면 본 모듈과 순환 import 라 여기 배선(스케줄러가 스타일 서비스 의존).
 * - StrategyForwardSimulationService/Controller: 전략 변형 4종 forward 운용·비교.
 * - EventStudyModule(engine3): EventEdgeSelectorService(robust 통계 allowlist, 순수 Rule) 의존 —
 *   BacktestModule 이 미export 라 이 모듈에서 클래스 provider 로 직접 제공(무상태 선별기).
 * - 개장 체결 정렬(2026-07-06): PaperSimulationModule 을 import — 스타일/전략 사이클이 일반화된
 *   개장 체결기(PaperSimulationService.fillPendingEntries)를 폴백으로 소비(단방향 의존·순환 없음).
 *
 * ★ 모의 전용 — 실주문 없음. 적합도·체결·Exit·지표는 순수 Rule(AI 미개입).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TradingRiskModule } from '../trading-risk.module';
import { PhilosophyModule } from '../../engine2-ai-analyst/philosophy/philosophy.module';
import { GraduationModule } from '../simulation/graduation.module';
import { EventStudyModule } from '../../engine3-quant-market/event-study/event-study.module';
import { EventEdgeSelectorService } from '../../engine3-quant-market/backtest/strategies/event-edge-selector.service';
// 개장 체결 정렬(2026-07-06): 일반화된 개장 체결기(fillPendingEntries) 주입원 — 단방향 의존(순환 없음).
import { PaperSimulationModule } from './paper-simulation.module';
import { PhilosophyStyleSimulationService } from './philosophy-style-simulation.service';
import { PhilosophyStyleSimulationController } from './philosophy-style-simulation.controller';
import { StrategyForwardSimulationService } from './strategy-forward-simulation.service';
import { StrategyForwardSimulationController } from './strategy-forward-simulation.controller';
import { BacktestForwardDivergenceService } from './backtest-forward-divergence.service';
import { BacktestForwardDivergenceController } from './backtest-forward-divergence.controller';
import { ForwardTracksScheduler } from './forward-tracks.scheduler';

@Module({
  imports: [
    PrismaModule,
    TradingRiskModule,
    PhilosophyModule,
    GraduationModule,
    EventStudyModule,
    // 개장 체결 정렬(2026-07-06): 일반화된 개장 체결기(PaperSimulationService) 주입원.
    PaperSimulationModule,
  ],
  controllers: [
    PhilosophyStyleSimulationController,
    StrategyForwardSimulationController,
    // DAR-479: 백테스트 vs forward 괴리 조인 리포트·추세·수동 스냅샷(read-only 측정).
    BacktestForwardDivergenceController,
  ],
  providers: [
    PhilosophyStyleSimulationService,
    EventEdgeSelectorService,
    StrategyForwardSimulationService,
    // DAR-479: 괴리 산출·스냅샷 서비스(ForwardTracksScheduler 가 @Optional 로 주입받아 일일 적재).
    BacktestForwardDivergenceService,
    ForwardTracksScheduler,
  ],
  exports: [
    PhilosophyStyleSimulationService,
    StrategyForwardSimulationService,
    BacktestForwardDivergenceService,
  ],
})
export class PhilosophyStyleSimulationModule {}
