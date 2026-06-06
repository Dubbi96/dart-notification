import { IsOptional, IsBoolean, IsArray, IsString, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
