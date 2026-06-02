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
import { SavedDisclosuresService } from './saved-disclosures.service';
import { CreateSavedDisclosureDto } from './dto/create-saved-disclosure.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Saved Disclosures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('saved-disclosures')
export class SavedDisclosuresController {
  constructor(private readonly service: SavedDisclosuresService) {}

  @Get()
  @ApiOperation({ summary: '저장된 공시 목록 조회' })
  async findAll(@CurrentUser('id') userId: string) {
    const result = await this.service.findAll(userId);
    return {
      success: true,
      data: result.items,
      meta: { total: result.total },
    };
  }

  @Post()
  @ApiOperation({ summary: '공시 저장' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSavedDisclosureDto,
  ) {
    const item = await this.service.create(userId, dto);
    return { success: true, data: item };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '저장된 공시 삭제 (by id)' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.service.remove(userId, id);
  }

  @Delete('rcpNo/:rcpNo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '저장된 공시 삭제 (by rcpNo)' })
  async removeByRcpNo(
    @CurrentUser('id') userId: string,
    @Param('rcpNo') rcpNo: string,
  ) {
    await this.service.removeByRcpNo(userId, rcpNo);
  }

  @Get('check/:rcpNo')
  @ApiOperation({ summary: '공시 저장 여부 확인' })
  async checkSaved(
    @CurrentUser('id') userId: string,
    @Param('rcpNo') rcpNo: string,
  ) {
    const isSaved = await this.service.isSaved(userId, rcpNo);
    return { success: true, data: { isSaved } };
  }
}
