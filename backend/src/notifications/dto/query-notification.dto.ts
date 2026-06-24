import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBooleanString,
  IsEnum,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NotificationType } from '@prisma/client';
import {
  NotificationCategory,
  NOTIFICATION_CATEGORIES,
} from '../notification-category';

export class QueryNotificationDto {
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

  @ApiProperty({ required: false, description: '읽음 필터' })
  @IsOptional()
  @IsBooleanString()
  isRead?: string;

  // DAR-161: 통합 인박스 타입 필터(공시/신호/청산/논리훼손). 미지정 시 전체.
  @ApiProperty({
    required: false,
    enum: NotificationType,
    description: '알림 타입 필터 (DISCLOSURE | SIGNAL | EXIT | THESIS_VIOLATED)',
  })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  // DAR-430: 카테고리 필터(공시/신호/체결). 여러 타입을 묶는 3 버킷.
  // category 지정 시 그 버킷의 타입들로 묶어 조회한다(type 보다 우선).
  @ApiProperty({
    required: false,
    enum: NOTIFICATION_CATEGORIES,
    description:
      '알림 카테고리 필터 (disclosure=공시 | signal=신호·청산·논리훼손 | trade=체결)',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES as readonly string[])
  category?: NotificationCategory;
}
