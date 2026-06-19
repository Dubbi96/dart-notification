import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { StockQuoteService } from './stock-quote.service';
import { MarketDataService } from './market-data.service';
import { CandleHistoryService } from './candle-history.service';
import { CANDLE_RESOLUTIONS, CandleQueryError } from './candle-query';
import { StockMinutePriceCollector } from './stock-minute-price.collector';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';

@ApiTags('Market Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('market-data')
export class MarketDataController {
  constructor(
    private readonly scheduler: KrxMarketDataScheduler,
    private readonly stockQuote: StockQuoteService,
    private readonly marketData: MarketDataService,
    private readonly candleHistory: CandleHistoryService,
    private readonly minuteCollector: StockMinutePriceCollector,
  ) {}

  // 가격 배지 종단연결(DAR-158): 읽기 전용 시세 조회는 게스트 열람 허용(DAR-99 패턴).
  // 클래스 기본 JwtAuthGuard 를 메서드 단위 OptionalJwtAuthGuard 로 오버라이드한다.
  @Get('quote')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '종목 최신 시세 조회 — 최종가·전일대비%·5일 스파크라인 (실시간 우선·일봉 폴백, 게스트 열람 가능, DAR-158)',
  })
  @ApiQuery({
    name: 'stockCodes',
    required: true,
    description: '종목코드 6자리 콤마구분 (예: 005930,000660). 데이터 없는 종목은 null.',
  })
  async getQuote(@Query('stockCodes') stockCodes?: string) {
    const codes = (stockCodes ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const data = await this.stockQuote.getQuotes(codes);
    return { success: true, data };
  }

  // 분봉 엔드포인트 노출(DAR-352): KIS fetchMinuteCandles 가 구현돼 있으나 조회 경로가 없어
  // 모바일이 못 쓰던 문제 해소. quote 와 동일 게스트 열람 패턴(OptionalJwtAuthGuard).
  // ★정직: 캔들은 '실제 시장 실시간가' — 응답 source/asOf 로 환경 시계 괴리 고지. 비파괴 read-only.
  @Get('minute-candles')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '종목 분봉 조회 — 당일 KIS 실시간(시간 오름차순) 우선, 미가용 시 저장분(StockMinutePrice) 폴백. ' +
      'tradeDate 지정 시 해당 거래일 저장분 서빙(과거 분봉은 저장분만 — KIS 미제공). ' +
      '미가용 시 빈 배열 graceful (게스트 열람, DAR-352·DAR-377)',
  })
  @ApiQuery({
    name: 'stockCode',
    required: true,
    description: '종목코드 6자리 (예: 005930). 형식 위반·데이터 없음 시 candles 빈 배열.',
  })
  @ApiQuery({
    name: 'tradeDate',
    required: false,
    description:
      '거래일 YYYYMMDD (예: 20260620). 지정 시 저장분(StockMinutePrice)에서 해당일 분봉 서빙. ' +
      '미지정 시 당일 KIS 실시간 우선·저장 최근일 폴백. ★과거 분봉은 수집 시작일부터의 저장분만 존재.',
  })
  async getMinuteCandles(
    @Query('stockCode') stockCode?: string,
    @Query('tradeDate') tradeDate?: string,
  ) {
    const data = await this.stockQuote.getMinuteCandles(stockCode ?? '', { tradeDate });
    return { success: true, data };
  }

  // 구간 캔들 조회(DAR-378·DAR-381): TimescaleDB 하이퍼테이블(분봉) + 연속집계(5m/15m/1d)에서
  // from~to 구간 + 해상도 + 페이지네이션 + 서버측 다운샘플로 반환한다. 모바일에 원본 분봉
  // 대량 전송 금지 — limit 으로 다운샘플 상한 강제. minute-candles(당일 KIS 실시간) 와 달리
  // 적재된 시계열을 구간 조회한다. ★정직: source/asOf 로 출처·조회시각 고지(미적용 시 UNAVAILABLE).
  // quote 와 동일 게스트 열람 패턴(OptionalJwtAuthGuard).
  @Get('candles')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '구간 캔들 조회 — TimescaleDB 분봉 하이퍼테이블/연속집계(1m·5m·15m·1d), from~to+해상도+페이지네이션 서버측 다운샘플 (게스트 열람, DAR-381)',
  })
  @ApiQuery({ name: 'stockCode', required: true, description: '종목코드 6자리 (예: 005930)' })
  @ApiQuery({
    name: 'resolution',
    required: false,
    description: `해상도 ${CANDLE_RESOLUTIONS.join('|')} (기본 1m). 5m/15m/1d 는 연속집계 롤업 조회.`,
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: '구간 시작(포함) — ISO 8601 또는 YYYYMMDD/YYYYMMDDHHmm(UTC)',
  })
  @ApiQuery({ name: 'to', required: false, description: '구간 끝(포함) — from 과 동일 형식' })
  @ApiQuery({
    name: 'before',
    required: false,
    description: '페이지네이션 커서 — 이 시각 이전(미만) 캔들만(과거 페이지). 응답 nextCursor 사용.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '한 페이지 캔들 수 (기본 200, 최대 1000).',
  })
  async getCandles(
    @Query('stockCode') stockCode?: string,
    @Query('resolution') resolution?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const data = await this.candleHistory.getCandles({
        stockCode,
        resolution,
        from,
        to,
        before,
        limit,
      });
      return { success: true, data };
    } catch (err) {
      if (err instanceof CandleQueryError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // 분봉 수동 수집(DAR-377·DAR-381): cron(장중 10분 간격) 외에 단발 수집을 트리거한다. 우선순위 상위
  // 종목의 당일 분봉을 KIS 에서 받아 StockMinutePrice(TimescaleDB 하이퍼테이블)에 멱등 적재하고
  // 커버리지 리포트를 반환한다. ★KIS 일일 쿼터·레이트리밋 가드(cap·스로틀) 내에서 동작.
  @Post('collect/minute-prices')
  @ApiOperation({
    summary:
      '분봉 수동 수집 — 우선순위 상위 종목 당일 분봉을 StockMinutePrice(하이퍼테이블)에 멱등 적재 + 커버리지 리포트 (DAR-381)',
  })
  @ApiQuery({
    name: 'cap',
    required: false,
    description: '수집 상한 종목 수(KIS 쿼터 가드). 미지정 시 기본(env KIS_MINUTE_COLLECT_CAP→100).',
  })
  @ApiQuery({
    name: 'tradeDate',
    required: false,
    description: '적재 거래일 YYYYMMDD 강제(미지정 시 KRX 실 가용 거래일로 해석).',
  })
  async collectMinutePrices(
    @Query('cap') cap?: string,
    @Query('tradeDate') tradeDate?: string,
  ) {
    const parsedCap = cap ? parseInt(cap, 10) : undefined;
    const result = await this.minuteCollector.collectOnce({
      cap: Number.isFinite(parsedCap) && (parsedCap as number) > 0 ? parsedCap : undefined,
      tradeDate: tradeDate || undefined,
    });
    return { success: true, data: result };
  }

  /**
   * 시장지수 최신값 조회 (DAR-160, read-only).
   * KOSPI·KOSDAQ 최신 종가 + 전일대비 등락률(%) + 거래일을 반환한다. 홈 헤더 '시장 한눈에'
   * 배지·신호 화면 시장국면 맥락에 쓰인다. 시장 데이터는 비개인 공개정보이므로
   * 메서드 단위 OptionalJwtAuthGuard 로 컨트롤러 기본 JwtAuthGuard 를 덮어 게스트 열람을 허용한다.
   */
  @Get('indices/latest')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '시장지수 최신값 — KOSPI·KOSDAQ 종가·전일대비 등락률 (게스트 열람, DAR-160)',
  })
  async latestIndices() {
    const data = await this.marketData.fetchLatestIndices();
    return { success: true, data };
  }

  @Post('collect/daily')
  @ApiOperation({ summary: 'KRX 일봉 수동 수집 (날짜 지정)' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectDaily(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectDailyPricesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/indices')
  @ApiOperation({ summary: 'KRX 시장지수 수동 수집' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectIndices(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectMarketIndicesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/status')
  @ApiOperation({ summary: 'KRX 종목상태 수동 수집' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectStatus(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectStockStatusesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/all')
  @ApiOperation({ summary: 'KRX EOD 통합 수집 (일봉+지수+종목상태)' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectAll(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectAll(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/catch-up')
  @ApiOperation({
    summary:
      'KRX 일봉·지수 캐치업 — 마지막 적재일~최신 가용 거래일 갭을 멱등 백필 (DAR-375). ' +
      '최신 가용일을 KRX 프로브로 산출하므로 저장소가 정체돼 있어도 전진한다.',
  })
  async collectCatchUp() {
    const [daily, indices] = await Promise.all([
      this.scheduler.catchUpDailyPrices('MANUAL'),
      this.scheduler.catchUpMarketIndices('MANUAL'),
    ]);
    return { success: true, data: { daily, indices } };
  }

  @Post('sync-company-markets')
  @ApiOperation({
    summary:
      'KRX 기준정보로 company.market 을 KOSPI/KOSDAQ 로 분류·백필 (DAR-328, 멱등) — EventStudy noStockOrMarket 스킵 해소',
  })
  @ApiQuery({
    name: 'basDd',
    required: false,
    description:
      '기준일 YYYYMMDD (미전달 시 최신 가용 거래일 사용 — DAR-331: 시스템 시계가 실 KRX 데이터에 선행하므로 StockDailyPrice 최신일 우선)',
  })
  async syncCompanyMarkets(@Query('basDd') basDd?: string) {
    // DAR-329: basDd 미전달 시 parseDate(undefined) 500 방지.
    // DAR-331: scheduler 가 미전달 시 '최신 가용 거래일'(StockDailyPrice 최신 tradeDate)로 해석.
    const result = await this.scheduler.syncCompanyMarkets(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('backfill/daily')
  @ApiOperation({
    summary: 'KRX 히스토리컬 일봉 백필 (과거 N거래일, 멱등)',
  })
  @ApiQuery({ name: 'days', required: false, description: '수집할 과거 거래일 수 (기본 60)' })
  @ApiQuery({ name: 'endDate', required: false, description: '백필 종료일 YYYYMMDD (기본 오늘)' })
  async backfillDaily(
    @Query('days') days?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.scheduler.backfillDailyPrices({
      days: days ? parseInt(days, 10) : undefined,
      endDate: endDate || undefined,
    });
    return { success: true, data: result };
  }

  @Get('collection-logs')
  @ApiOperation({ summary: '시세 수집 이력 조회 (최근 20건)' })
  @ApiQuery({ name: 'tradeDate', required: false, description: '날짜 필터 YYYYMMDD' })
  async getCollectionLogs(@Query('tradeDate') tradeDate?: string) {
    return this.scheduler.getCollectionLogs(tradeDate);
  }
}
