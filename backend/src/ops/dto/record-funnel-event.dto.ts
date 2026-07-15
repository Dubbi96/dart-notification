import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 온보딩 퍼널 5단계(갭분석 W15) — FunnelEvent.step 허용값.
 * install → intro → kakao → watchlist(관심기업) → push_permission(푸시권한).
 * 모바일 utils/funnel.ts 의 FUNNEL_STEPS 와 정확히 일치해야 한다(계측 SSOT 미러).
 */
export const FUNNEL_STEPS = [
  'install',
  'intro',
  'kakao',
  'watchlist',
  'push_permission',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export class RecordFunnelEventDto {
  @ApiProperty({
    description: '디바이스 단위 익명 ID(로그인 전 단계 추적, 모바일이 생성·영속)',
    example: '6f0c2b3e-8a41-4b7d-9d2f-1c5e7a9b3d10',
    minLength: 8,
    maxLength: 64,
  })
  @IsString()
  @Length(8, 64)
  anonId: string;

  @ApiProperty({
    description: '퍼널 단계',
    enum: FUNNEL_STEPS,
    example: 'intro',
  })
  @IsIn(FUNNEL_STEPS)
  step: FunnelStep;

  @ApiPropertyOptional({
    description: '스텝별 부가 정보(예: watchlist 선택 수, 푸시 권한 결과)',
    example: { selectedCount: 3 },
  })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
