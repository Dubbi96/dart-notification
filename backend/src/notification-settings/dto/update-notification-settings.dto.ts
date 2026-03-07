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
  @ArrayMaxSize(10)
  @IsOptional()
  keywords?: string[];

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}
