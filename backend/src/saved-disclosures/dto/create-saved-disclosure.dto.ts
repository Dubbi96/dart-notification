import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CreateSavedDisclosureDto {
  @ApiProperty({
    example: '20260306000885',
    description: 'DART 접수번호 (14자리 숫자)',
  })
  @IsString()
  @Length(14, 14)
  @Matches(/^[0-9]{14}$/, { message: 'rcpNo must be a 14-digit number' })
  rcpNo: string;
}
