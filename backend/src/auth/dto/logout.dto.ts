import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  @ApiPropertyOptional({ description: '삭제할 디바이스 푸시 토큰' })
  @IsString()
  @IsOptional()
  deviceToken?: string;
}
