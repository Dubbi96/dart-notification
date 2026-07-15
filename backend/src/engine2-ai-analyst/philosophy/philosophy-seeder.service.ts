/**
 * Persona 철학 엔진 P-A — 부팅 자동 시드 서비스
 *
 * 앱 부팅 시 InvestorPhilosophy 가 비어 있으면 4종 철학(버핏·린치·그린블라트·
 * 드러켄밀러)을 자동으로 멱등 시드한다. 철학은 공개 자료 기반 참조 데이터이며
 * 엔진2 철학 적합도 엔진(PhilosophyFitService.getCompanyFit)의 필수 전제이므로,
 * 부재 시 자가 복구가 올바른 동작이다(재배포·DB 리셋에도 자동 재수복).
 *
 * 배경: prod InvestorPhilosophy 0행 → 철학 4트랙 모의투자가 진입 후보 0건으로
 * 정지. 수동 `npm run seed:philosophy`(휴먼 전용)에 의존하던 것을 부팅 훅으로 자가화.
 *
 * 규칙:
 * - **비었을 때만** 시드(count>0 이면 no-op — 기존 데이터 무변경·멱등).
 * - **부팅 무중단**: 시드 실패(DB 미준비·마이그레이션 전 등)가 앱 부팅을 막지
 *   않도록 전체 graceful(에러 로그만·throw 금지).
 * - AI 미개입(순수 데이터 적재). 시드 로직 SSOT 는 philosophy-seeder.core.ts.
 *
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §2-2
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PHILOSOPHY_SEEDS } from './philosophy.seed-data';
import { seedPhilosophiesInto } from './philosophy-seeder.core';

@Injectable()
export class PhilosophySeederService implements OnModuleInit {
  private readonly logger = new Logger(PhilosophySeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 부팅 훅: InvestorPhilosophy 가 비어 있으면 4종 시드(멱등). 실패해도 부팅 계속. */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.prisma.investorPhilosophy.count();
      if (existing > 0) {
        this.logger.log(
          `InvestorPhilosophy ${existing}건 존재 — 자동 시드 skip(멱등)`,
        );
        return;
      }

      const seeded = await seedPhilosophiesInto(this.prisma, PHILOSOPHY_SEEDS);
      this.logger.log(
        `InvestorPhilosophy 비어 있음 → 철학 ${seeded}종 자동 시드 완료`,
      );
    } catch (err) {
      // ★부팅 무중단: 시드 실패(DB 미준비·마이그레이션 전 등)가 앱 기동을 막지 않는다.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `InvestorPhilosophy 자동 시드 실패(부팅은 계속): ${message}`,
      );
    }
  }
}
