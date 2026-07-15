import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '현재 사용자 조회' })
  async getMe(@CurrentUser('id') userId: string) {
    const user = await this.usersService.findMe(userId);
    return { success: true, data: user };
  }

  @Patch('me')
  @ApiOperation({ summary: '프로필 수정' })
  async updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.updateMe(userId, dto);
    return { success: true, data: user };
  }

  // ── Pro 출시 알림 사전신청 (갭분석 W1) — 서버 영속화로 수요 계측 ──────────

  @Get('pro-waitlist')
  @ApiOperation({ summary: 'Pro 사전신청 여부 조회 (본인)' })
  async getProWaitlist(@CurrentUser('id') userId: string) {
    const status = await this.usersService.getProWaitlistStatus(userId);
    return { success: true, data: status };
  }

  @Post('pro-waitlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pro 사전신청 등록 (멱등 — 재호출해도 1행 유지)' })
  async joinProWaitlist(@CurrentUser('id') userId: string) {
    const status = await this.usersService.joinProWaitlist(userId);
    return { success: true, data: status };
  }

  @Delete('pro-waitlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pro 사전신청 철회 (멱등 — 미신청이어도 no-op)' })
  async leaveProWaitlist(@CurrentUser('id') userId: string) {
    const status = await this.usersService.leaveProWaitlist(userId);
    return { success: true, data: status };
  }

  @Delete('me')
  @ApiOperation({
    summary: '계정 삭제(회원 탈퇴)',
    description:
      '계정과 모든 개인 데이터(관심기업·알림·저장 공시·포트폴리오 등)를 영구 삭제하고 refresh 토큰을 전부 폐기한다. Play 스토어 계정 삭제 요구사항.',
  })
  async deleteMe(@CurrentUser('id') userId: string) {
    const result = await this.usersService.deleteMe(userId);
    return { success: true, data: result };
  }
}
