import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AosAllocationService } from './services/aos-allocation.service';

@ApiTags('AOS Allocation')
@ApiBearerAuth()
@Controller('aos/allocation')
@UseGuards(JwtAuthGuard)
export class AosAllocationController {
  constructor(private readonly allocation: AosAllocationService) {}

  @Get('summary')
  async summary(@CurrentUser('id') userId: string) {
    return { success: true as const, data: await this.allocation.mobileSummary(userId) };
  }
}
