import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaperTradingService } from './paper-trading.service';

@ApiTags('Paper Trading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('paper-trading')
export class PaperTradingController {
  constructor(private readonly paperTradingService: PaperTradingService) {}

  @Get('portfolio')
  @ApiOperation({ summary: '모의투자 포트폴리오 조회' })
  async findPortfolio(@CurrentUser('id') userId: string) {
    const data = await this.paperTradingService.findPortfolio(userId);
    return { success: true, data };
  }
}
