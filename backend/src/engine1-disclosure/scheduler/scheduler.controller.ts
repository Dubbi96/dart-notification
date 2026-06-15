import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CollectRangeDto } from './dto/collect-range.dto';

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
  async collect(@Query() query: CollectRangeDto) {
    const result = await this.schedulerService.collectByDate(
      query.bgnDe,
      query.endDe,
      'MANUAL',
    );
    return { success: true, data: result };
  }

  @Get('collection-logs')
  @ApiOperation({ summary: '공시 수집 이력 조회 (최근 50건)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
    description: '상태 필터 (미지정 시 전체)',
  })
  async getCollectionLogs(@Query('status') status?: string) {
    return this.schedulerService.getCollectionLogs(status);
  }
}
