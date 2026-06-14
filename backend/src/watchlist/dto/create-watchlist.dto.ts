import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWatchlistDto {
  @ApiProperty({ example: '00126380', description: 'DART 고유번호 (8자리)' })
  @IsString()
  @IsNotEmpty()
  @Length(8, 8)
  corpCode: string;

  @ApiProperty({ example: '삼성전자', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  corpName: string;
}
