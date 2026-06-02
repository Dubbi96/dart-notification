import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Scheduler')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('collect')
  @ApiOperation({ summary: '공시 수동 수집 (날짜 지정)' })
  @ApiQuery({ name: 'bgnDe', required: true, description: 'YYYYMMDD' })
  @ApiQuery({ name: 'endDe', required: true, description: 'YYYYMMDD' })
  async collect(
    @Query('bgnDe') bgnDe: string,
    @Query('endDe') endDe: string,
  ) {
    const result = await this.schedulerService.collectByDate(bgnDe, endDe);
    return { success: true, data: result };
  }
}
