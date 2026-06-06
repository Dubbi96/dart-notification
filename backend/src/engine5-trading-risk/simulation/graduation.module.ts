/**
 * GraduationModule — 졸업 게이트 측정 REST 노출 + engine5 모듈 배선 (M10 졸업 측정, DAR-67)
 *
 * 기존 GraduationMetricsService(simulation/) 가 어떤 module/controller 에도 미배선이던 문제를 해소:
 *   - SIMULATION_PORT 를 PrismaSimulationAdapter 로 배선(paper-simulation 영속 데이터 집계/적재).
 *   - GraduationMetricsService 를 provider 로 등록.
 *   - GET /api/graduation/metrics·funnel 컨트롤러로 외부 노출.
 *
 * DAR-109: PrismaSimulationAdapter write 실구현으로 SimulationOrchestratorService 가 실 DB에
 *   신호→모의진입을 누적할 수 있게 배선(provider 등록). ★Cron 미추가 — 기존 PaperSimulationScheduler
 *   (paper-simulation)와의 이중 체결을 막기 위해 트리거는 리드가 결정(수동/배선 진입점만 제공).
 * ★ 모의 전용 — 실주문 0. AI 금지영역: 지표 산출·게이트 평가·체결은 순수 Rule. engine2/AI import 0.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SIMULATION_PORT } from './ports/simulation.port';
import { PrismaSimulationAdapter } from './adapters/prisma-simulation.adapter';
import { GraduationMetricsService } from './graduation-metrics.service';
import { SimulationOrchestratorService } from './simulation-orchestrator.service';
import { GraduationController } from './graduation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GraduationController],
  providers: [
    PrismaSimulationAdapter,
    { provide: SIMULATION_PORT, useExisting: PrismaSimulationAdapter },
    GraduationMetricsService,
    SimulationOrchestratorService,
  ],
  exports: [GraduationMetricsService, SimulationOrchestratorService],
})
export class GraduationModule {}
