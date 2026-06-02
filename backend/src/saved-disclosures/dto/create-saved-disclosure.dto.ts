import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateSavedDisclosureDto {
  @ApiProperty({ example: '20260306000885', description: 'DART 접수번호' })
  @IsString()
  rcpNo: string;
}
