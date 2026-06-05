import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PositionThesisService } from './position-thesis.service';

@ApiTags('Portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('positions')
export class PositionThesisController {
  constructor(private readonly positionThesisService: PositionThesisService) {}

  @Get(':id/thesis')
  @ApiOperation({ summary: 'Position Thesis 조회' })
  async findThesis(
    @CurrentUser('id') userId: string,
    @Param('id') positionId: string,
  ) {
    const data = await this.positionThesisService.findThesis(userId, positionId);
    return { success: true, data };
  }

  @Get(':id/exit')
  @ApiOperation({ summary: '최신 ExitSignal 조회' })
  async findExitSignal(
    @CurrentUser('id') userId: string,
    @Param('id') positionId: string,
  ) {
    const data = await this.positionThesisService.findExitSignal(userId, positionId);
    return { success: true, data };
  }
}
