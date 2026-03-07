import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({ summary: '디바이스 등록' })
  async register(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto) {
    const device = await this.devicesService.register(userId, dto);
    return { success: true, data: device };
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '디바이스 삭제' })
  async remove(@CurrentUser('id') userId: string, @Param('deviceId') deviceId: string) {
    await this.devicesService.remove(userId, deviceId);
  }
}
