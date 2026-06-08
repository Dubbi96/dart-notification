/**
 * PersonaTradingModule — persona별 모의운용 + 현재 장 적합 persona 추천 배선 (DAR-130, P-D)
 *
 * 기존 PhilosophyStyleSimulationModule(DAR-76, persona별 독립 포트폴리오 분기 운용) 위에
 * 추천 레이어(MarketRegimeService + PersonaTradingService)를 얹는다.
 *
 * - PhilosophyStyleSimulationModule: PhilosophyStyleSimulationService(persona별 성과 집계) 주입
 * - PrismaModule: MarketRegimeService(지수·이벤트 극성 조회) 주입
 *
 * ★ 모의 전용 — 실주문 없음. 레짐·추천은 순수 Rule(AI 미개입).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PhilosophyStyleSimulationModule } from '../philosophy-style-simulation.module';
import { MarketRegimeService } from './market-regime.service';
import { PersonaTradingService } from './persona-trading.service';
import { PersonaTradingController } from './persona-trading.controller';

@Module({
  imports: [PrismaModule, PhilosophyStyleSimulationModule],
  controllers: [PersonaTradingController],
  providers: [MarketRegimeService, PersonaTradingService],
  exports: [MarketRegimeService, PersonaTradingService],
})
export class PersonaTradingModule {}
