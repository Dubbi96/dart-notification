import { IsNotEmpty, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @IsNotEmpty()
  deviceToken: string;

  @ApiProperty({ example: 'ios', enum: ['ios', 'android'] })
  @IsString()
  @IsIn(['ios', 'android'])
  platform: string;
}
