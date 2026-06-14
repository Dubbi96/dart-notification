import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiProperty({ example: '김철수', required: false, maxLength: 40 })
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(40)
  name?: string;
}
