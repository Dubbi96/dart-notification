import { Module } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { FinancialCollectionService } from './financial-collection.service';
import { FinancialQueryService } from './financial-query.service';
import { FinancialsController } from './financials.controller';

/**
 * 재무지표 도메인 (DAR-52) — DART 재무제표 수집 + 조회.
 * 수집(FinancialCollectionService)은 engine1 DART 클라이언트를 재사용,
 * 조회(FinancialQueryService)는 Persona P-B/BuyScore가 DB 경유로 읽는 진입점.
 */
@Module({
  imports: [DartApiModule],
  controllers: [FinancialsController],
  providers: [FinancialCollectionService, FinancialQueryService],
  exports: [FinancialCollectionService, FinancialQueryService],
})
export class FinancialsModule {}
