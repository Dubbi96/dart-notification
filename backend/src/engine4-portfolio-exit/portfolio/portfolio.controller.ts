import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PortfolioService } from './portfolio.service';

@ApiTags('Portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('positions')
  @ApiOperation({ summary: '보유 포지션 목록 조회 (OPEN)' })
  async findPositions(@CurrentUser('id') userId: string) {
    const data = await this.portfolioService.findUserPositions(userId);
    return { success: true, data };
  }

  @Get('portfolio/summary')
  @ApiOperation({ summary: '활성 포트폴리오 요약 조회' })
  async findSummary(@CurrentUser('id') userId: string) {
    const data = await this.portfolioService.findPortfolioSummary(userId);
    return { success: true, data };
  }

  @Get('portfolio/risk/latest')
  @ApiOperation({
    summary: '활성 포트폴리오 최신 리스크 스냅샷 조회 (일손익·집중도·하드룰 위반·riskLevel)',
  })
  async findLatestRisk(@CurrentUser('id') userId: string) {
    const data = await this.portfolioService.findLatestRiskSnapshot(userId);
    return { success: true, data };
  }

  @Get('positions/:id')
  @ApiOperation({ summary: '단일 포지션 조회' })
  async findPosition(
    @CurrentUser('id') userId: string,
    @Param('id') positionId: string,
  ) {
    const data = await this.portfolioService.findPosition(userId, positionId);
    return { success: true, data };
  }
}
