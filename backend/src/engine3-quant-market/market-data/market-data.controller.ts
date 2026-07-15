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
import { IndicatorHistoryService } from './indicator-history.service';
import { IndicatorQueryError } from './indicator-query';
import { StockMinutePriceCollector } from './stock-minute-price.collector';
import { EtfDailyBackfillService } from './etf-daily-backfill.service';
import { InvestorFlowQueryService } from './investor-flow.query.service';
import { InvestorFlowCollector } from './investor-flow.collector';
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
    private readonly etfBackfill: EtfDailyBackfillService,
    private readonly investorFlowQuery: InvestorFlowQueryService,
    private readonly investorFlowCollector: InvestorFlowCollector,
    private readonly indicatorHistory: IndicatorHistoryService,
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

  // 구간 캔들 조회(DAR-378·DAR-381·DAR-384): 해상도별 캐노니컬 소스에서 from~to 구간 + 해상도 +
  // 페이지네이션 + 서버측 다운샘플로 반환한다. 1m=분봉 하이퍼테이블, 5m/15m=연속집계 롤업,
  // ★1d=KRX 일봉 stock_daily_prices(StockDailyPrice 딥히스토리 백필, source=EOD) — 분봉 롤업은
  // 수집 시작 이후만 커버하므로 과거 일봉은 일봉 테이블이 캐노니컬. 모바일에 원본 대량 전송 금지 —
  // limit 으로 다운샘플 상한 강제. ★정직: source/asOf 로 출처·조회시각 고지(미적용 시 UNAVAILABLE).
  // quote 와 동일 게스트 열람 패턴(OptionalJwtAuthGuard).
  @Get('candles')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '구간 캔들 조회 — 1m·5m·15m=TimescaleDB 분봉 하이퍼테이블/연속집계, 1d=KRX 일봉 StockDailyPrice(EOD 딥히스토리). from~to+해상도+페이지네이션 서버측 다운샘플 (게스트 열람, DAR-384)',
  })
  @ApiQuery({ name: 'stockCode', required: true, description: '종목코드 6자리 (예: 005930)' })
  @ApiQuery({
    name: 'resolution',
    required: false,
    description: `해상도 ${CANDLE_RESOLUTIONS.join('|')} (기본 1m). 5m/15m 는 연속집계 롤업, 1d 는 KRX 일봉(StockDailyPrice) 딥히스토리 조회.`,
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

  // 기술지표 구간 조회(W13 데이터 자산 표면 개방): TechnicalIndicator 는 전종목 EOD 적재·인덱스
  // 완비인데 사용자 조회 API 가 0개였다(ops 백필 POST 만 존재). candles 와 동일한 파라미터·응답
  // 규약(from~to+before 커서+limit 상한, newest-first 조회 후 오름차순 반환)으로 개방한다 —
  // Buy Score 입력 근거 검증·차트 오버레이용. ★정직: latestTradeDate(지표 기준일)로 T+1 stale
  // 을 숨기지 않는다. 읽기 전용 시장 파생 데이터라 quote/candles 와 동일 게스트 열람 패턴.
  @Get('indicators')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '기술지표 구간 조회 — TechnicalIndicator(MA5/20/60/120·RSI14·MACD·볼린저·ATR14·VWAP·거래량비율 등, EOD 일봉 파생). ' +
      'from~to+페이지네이션, 응답 latestTradeDate=지표 기준일(적재 최신 거래일 — T+1 지연 정직 고지) (게스트 열람, W13)',
  })
  @ApiQuery({ name: 'stockCode', required: true, description: '종목코드 6자리 (예: 005930)' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: '구간 시작(포함) — ISO 8601 또는 YYYYMMDD (candles 와 동일 형식)',
  })
  @ApiQuery({ name: 'to', required: false, description: '구간 끝(포함) — from 과 동일 형식' })
  @ApiQuery({
    name: 'before',
    required: false,
    description: '페이지네이션 커서 — 이 거래일 이전(미만) 지표만(과거 페이지). 응답 nextCursor 사용.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '한 페이지 지표 행 수 (기본 200, 최대 1000).',
  })
  async getIndicators(
    @Query('stockCode') stockCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const data = await this.indicatorHistory.getIndicators({
        stockCode,
        from,
        to,
        before,
        limit,
      });
      return { success: true, data };
    } catch (err) {
      if (err instanceof IndicatorQueryError) {
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
   * 종목 투자자별 매매동향 조회 (갭분석 W16 ③, read-only).
   * 외국인/기관/개인 순매수 시계열 + 5/20일 누적 요약 — 모바일 '수급 요약' 카드 소비.
   * 비개인 공개 시장 데이터이므로 quote/candles 와 동일 게스트 열람 패턴(OptionalJwtAuthGuard).
   * ★SHADOW: 표면 전용 — Buy Score·트레이딩 무접점.
   */
  @Get('investor-flow')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '종목 투자자별 매매동향 — 외국인/기관/개인 순매수(수량·금액) 최근 N거래일 + 5/20일 누적 요약. ' +
      '데이터 없으면 asOfDate=null 빈 결과 graceful (게스트 열람, W16)',
  })
  @ApiQuery({ name: 'stockCode', required: true, description: '종목코드 6자리 (예: 005930)' })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '조회 거래일 수 (기본 20, 최대 120). 요약(5/20일)은 항상 최근 20일로 산출.',
  })
  async getInvestorFlow(@Query('stockCode') stockCode?: string, @Query('days') days?: string) {
    const data = await this.investorFlowQuery.getInvestorFlow(stockCode ?? '', days);
    return { success: true, data };
  }

  /**
   * 종목 공매도 일별 조회 (갭분석 W16 ③, read-only).
   * 공매도 거래량·거래대금·거래비중(일봉 volume 조인 산출) 시계열. 잔고 필드는 소스 미가용 시
   * null(합성 금지 — 정직). publishedDate(T+2 영업일)를 행별 동반해 as-of 소비를 지원한다.
   */
  @Get('short-selling')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '종목 공매도 일별 — 공매도 거래량·거래대금·거래비중(%) 최근 N거래일 + publishedDate(T+2). ' +
      '잔고 필드는 무료 소스 미가용으로 null. 데이터 없으면 asOfDate=null graceful (게스트 열람, W16)',
  })
  @ApiQuery({ name: 'stockCode', required: true, description: '종목코드 6자리 (예: 005930)' })
  @ApiQuery({ name: 'days', required: false, description: '조회 거래일 수 (기본 20, 최대 120)' })
  async getShortSelling(@Query('stockCode') stockCode?: string, @Query('days') days?: string) {
    const data = await this.investorFlowQuery.getShortSelling(stockCode ?? '', days);
    return { success: true, data };
  }

  /**
   * 수급·공매도 수동 수집 (갭분석 W16 — cron 3슬롯 외 단발 트리거/백필용).
   * 소스 체인(KRX→KIS)·done-set 멱등·publishedDate=T+2 는 cron 경로와 동일(SSOT collectOnce).
   */
  @Post('collect/investor-flow')
  @ApiOperation({
    summary:
      '수급·공매도 수동 수집 — 투자자별 매매동향(InvestorFlowDaily) + 공매도 일별(ShortSellingDaily) ' +
      '멱등 적재. cap 으로 KIS 유량 가드 (W16)',
  })
  @ApiQuery({
    name: 'cap',
    required: false,
    description: '수집 상한 종목 수(KIS 유량 가드). 미지정 시 env INVESTOR_FLOW_COLLECT_CAP→3000.',
  })
  async collectInvestorFlow(@Query('cap') cap?: string) {
    const parsedCap = cap ? parseInt(cap, 10) : undefined;
    const capOpt =
      Number.isFinite(parsedCap) && (parsedCap as number) > 0 ? parsedCap : undefined;
    const investorFlow = await this.investorFlowCollector.collectInvestorFlowOnce({ cap: capOpt });
    const shortSelling = await this.investorFlowCollector.collectShortSellingOnce({ cap: capOpt });
    return { success: true, data: { investorFlow, shortSelling } };
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

  @Post('backfill/indices')
  @ApiOperation({
    summary:
      '시장지수 과거 깊이 백필 (DAR-398) — stock_daily_prices 거래일 중 market_indices 결손분을 ' +
      '오래된 순으로 멱등 수집. EventStudy 초과수익(AR)의 시장 기준선 결측(noIndexPrices) 해소.',
  })
  @ApiQuery({ name: 'fromDate', required: false, description: '거래일 하한 YYYYMMDD' })
  @ApiQuery({ name: 'toDate', required: false, description: '거래일 상한 YYYYMMDD' })
  @ApiQuery({ name: 'maxDays', required: false, description: '1회 수집 상한(기본 500)' })
  async backfillIndices(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('maxDays') maxDays?: string,
  ) {
    const result = await this.scheduler.backfillMarketIndexHistory({
      fromDate,
      toDate,
      maxDays: maxDays ? parseInt(maxDays, 10) : undefined,
      triggeredBy: 'MANUAL',
    });
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

  @Post('backfill/deep')
  @ApiOperation({
    summary:
      'KRX 일봉 과거 깊이 백필 — 가장 오래된 적재일부터 더 과거로 이어 수집 (DAR-376, 재개 가능·멱등). ' +
      '같은 명령을 반복 실행하면 KRX 제공 한도까지 점진적으로 깊어진다.',
  })
  @ApiQuery({ name: 'days', required: false, description: '추가로 수집할 과거 거래일 수 (기본 120)' })
  async backfillDeep(@Query('days') days?: string) {
    const result = await this.scheduler.backfillDailyHistoryDeep({
      days: days ? parseInt(days, 10) : undefined,
    });
    return { success: true, data: result };
  }

  @Get('coverage')
  @ApiOperation({
    summary:
      '일봉 적재 커버리지·갭 리포트 (DAR-376) — 유니버스 대비 누락 종목·거래일 범위·총 행수. EventStudy 데이터 충분성 점검.',
  })
  async coverage() {
    const data = await this.scheduler.getDailyCoverageReport();
    return { success: true, data };
  }

  @Get('collection-logs')
  @ApiOperation({ summary: '시세 수집 이력 조회 (최근 20건)' })
  @ApiQuery({ name: 'tradeDate', required: false, description: '날짜 필터 YYYYMMDD' })
  async getCollectionLogs(@Query('tradeDate') tradeDate?: string) {
    return this.scheduler.getCollectionLogs(tradeDate);
  }

  /**
   * ETF 과거 일봉 백필 (DAR-490 [견고화 W1·P11]) — KIS 기간별시세 페이지네이션 + S3 원본 보관.
   *
   * 유니버스 4종(etf-universe.ts) 과거 일봉을 가능한 최장(목표 3년+)으로 EtfDailyPrice 에 멱등 적재.
   * 창별 KIS 원본 응답(JSON)을 S3 콜드 보관(결정적 키). 커버리지 리포트 반환(P16 게이트 근거).
   *
   * ★상시 크론 아님(일일 증분은 P10 크론) — 수동 단발 실행 전용.
   * ★KIS 키 미설정 시 적재 0, 기존 DB 커버리지만 반환.
   */
  @Post('backfill/etf-daily')
  @ApiOperation({
    summary:
      'ETF 과거 일봉 백필 — KIS 기간별시세 페이지네이션·S3 원본 보관·커버리지 리포트 (DAR-490, 수동 단발)',
  })
  @ApiQuery({
    name: 'minStartYmd',
    required: false,
    description: '백필 하한 YYYYMMDD (기본 20100101 — 상장 이전 구간은 빈 창 조기종료로 자동 스킵)',
  })
  @ApiQuery({
    name: 'endYmd',
    required: false,
    description: '조회 종료일 YYYYMMDD (기본 KST 오늘)',
  })
  async backfillEtfDaily(
    @Query('minStartYmd') minStartYmd?: string,
    @Query('endYmd') endYmd?: string,
  ) {
    const result = await this.etfBackfill.backfill({
      minStartYmd: minStartYmd || undefined,
      endYmd: endYmd || undefined,
    });
    return { success: true, data: result };
  }

  /**
   * ETF 일봉 커버리지 리포트 (DAR-490) — 적재 없이 현재 DB 상태만 조회.
   * 종목별 시작일·행수·갭(누락 거래일 추정)·의심 홀 요약 → P16 데이터 품질 판단 근거.
   */
  @Get('backfill/etf-daily/coverage')
  @ApiOperation({
    summary:
      'ETF 일봉 커버리지 리포트 — 종목별 시작일·행수·갭(누락 거래일 추정). 백필 없이 현재 DB 상태만 (DAR-490)',
  })
  async etfDailyCoverage() {
    const data = await this.etfBackfill.coverageReport();
    return { success: true, data };
  }
}
