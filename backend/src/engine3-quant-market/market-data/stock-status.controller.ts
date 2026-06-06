import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DartStockStatusService } from './dart-stock-status.service';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';

/**
 * 종목 위험상태(관리종목·거래정지·상폐위험) 조회 API (DAR-99, read-only).
 *
 * KRX 데이터마켓플레이스 승인 전까지 DART 공시 폴백(DartStockStatusService)으로 도출한
 * 위험상태를 company·signals 화면 배지에 노출한다. 응답은 항상 approximate=true 로,
 * 화면이 '근사값(DART 공시 기반)' 라벨을 표기하도록 한다(KRX 정밀 실시간 아님 명시).
 *
 * 인증(DAR-54/DAR-96 패턴): 읽기 전용·손실 회피 1차 방어선 → OptionalJwtAuthGuard 로
 * 게스트 열람 허용. 쓰기 없음. KRX 승인 후 데이터소스만 교체하고 화면 계약은 불변.
 */
@ApiTags('Stock Status')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller('stock-status')
export class StockStatusController {
  constructor(private readonly dartStockStatus: DartStockStatusService) {}

  @Get('risk')
  @ApiOperation({
    summary:
      '종목 위험상태 조회 — 관리종목·거래정지·상폐위험 (DART 공시 폴백·근사값, 게스트 열람 가능, DAR-99)',
  })
  @ApiQuery({ name: 'corpCode', required: false, description: 'DART 고유번호 8자리' })
  @ApiQuery({ name: 'stockCode', required: false, description: '종목코드 6자리 (corpCode 미지정 시)' })
  async risk(
    @Query('corpCode') corpCode?: string,
    @Query('stockCode') stockCode?: string,
  ) {
    const data = await this.dartStockStatus.getRiskStatus({
      corpCode: corpCode || null,
      stockCode: stockCode || null,
    });
    return { success: true, data };
  }
}
