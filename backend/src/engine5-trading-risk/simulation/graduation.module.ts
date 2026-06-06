/**
 * GraduationModule — 졸업 게이트 측정 REST 노출 + engine5 모듈 배선 (M10 졸업 측정, DAR-67)
 *
 * 기존 GraduationMetricsService(simulation/) 가 어떤 module/controller 에도 미배선이던 문제를 해소:
 *   - SIMULATION_PORT 를 read-only PrismaSimulationAdapter 로 배선(paper-simulation 영속 데이터 집계).
 *   - GraduationMetricsService 를 provider 로 등록.
 *   - GET /api/graduation/metrics 컨트롤러로 외부 노출.
 *
 * ★ read-only — 신규 수집·외부호출·체결·AI 개입 0. 스키마 변경 0.
 * AI 금지영역: 지표 산출·게이트 평가는 순수 Rule. engine2/AI import 0.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SIMULATION_PORT } from './ports/simulation.port';
import { PrismaSimulationAdapter } from './adapters/prisma-simulation.adapter';
import { GraduationMetricsService } from './graduation-metrics.service';
import { GraduationController } from './graduation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GraduationController],
  providers: [
    PrismaSimulationAdapter,
    { provide: SIMULATION_PORT, useExisting: PrismaSimulationAdapter },
    GraduationMetricsService,
  ],
  exports: [GraduationMetricsService],
})
export class GraduationModule {}
