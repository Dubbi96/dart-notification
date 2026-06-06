import { Module } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { FinancialCollectionService } from './financial-collection.service';
import { FinancialCollectionScheduler } from './financial-collection.scheduler';
import { FinancialQueryService } from './financial-query.service';
import { FinancialsController } from './financials.controller';

/**
 * 재무지표 도메인 (DAR-52 + DAR-55) — DART 재무제표 수집 + 정기 크론 + 조회.
 * 수집(FinancialCollectionService)은 engine1 DART 클라이언트를 재사용,
 * 정기 수집(FinancialCollectionScheduler)은 전종목 벌크·실적시즌·정기보고서 EVENT 크론,
 * 조회(FinancialQueryService)는 Persona P-B/BuyScore가 DB 경유로 읽는 진입점.
 */
@Module({
  imports: [DartApiModule],
  controllers: [FinancialsController],
  providers: [
    FinancialCollectionService,
    FinancialCollectionScheduler,
    FinancialQueryService,
  ],
  exports: [FinancialCollectionService, FinancialQueryService],
})
export class FinancialsModule {}
