/**
 * Persona 철학 엔진 — P-A 조회 + P-B 적합도 스코어러 모듈 (DAR-53)
 *
 * P-A(InvestorPhilosophy 시드·조회 어댑터)와 P-B(철학 적합도 on-demand 스코어러)를
 * 하나의 Nest 모듈로 결선한다. 영속화 없음(무스키마) — 요청 시점 계산.
 *
 * - PhilosophyRepository: P-A PrismaPhilosophyRepository 바인딩(읽기 전용)
 * - FinancialQueryService: FinancialsModule(DAR-52) 에서 import — CompanyFinancial 조회
 * - PhilosophyFitService / PhilosophyController: P-B 적합도 계산·노출
 *
 * AI 미개입(순수 Rule). 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §4 P-B
 */
import { Module } from '@nestjs/common';
import { FinancialsModule } from '../../engine1-disclosure/financials/financials.module';
import { PhilosophyRepository } from './ports/philosophy.repository';
import { PrismaPhilosophyRepository } from './adapters/prisma-philosophy.repository';
import { PhilosophyFitService } from './philosophy-fit.service';
import { PhilosophyController } from './philosophy.controller';
import { PhilosophySeederService } from './philosophy-seeder.service';

@Module({
  imports: [FinancialsModule],
  controllers: [PhilosophyController],
  providers: [
    PrismaPhilosophyRepository,
    { provide: PhilosophyRepository, useClass: PrismaPhilosophyRepository },
    PhilosophyFitService,
    // 부팅 시 InvestorPhilosophy 비었으면 자동 시드(비어있을 때만). export 불필요 — 훅 전용.
    PhilosophySeederService,
  ],
  exports: [PhilosophyRepository, PhilosophyFitService],
})
export class PhilosophyModule {}
