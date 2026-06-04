import { IsOptional, IsString, IsInt, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class QueryDisclosureDto {
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
  @Max(50)
  limit?: number = 20;

  @ApiProperty({ required: false, description: '기업 필터' })
  @IsOptional()
  @IsString()
  corpCode?: string;

  @ApiProperty({ required: false, description: '공시 유형 필터' })
  @IsOptional()
  @IsString()
  disclosureType?: string;

  @ApiProperty({ required: false, description: '관심목록 기업만 필터' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  watchlistOnly?: boolean;

  @ApiProperty({ required: false, description: '키워드 필터 (쉼표 구분)' })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : value)
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}

export class SearchDisclosureDto {
  @ApiProperty({ description: '검색어 (공시명 또는 기업명)' })
  @IsString()
  q: string;

  @ApiProperty({ required: false, description: '공시 유형 필터' })
  @IsOptional()
  @IsString()
  disclosureType?: string;

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
  @Max(50)
  limit?: number = 20;
}
