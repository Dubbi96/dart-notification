import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiProperty({ example: '김철수', required: false })
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;
}
