import { IsString, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UnifiedSearchDto {
  @ApiProperty({ description: '통합 검색어 (기업명·종목코드·공시명)', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  q: string;

  @ApiProperty({ required: false, default: 10, description: '기업 카테고리 최대 건수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  companyLimit?: number = 10;

  @ApiProperty({ required: false, default: 10, description: '공시 카테고리 최대 건수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  disclosureLimit?: number = 10;
}
