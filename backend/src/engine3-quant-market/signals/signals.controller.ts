import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SignalsService, SignalSort } from './signals.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';

@ApiTags('signals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  @ApiOperation({ summary: '매매 신호 목록 조회 (필터·페이지네이션)' })
  @ApiQuery({ name: 'grade', required: false, description: '신호 등급 (STRONG_BUY|BUY|WATCH|NEUTRAL|AVOID|BLOCKED). 콤마로 다중 지정 가능: "STRONG_BUY,BUY"' })
  @ApiQuery({ name: 'personaType', required: false, description: '페르소나 유형 (GROWTH|VALUE|MOMENTUM|EVENT_DRIVEN)' })
  @ApiQuery({ name: 'eventType', required: false, description: '공시 이벤트 유형 (SUPPLY_CONTRACT 등)' })
  @ApiQuery({ name: 'entryReady', required: false, description: '진입 준비 여부 (true/false)' })
  @ApiQuery({ name: 'sort', required: false, description: '정렬 (score: 점수 내림차순 | latest: 최신순, 기본 latest)' })
  @ApiQuery({ name: 'sinceDays', required: false, description: '최신성 윈도우(일) — createdAt ≥ now−N일 신호만. 1~90 클램프, 0 명시 시 윈도우 해제(전체 이력). 미지정 시 sort=score 는 기본 14일(점수순 큐레이션 최신성 계약), latest 는 무윈도우' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호 (기본: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지당 항목 수 (기본: 20)' })
  async findAll(
    @Query('grade') grade?: string,
    @Query('personaType') personaType?: string,
    @Query('eventType') eventType?: string,
    @Query('entryReady') entryReadyStr?: string,
    @Query('sort') sortStr?: string,
    @Query('sinceDays') sinceDaysStr?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const entryReady =
      entryReadyStr === 'true' ? true : entryReadyStr === 'false' ? false : undefined;
    const sort: SignalSort = sortStr === 'score' ? 'score' : 'latest';
    // DAR-273: 쿼리 정수 안전 파싱 — 비숫자/음수 → 기본값/하한, 거대값 → 상한.
    const page = parsePaginationInt(pageStr, { default: 1, min: 1 });
    const limit = parsePaginationInt(limitStr, { default: 20, min: 1, max: 100 });
    // 최신성 윈도우(일): 0=해제 특수값이므로 하한 0(음수도 0=해제로 클램프), 상한 90.
    // 미지정/비숫자(undefined)는 서비스의 기본값 규칙(sort=score → 14일)에 위임한다.
    const sinceDays = parsePaginationInt(sinceDaysStr, { min: 0, max: 90 });

    const result = await this.signalsService.findAll({
      grade,
      personaType,
      eventType,
      entryReady,
      sort,
      sinceDays,
      page,
      limit,
    });

    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('exit')
  @ApiOperation({ summary: '청산 신호 목록 조회' })
  async findExitSignals() {
    const data = await this.signalsService.findExitSignals();
    return { success: true, data };
  }

  // DAR-505: 일일 에디션 목록 — ':id'(catch-all)보다 먼저 선언해 라우트 충돌 방지.
  @Get('daily-editions')
  @ApiOperation({ summary: '일일 투자판단 에디션 날짜 목록 (판단 존재일만, 최신순)' })
  @ApiQuery({ name: 'before', required: false, description: '페이지 커서: 이 날짜(YYYYMMDD) 미만의 에디션만 반환' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지 크기 (기본 7, 최대 90)' })
  async findDailyEditions(
    @Query('before') before?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (before !== undefined && !/^\d{8}$/.test(before)) {
      throw new BadRequestException('before 파라미터는 YYYYMMDD 형식이어야 합니다');
    }
    const limit = parsePaginationInt(limitStr, { default: 7, min: 1, max: 90 });
    const result = await this.signalsService.findDailyEditions(before, limit);
    return { success: true, data: result.items, meta: result.meta };
  }

  // DAR-505: 일일 에디션 상세 — ':id'(catch-all)보다 먼저 선언해 라우트 충돌 방지.
  @Get('daily/:date')
  @ApiOperation({ summary: '일일 투자판단 에디션 조회 (KST 거래일 매수등급 랭킹 + meta)' })
  @ApiParam({ name: 'date', description: 'KST 거래일 (YYYYMMDD)' })
  async findDailyEdition(@Param('date') date: string) {
    if (!/^\d{8}$/.test(date)) {
      throw new BadRequestException('date 파라미터는 YYYYMMDD 형식이어야 합니다');
    }
    const result = await this.signalsService.findDailyEdition(date);
    return { success: true, data: result.items, meta: result.meta };
  }

  // DAR-159: 종목별 최신 신호 단건 — ':id'(catch-all)보다 먼저 선언해 라우트 충돌 방지.
  @Get('by-corp/:corpCode')
  @ApiOperation({
    summary: '종목별 최신 매수 신호 단건 조회 (corpCode, 백필 제외)',
  })
  async findLatestByCorpCode(@Param('corpCode') corpCode: string) {
    const data = await this.signalsService.findLatestByCorpCode(corpCode);
    return { success: true, data };
  }

  // DAR-208: 공시(rcpNo)로 생성된 신호 역조회 — ':id'(catch-all)보다 먼저 선언해 라우트 충돌 방지.
  @Get('by-disclosure/:rcpNo')
  @ApiOperation({
    summary: '공시(rcpNo)로 생성된 최신 매수 신호 단건 조회 (역링크, 백필 제외)',
  })
  async findByDisclosureRcpNo(@Param('rcpNo') rcpNo: string) {
    const data = await this.signalsService.findByDisclosureRcpNo(rcpNo);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: '매매 신호 상세 조회' })
  async findOne(@Param('id') id: string) {
    const data = await this.signalsService.findOne(id);
    return { success: true, data };
  }
}
