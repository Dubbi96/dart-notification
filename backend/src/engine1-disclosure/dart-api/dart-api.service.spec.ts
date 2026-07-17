// backend/src/engine1-disclosure/dart-api/dart-api.service.spec.ts
// DAR-396: getAllDisclosuresWithMeta — 쿼터(020/021) 인지 종료, 정상 완주, 데이터없음, 비정상 status.

import { ConfigService } from '@nestjs/config';
import {
  DartApiService,
  DartListResponse,
  DartQuotaReservedError,
} from './dart-api.service';

function listResponse(over: Partial<DartListResponse>): DartListResponse {
  return {
    status: '000',
    message: '정상',
    page_no: 1,
    page_count: 100,
    total_count: 0,
    total_page: 1,
    list: [],
    ...over,
  };
}

function disclosure(rcptNo: string, rcptDt: string) {
  return {
    corp_code: '00126380',
    corp_name: '삼성전자',
    stock_code: '005930',
    corp_cls: 'Y',
    report_nm: '주요사항보고서',
    rcept_no: rcptNo,
    flr_nm: '삼성전자',
    rcept_dt: rcptDt,
    rm: '',
  };
}

describe('DartApiService.getAllDisclosuresWithMeta (DAR-396)', () => {
  let service: DartApiService;

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    service = new DartApiService(config);
  });

  it('정상 완주: 전 페이지 누적, quotaExceeded=false, abnormalStatus=null, sort=date/desc 고정', async () => {
    const spy = jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 2,
          page_no: 1,
          list: [disclosure('A', '20250610')],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 2,
          page_no: 2,
          list: [disclosure('B', '20250605')],
        }),
      );

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');

    expect(result.items.map((i) => i.rcept_no)).toEqual(['A', 'B']);
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBeNull();
    // 정렬 방향 고정 검증(쿼터 절단 시 '최신 구간 우선' 전제 보장)
    expect(spy.mock.calls[0][0]).toMatchObject({ sort: 'date', sort_mth: 'desc' });
  });

  it('쿼터 소진(020): 그때까지 누적분 반환 + quotaExceeded=true, 추가 페이지 미요청', async () => {
    const spy = jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 5,
          page_no: 1,
          list: [disclosure('A', '20250610')],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({ status: '020', message: '사용한도를 초과하였습니다.', total_page: 5 }),
      );

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');

    expect(result.quotaExceeded).toBe(true);
    expect(result.abnormalStatus).toBeNull();
    expect(result.items.map((i) => i.rcept_no)).toEqual(['A']); // 1페이지만
    expect(spy).toHaveBeenCalledTimes(2); // 020 본 뒤 중단(3페이지 미요청)
  });

  it('조회회사수 초과(021)도 quotaExceeded=true', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '021', message: '조회 가능한 회사 개수 초과' }));

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');
    expect(result.quotaExceeded).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('데이터 없음(013): 정상 종료, quotaExceeded=false', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '013', message: '데이터 없음' }));

    const result = await service.getAllDisclosuresWithMeta('19990101', '19990130');
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBeNull();
    expect(result.items).toEqual([]);
  });

  it('쿼터 외 비정상(예: 800): abnormalStatus 로 노출(throw 없음)', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '800', message: '시스템 점검' }));

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBe('800');
    expect(result.items).toEqual([]);
  });
});

describe('DartApiService 일일 콜 예산 + 라이브 수집 예약분 (DAR-445)', () => {
  let service: DartApiService;
  // 내부 httpClient 를 모킹해 실제 네트워크 없이 콜 발생/차단을 검증한다.
  let httpGet: jest.SpyInstance;

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    service = new DartApiService(config);
    httpGet = jest
      .spyOn((service as unknown as { httpClient: { get: jest.Mock } }).httpClient, 'get')
      .mockResolvedValue({ status: 200, data: listResponse({ status: '000' }) });
  });

  /** 누적 콜을 벌크 상한(ceiling)까지 끌어올려 예약분만 남긴 상태로 만든다. */
  function fillToBulkCeiling(): void {
    const internal = service as unknown as {
      callDayKey: string;
      callsToday: number;
      currentDayKey: () => string;
    };
    internal.callDayKey = internal.currentDayKey();
    internal.callsToday = service.getQuotaBudgetStatus().bulkCeiling;
  }

  it('라이브 목록수집(bulk 기본=false)은 예약분에 닿아도 차단되지 않고 실제 호출된다', async () => {
    fillToBulkCeiling();
    expect(service.getQuotaBudgetStatus().bulkAllowed).toBe(false);

    const res = await service.getDisclosureList({ bgn_de: '20260624', end_de: '20260624' });

    expect(httpGet).toHaveBeenCalledTimes(1); // 라이브는 예약분으로 통과
    expect(res.status).toBe('000');
  });

  it('벌크 list(getAllDisclosuresWithMeta)는 예약분 도달 시 HTTP 없이 합성 020 으로 종료', async () => {
    fillToBulkCeiling();

    const result = await service.getAllDisclosuresWithMeta('20250101', '20250131');

    expect(result.quotaExceeded).toBe(true);
    expect(result.items).toEqual([]);
    expect(httpGet).not.toHaveBeenCalled(); // 사전 차단 = 쿼터 비소모
  });

  it('문서 fetch(downloadDocument)는 예약분 도달 시 QUOTA 로 분류되는 에러를 HTTP 없이 throw', async () => {
    fillToBulkCeiling();

    await expect(service.downloadDocument('20260619000100')).rejects.toBeInstanceOf(
      DartQuotaReservedError,
    );
    // classifyFetchError 가 QUOTA 로 보도록 dartStatus=020 마커 포함(retryCount 비소모 보장)
    await expect(service.downloadDocument('20260619000100')).rejects.toThrow(/dartStatus=020/);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('실제 020 관측 시 그 날 벌크 하드스톱(누적 콜이 상한 미만이어도)', async () => {
    // 라이브 list 가 실제 020 을 받으면 그 날 벌크는 즉시 막힌다.
    httpGet.mockResolvedValueOnce({
      status: 200,
      data: listResponse({ status: '020', message: '사용한도를 초과하였습니다.' }),
    });

    await service.getDisclosureList({ bgn_de: '20260624', end_de: '20260624' });

    const status = service.getQuotaBudgetStatus();
    expect(status.quotaExhausted).toBe(true);
    expect(status.bulkAllowed).toBe(false);
    expect(status.callsToday).toBeLessThan(status.bulkCeiling); // 상한 전인데도 하드스톱
    // 이후 문서 fetch 는 사전 차단
    await expect(service.downloadDocument('20260619000100')).rejects.toBeInstanceOf(
      DartQuotaReservedError,
    );
  });
});

describe('DartApiService 라이브 문서 fetch 예약분 (라이브 파싱 기아 후속)', () => {
  let service: DartApiService;
  let httpGet: jest.SpyInstance;
  // downloadDocument 의 ZIP 매직바이트 판별을 통과하는 최소 응답('PK\x03\x04' + 여유).
  const zipResponse = {
    status: 200,
    data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
  };

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    service = new DartApiService(config);
    httpGet = jest
      .spyOn((service as unknown as { httpClient: { get: jest.Mock } }).httpClient, 'get')
      .mockResolvedValue(zipResponse);
  });

  /** 누적 콜을 지정 수치로 고정(당일 키 정렬). */
  function fillTo(calls: number): void {
    const internal = service as unknown as {
      callDayKey: string;
      callsToday: number;
      currentDayKey: () => string;
    };
    internal.callDayKey = internal.currentDayKey();
    internal.callsToday = calls;
  }

  it('3단 분할 상수: bulkCeiling=14,000 · liveParseCeiling=17,000', () => {
    const status = service.getQuotaBudgetStatus();
    expect(status.bulkCeiling).toBe(14_000);
    expect(status.liveParseCeiling).toBe(17_000);
  });

  it('벌크 상한(14,000) 도달 시 bulk 문서 fetch 는 차단, live 는 예약분으로 통과', async () => {
    fillTo(service.getQuotaBudgetStatus().bulkCeiling);
    const status = service.getQuotaBudgetStatus();
    expect(status.bulkAllowed).toBe(false);
    expect(status.liveParseAllowed).toBe(true);

    // bulk(기본값) — HTTP 없이 사전 차단.
    await expect(service.downloadDocument('20260715000100')).rejects.toBeInstanceOf(
      DartQuotaReservedError,
    );
    await expect(
      service.downloadDocument('20260715000100', { priority: 'bulk' }),
    ).rejects.toBeInstanceOf(DartQuotaReservedError);
    expect(httpGet).not.toHaveBeenCalled();

    // live — 예약분(LIVE_PARSE_RESERVE)으로 실제 호출된다.
    const buf = await service.downloadDocument('20260715000100', { priority: 'live' });
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('라이브 상한(17,000) 도달 시 live 문서 fetch 도 차단(목록수집 예약분 보호)', async () => {
    fillTo(service.getQuotaBudgetStatus().liveParseCeiling);
    expect(service.getQuotaBudgetStatus().liveParseAllowed).toBe(false);

    await expect(
      service.downloadDocument('20260715000100', { priority: 'live' }),
    ).rejects.toBeInstanceOf(DartQuotaReservedError);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('당일 020 관측 시 live·bulk 둘 다 차단(실쿼터 소진은 라이브도 못 살림)', async () => {
    httpGet.mockResolvedValueOnce({
      status: 200,
      data: listResponse({ status: '020', message: '사용한도를 초과하였습니다.' }),
    });
    await service.getDisclosureList({ bgn_de: '20260715', end_de: '20260715' });

    const status = service.getQuotaBudgetStatus();
    expect(status.quotaExhausted).toBe(true);
    expect(status.bulkAllowed).toBe(false);
    expect(status.liveParseAllowed).toBe(false);

    await expect(
      service.downloadDocument('20260715000100', { priority: 'live' }),
    ).rejects.toBeInstanceOf(DartQuotaReservedError);
    await expect(
      service.downloadDocument('20260715000100', { priority: 'bulk' }),
    ).rejects.toBeInstanceOf(DartQuotaReservedError);
  });

  it('차단 에러 메시지에 dartStatus=020 마커 포함(classifyFetchError QUOTA 분류 계약)', async () => {
    fillTo(service.getQuotaBudgetStatus().liveParseCeiling);

    await expect(
      service.downloadDocument('20260715000100', { priority: 'live' }),
    ).rejects.toThrow(/dartStatus=020/);
    await expect(
      service.downloadDocument('20260715000100', { priority: 'bulk' }),
    ).rejects.toThrow(/dartStatus=020/);
  });
});

describe('DartApiService 라이브 예약분 소진 임계 OPS_ALERT (W5 ④)', () => {
  // 잔여 = DAILY_BUDGET(19,000) - callsToday. 임계 = LIVE_RESERVE(2,000) × 20% = 400콜.
  const DAILY_BUDGET = 19_000;
  const ALERT_REMAINING = 400;

  let service: DartApiService;
  let httpGet: jest.SpyInstance;
  let producer: { enqueueOpsAlert: jest.Mock };

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    producer = { enqueueOpsAlert: jest.fn().mockResolvedValue(undefined) };
    service = new DartApiService(
      config,
      producer as unknown as import('../../notifications/notification-producer.service').NotificationProducerService,
    );
    httpGet = jest
      .spyOn((service as unknown as { httpClient: { get: jest.Mock } }).httpClient, 'get')
      .mockResolvedValue({ status: 200, data: listResponse({ status: '000' }) });
  });

  /** 누적 콜을 지정 수치로 고정(당일 키 정렬). */
  function fillTo(calls: number): void {
    const internal = service as unknown as {
      callDayKey: string;
      callsToday: number;
      currentDayKey: () => string;
    };
    internal.callDayKey = internal.currentDayKey();
    internal.callsToday = calls;
  }

  it('잔여가 임계(400콜) 이하로 떨어지는 콜에서 WARNING OPS_ALERT 를 발행한다', async () => {
    fillTo(DAILY_BUDGET - ALERT_REMAINING - 1); // 다음 1콜에 잔여 400 도달

    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });

    expect(httpGet).toHaveBeenCalledTimes(1); // 알람은 라이브 콜을 막지 않는다
    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(1);
    const [severity, source, message, meta] = producer.enqueueOpsAlert.mock.calls[0];
    expect(severity).toBe('WARNING');
    expect(source).toBe('dart-quota-live-reserve');
    expect(message).toContain('예약분 잔여');
    // 일자 버킷 dedupeKey — 재기동·다경로 재발행에도 하루 1건 멱등.
    expect(meta.dedupeKey).toMatch(/^dart-quota-live-reserve:\d{8}$/);
    expect(meta.data).toMatchObject({ remaining: ALERT_REMAINING });
  });

  it('잔여가 임계보다 넉넉하면 발행하지 않는다', async () => {
    fillTo(DAILY_BUDGET - ALERT_REMAINING - 1_000);

    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });

    expect(producer.enqueueOpsAlert).not.toHaveBeenCalled();
  });

  it('★1회/일: 임계 이하에서 콜이 반복돼도 그 날은 한 번만 발행한다', async () => {
    fillTo(DAILY_BUDGET - ALERT_REMAINING - 1);

    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });
    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });
    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });

    expect(producer.enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('producer 미주입(@Optional) 환경에서도 콜 소비 본업은 깨지지 않는다', async () => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    const bare = new DartApiService(config);
    jest
      .spyOn((bare as unknown as { httpClient: { get: jest.Mock } }).httpClient, 'get')
      .mockResolvedValue({ status: 200, data: listResponse({ status: '000' }) });
    const internal = bare as unknown as {
      callDayKey: string;
      callsToday: number;
      currentDayKey: () => string;
    };
    internal.callDayKey = internal.currentDayKey();
    internal.callsToday = DAILY_BUDGET - 1; // 임계 훨씬 아래 잔여

    const res = await bare.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });
    expect(res.status).toBe('000');
  });
});

describe('DartApiService 쿼터 상태 재기동 영속화·복원 (DAR-532)', () => {
  type QuotaMock = { findUnique: jest.Mock; upsert: jest.Mock };

  function makePrisma(row: unknown): QuotaMock {
    return {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue({}),
    };
  }

  function makeService(prismaInner: QuotaMock | null): DartApiService {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    const prisma = prismaInner
      ? ({ dartQuotaState: prismaInner } as unknown as import('../../prisma/prisma.service').PrismaService)
      : undefined;
    return new DartApiService(config, undefined, prisma);
  }

  function mock020(service: DartApiService): void {
    jest
      .spyOn((service as unknown as { httpClient: { get: jest.Mock } }).httpClient, 'get')
      .mockResolvedValue({ status: 200, data: listResponse({ status: '020' }) });
  }

  it('★재기동 복원: 당일 quotaExhausted=true → 상한(14,000) 전이라도 벌크·라이브 하드스톱 재적용', async () => {
    // 야간 소진 관측 후 08:29 재기동 시나리오: in-memory 는 0/미소진으로 리셋되지만 DB 가 진실.
    const prisma = makePrisma({ day: 'ignored-by-mock', callsToday: 5_000, quotaExhausted: true });
    const service = makeService(prisma);

    await service.onModuleInit();
    const status = service.getQuotaBudgetStatus();

    expect(prisma.findUnique).toHaveBeenCalledTimes(1);
    expect(status.callsToday).toBe(5_000); // 상한 미만인데도
    expect(status.quotaExhausted).toBe(true);
    expect(status.bulkAllowed).toBe(false); // 소진 플래그 복원으로 하드스톱
    expect(status.liveParseAllowed).toBe(false); // 실쿼터 소진은 라이브 문서 fetch 도 못 살림
  });

  it('재기동 복원: 미소진 행 → callsToday 만 실소비로 복원(하드스톱 아님)', async () => {
    const prisma = makePrisma({ day: 'x', callsToday: 5_000, quotaExhausted: false });
    const service = makeService(prisma);

    await service.onModuleInit();
    const status = service.getQuotaBudgetStatus();

    expect(status.callsToday).toBe(5_000);
    expect(status.quotaExhausted).toBe(false);
    expect(status.bulkAllowed).toBe(true); // 5,000 < 14,000 이고 미소진 → 벌크 허용
  });

  it('재기동 복원: 당일 행 없음 → 프레시(callsToday 0·미소진)로 자연 강등', async () => {
    const prisma = makePrisma(null);
    const service = makeService(prisma);

    await service.onModuleInit();
    const status = service.getQuotaBudgetStatus();

    expect(status.callsToday).toBe(0);
    expect(status.quotaExhausted).toBe(false);
  });

  it('★실제 020 관측 → dart_quota_state 즉시 upsert(quotaExhausted:true, 스로틀 무시)', async () => {
    const prisma = makePrisma(null);
    const service = makeService(prisma);
    mock020(service);

    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });
    await Promise.resolve(); // fire-and-forget 마이크로태스크 플러시

    expect(prisma.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.upsert.mock.calls[0][0];
    expect(arg.where.day).toMatch(/^\d{8}$/); // KST 당일 키
    expect(arg.create.quotaExhausted).toBe(true);
    expect(arg.update.quotaExhausted).toBe(true);
  });

  it('prisma 미주입(@Optional): onModuleInit no-op·in-memory 020 하드스톱은 그대로 동작', async () => {
    const service = makeService(null);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    mock020(service);
    await service.getDisclosureList({ bgn_de: '20260716', end_de: '20260716' });

    expect(service.getQuotaBudgetStatus().quotaExhausted).toBe(true);
  });

  it('복원 조회 실패 → 삼키고 in-memory 기본값 유지(예외 전파 없음)', async () => {
    const prisma: QuotaMock = {
      findUnique: jest.fn().mockRejectedValue(new Error('db down')),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const service = makeService(prisma);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    const status = service.getQuotaBudgetStatus();
    expect(status.callsToday).toBe(0);
    expect(status.quotaExhausted).toBe(false);
  });
});
