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
 * ★ 모의 전용 — 실주문 없음. 적합도·체결·Exit·지표는 순수 Rule(AI 미개입).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TradingRiskModule } from '../trading-risk.module';
import { PhilosophyModule } from '../../engine2-ai-analyst/philosophy/philosophy.module';
import { GraduationModule } from '../simulation/graduation.module';
import { PhilosophyStyleSimulationService } from './philosophy-style-simulation.service';
import { PhilosophyStyleSimulationController } from './philosophy-style-simulation.controller';

@Module({
  imports: [PrismaModule, TradingRiskModule, PhilosophyModule, GraduationModule],
  controllers: [PhilosophyStyleSimulationController],
  providers: [PhilosophyStyleSimulationService],
  exports: [PhilosophyStyleSimulationService],
})
export class PhilosophyStyleSimulationModule {}
