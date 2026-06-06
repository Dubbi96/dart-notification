/**
 * Persona 철학 엔진 P-C — 결합 합성 모듈 (DAR-72)
 *
 * PhilosophyModule(P-A 조회 + P-B 적합도)을 import 해 결합 서비스에 주입한다.
 * AI 산출물 조회는 PersonaViewRepository(Prisma 읽기 전용)로만 — 신규 AI 호출 0.
 */
import { Module } from '@nestjs/common';
import { PhilosophyModule } from '../philosophy.module';
import { PersonaViewRepository } from './ports/persona-view.repository';
import { PrismaPersonaViewRepository } from './adapters/prisma-persona-view.repository';
import { PersonaPhilosophyFusionService } from './persona-philosophy-fusion.service';
import { PersonaPhilosophyFusionController } from './persona-philosophy-fusion.controller';

@Module({
  imports: [PhilosophyModule],
  controllers: [PersonaPhilosophyFusionController],
  providers: [
    PrismaPersonaViewRepository,
    { provide: PersonaViewRepository, useClass: PrismaPersonaViewRepository },
    PersonaPhilosophyFusionService,
  ],
  exports: [PersonaPhilosophyFusionService],
})
export class PersonaPhilosophyFusionModule {}
