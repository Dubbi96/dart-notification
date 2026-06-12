import { IsOptional, IsInt, Min, Max, IsBooleanString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NotificationType } from '@prisma/client';

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
}
