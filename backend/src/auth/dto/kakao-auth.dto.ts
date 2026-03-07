import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class KakaoAuthDto {
  @ApiProperty({ description: '카카오 인가 코드' })
  @IsString()
  code: string;

  @ApiProperty({ description: '리다이렉트 URI' })
  @IsString()
  redirectUri: string;
}
