import { IsOptional, IsString, IsInt, IsIn, Matches, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * 내부자/대량보유 지분변동 조회 쿼리 (DAR-88).
 * corpCode·기간·순매수방향(tradeType)·출처(source) 필터 + 페이지네이션.
 * read-only — 자연키 corpCode FK 정합 유지(write 경로 아님).
 */
export class QueryInsiderHoldingsDto {
  @ApiProperty({ required: false, description: '기업 필터(corpCode)' })
  @IsOptional()
  @IsString()
  corpCode?: string;

  @ApiProperty({
    required: false,
    description: '매매 방향: BUY(취득) | SELL(처분) | MIXED | UNKNOWN',
  })
  @IsOptional()
  @IsIn(['BUY', 'SELL', 'MIXED', 'UNKNOWN'])
  tradeType?: 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';

  @ApiProperty({
    required: false,
    description: '출처: MAJOR_STOCK(5% 대량보유) | EXECUTIVE(임원·주요주주)',
  })
  @IsOptional()
  @IsIn(['MAJOR_STOCK', 'EXECUTIVE'])
  source?: 'MAJOR_STOCK' | 'EXECUTIVE';

  @ApiProperty({ required: false, description: '보고일 시작(YYYYMMDD)' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'from은 YYYYMMDD 8자리여야 합니다' })
  from?: string;

  @ApiProperty({ required: false, description: '보고일 종료(YYYYMMDD)' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'to는 YYYYMMDD 8자리여야 합니다' })
  to?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
