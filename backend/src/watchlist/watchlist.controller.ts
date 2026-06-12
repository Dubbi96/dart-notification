import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WatchlistService } from './watchlist.service';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Watchlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  @ApiOperation({ summary: '관심 기업 목록 조회' })
  async findAll(@CurrentUser('id') userId: string) {
    const result = await this.watchlistService.findAll(userId);
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, limit: result.limit },
    };
  }

  @Post()
  @ApiOperation({ summary: '관심 기업 등록' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateWatchlistDto) {
    const item = await this.watchlistService.create(userId, dto);
    return { success: true, data: item };
  }

  @Post(':corpCode/viewed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '관심 기업 조회 시각 갱신 (신규 공시 배지 소거)' })
  async markViewed(
    @CurrentUser('id') userId: string,
    @Param('corpCode') corpCode: string,
  ) {
    const result = await this.watchlistService.markViewed(userId, corpCode);
    return { success: true, data: result };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '관심 기업 삭제' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.watchlistService.remove(userId, id);
  }
}
