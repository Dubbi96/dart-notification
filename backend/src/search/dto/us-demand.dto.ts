import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 갭분석 W8: 미국 주식 알림 원탭 수요 버튼 기록 요청 바디. */
export class UsDemandDto {
  @ApiProperty({
    required: false,
    maxLength: 100,
    description: '버튼 탭 시점의 검색어 (있으면 함께 기록 — 수요 맥락 보존)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
