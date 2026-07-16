import {
  IsOptional,
  IsBoolean,
  IsArray,
  IsString,
  IsInt,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MIN_DAILY_PUSH_CAP, MAX_DAILY_PUSH_CAP } from '../../notifications/push-cap.service';

export class UpdateNotificationSettingsDto {
  @ApiProperty({
    example: ['정기공시', '주요사항보고'],
    required: false,
    description: '공시 유형 배열',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  disclosureTypes?: string[];

  @ApiProperty({
    example: ['증자', '배당'],
    required: false,
    description: '키워드 배열 (최대 10개)',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(5)
  @IsOptional()
  keywords?: string[];

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  // DAR-85: 신호·청산·논리훼손 푸시 토글(기본 OFF).
  @ApiProperty({ example: false, required: false, description: '매수 신호 푸시 발송' })
  @IsBoolean()
  @IsOptional()
  signalPushEnabled?: boolean;

  @ApiProperty({ example: false, required: false, description: '청산 권고 푸시 발송' })
  @IsBoolean()
  @IsOptional()
  exitPushEnabled?: boolean;

  @ApiProperty({ example: false, required: false, description: '투자논리 훼손 푸시 발송' })
  @IsBoolean()
  @IsOptional()
  thesisPushEnabled?: boolean;

  // DAR-424: 라이브 페이퍼 체결 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략.
  @ApiProperty({ example: true, required: false, description: '매수/매도 체결 알림(기본 ON)' })
  @IsBoolean()
  @IsOptional()
  tradePushEnabled?: boolean;

  // DAR-473(P01): 리스크·운영 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략.
  @ApiProperty({ example: true, required: false, description: '리스크·운영 알림(기본 ON)' })
  @IsBoolean()
  @IsOptional()
  opsPushEnabled?: boolean;

  // 갭분석 W7: 관심종목 급변동 알림(PRICE_MOVE) 토글(★기본 OFF — 알림 피로 방지).
  // OFF면 인박스·푸시 모두 생략. 준실시간(최대 5분 지연)·전일 종가 대비 ±5%.
  @ApiProperty({
    example: false,
    required: false,
    description: '관심종목 급변동 알림(전일 대비 ±5%, 준실시간 최대 5분 지연 — 기본 OFF)',
  })
  @IsBoolean()
  @IsOptional()
  priceMovePushEnabled?: boolean;

  // DAR-514(Wave A): 신규 2계열 토글(★기본 OFF — 보수적 기본값). 발송 배선은 Wave B 가 소비.
  @ApiProperty({
    example: false,
    required: false,
    description: '일일 에디션 발행 알림(예약 — Wave B 소비, 기본 OFF)',
  })
  @IsBoolean()
  @IsOptional()
  editionPushEnabled?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description: '다이제스트(요약) 알림(예약 — Wave B 소비, 기본 OFF)',
  })
  @IsBoolean()
  @IsOptional()
  digestPushEnabled?: boolean;

  // DAR-514(Wave A): 사용자별 일일 푸시 캡(면제 계열 제외). 기본 30·범위 1~500.
  @ApiProperty({
    example: 30,
    required: false,
    minimum: MIN_DAILY_PUSH_CAP,
    maximum: MAX_DAILY_PUSH_CAP,
    description: '일일 푸시 상한(리스크·운영 알림 제외). 초과분은 실발송 억제(인박스는 보존).',
  })
  @IsInt()
  @Min(MIN_DAILY_PUSH_CAP)
  @Max(MAX_DAILY_PUSH_CAP)
  @IsOptional()
  dailyPushCap?: number;
}
