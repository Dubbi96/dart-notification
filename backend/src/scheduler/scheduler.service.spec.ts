import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { ExpoPushService } from '../expo-push/expo-push.service';

/**
 * SchedulerService 단위 테스트
 *
 * M0 계약 §5-3B 명세 기반 — collectByDate CollectionLog 분기 + getCollectionLogs
 * 회귀 보호용 classifyDisclosureType 케이스 포함
 */

// ────────────────────────────────────────────
// 헬퍼: 가짜 DisclosureCollectionLog 레코드
// ────────────────────────────────────────────
const makeLog = (override: Partial<{ id: number; status: string }> = {}) => ({
  id: 1,
  startedAt: new Date(),
  endedAt: null,
  bgnDe: '20260101',
  endDe: '20260101',
  fetchedCount: 0,
  newCount: 0,
  skippedCount: 0,
  failedCount: 0,
  status: 'RUNNING',
  errorMessage: null,
  triggeredBy: 'MANUAL',
  ...override,
});

// ────────────────────────────────────────────
// 모의 서비스 팩토리
// ────────────────────────────────────────────
const makePrismaMock = () => ({
  disclosureCollectionLog: {
    create: jest.fn().mockResolvedValue(makeLog()),
    update: jest.fn().mockResolvedValue(makeLog()),
    findMany: jest.fn().mockResolvedValue([]),
  },
  disclosure: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  watchList: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  notificationHistory: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  userDevice: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

const makeDartApiMock = () => ({
  getAllDisclosures: jest.fn().mockResolvedValue([]),
  classifyDisclosureType: jest.fn().mockReturnValue('OTHER'),
});

const makeExpoPushMock = () => ({
  sendPushNotifications: jest.fn().mockResolvedValue(undefined),
  isValidExpoPushToken: jest.fn().mockReturnValue(false),
});

// ────────────────────────────────────────────
// 테스트 모듈 빌더
// ────────────────────────────────────────────
async function buildModule(
  prismaMock: ReturnType<typeof makePrismaMock>,
  dartApiMock: ReturnType<typeof makeDartApiMock>,
  expoPushMock: ReturnType<typeof makeExpoPushMock>,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SchedulerService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: DartApiService, useValue: dartApiMock },
      { provide: ExpoPushService, useValue: expoPushMock },
    ],
  }).compile();

  return module.get<SchedulerService>(SchedulerService);
}

// ════════════════════════════════════════════
// describe: collectByDate — CollectionLog
// ════════════════════════════════════════════
describe('collectByDate — CollectionLog', () => {
  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;
  let expoPushMock: ReturnType<typeof makeExpoPushMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    expoPushMock = makeExpoPushMock();
    service = await buildModule(prismaMock, dartApiMock, expoPushMock);
  });

  it('isCollecting=true 시 로그를 생성하지 않고 조기 반환한다', async () => {
    // isCollecting을 true 상태로 강제 설정 — 첫 번째 호출로 락 점유
    dartApiMock.getAllDisclosures.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
    );
    // 첫 번째 호출 시작 (비동기, 아직 완료 안됨)
    const firstCall = service.collectByDate('20260101', '20260101', 'CRON');

    // 즉시 두 번째 호출 (첫 번째가 isCollecting=true 상태에서 블로킹 중)
    const secondResult = await service.collectByDate('20260101', '20260101', 'MANUAL');

    expect(secondResult).toEqual({ saved: 0, message: '이전 작업 진행 중' });
    // 두 번째 호출에서는 disclosureCollectionLog.create가 호출되지 않아야 함
    // (첫 번째 호출의 create 1회만 허용)
    expect(prismaMock.disclosureCollectionLog.create).toHaveBeenCalledTimes(1);

    await firstCall; // 정리
  });

  it('수집 시작 시 RUNNING 상태 로그를 생성한다', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([]);

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(prismaMock.disclosureCollectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bgnDe: '20260601',
        endDe: '20260601',
        triggeredBy: 'MANUAL',
        status: 'RUNNING',
      }),
    });
  });

  it('빈 결과(disclosures.length=0) 시에도 SUCCESS 로그를 생성한다', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([]);

    const result = await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(result).toEqual({ saved: 0, total: 0 });
    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          fetchedCount: 0,
          newCount: 0,
        }),
      }),
    );
  });

  it('수집 완료(오류 없음) 시 SUCCESS 로그로 갱신한다', async () => {
    const fakeItem = {
      corp_code: 'CORP001',
      corp_name: '테스트기업',
      stock_code: '000001',
      corp_cls: 'Y',
      report_nm: '사업보고서',
      rcept_no: 'RCP2026001',
      flr_nm: '테스트기업',
      rcept_dt: '20260601',
      rm: '',
    };
    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    // 이미 DB에 없음 (filterNewDisclosures → findMany 빈 배열)
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });

    const result = await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(result).toEqual({ saved: 1, total: 1 });
    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          fetchedCount: 1,
          newCount: 1,
        }),
      }),
    );
  });

  it('matchAndNotify 오류 시 PARTIAL 로그로 갱신한다', async () => {
    const fakeItem = {
      corp_code: 'CORP001',
      corp_name: '테스트기업',
      stock_code: '000001',
      corp_cls: 'Y',
      report_nm: '사업보고서',
      rcept_no: 'RCP2026002',
      flr_nm: '테스트기업',
      rcept_dt: '20260601',
      rm: '',
    };
    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });
    // WatchList에 사용자가 있어야 matchAndNotify가 호출됨
    prismaMock.watchList.findMany.mockRejectedValue(new Error('DB 오류'));

    const result = await service.collectByDate('20260601', '20260601', 'MANUAL');

    // matchAndNotify 오류는 throw되지 않고 PARTIAL 처리
    expect(result).toEqual({ saved: 1, total: 1 });
    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PARTIAL',
          failedCount: 1,
        }),
      }),
    );
  });

  it('DART API 오류 시 FAILED 로그로 갱신하고 에러를 throw한다', async () => {
    dartApiMock.getAllDisclosures.mockRejectedValue(new Error('DART API 장애'));

    await expect(
      service.collectByDate('20260601', '20260601', 'MANUAL'),
    ).rejects.toThrow('DART API 장애');

    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'DART API 장애',
        }),
      }),
    );
  });

  it("triggeredBy='CRON'이 로그에 기록된다", async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([]);

    await service.collectByDate('20260601', '20260601', 'CRON');

    expect(prismaMock.disclosureCollectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ triggeredBy: 'CRON' }),
    });
  });

  it("triggeredBy='MANUAL'이 로그에 기록된다", async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([]);

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(prismaMock.disclosureCollectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ triggeredBy: 'MANUAL' }),
    });
  });

  it("triggeredBy 기본값이 'MANUAL'이다", async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([]);

    await service.collectByDate('20260601', '20260601');

    expect(prismaMock.disclosureCollectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ triggeredBy: 'MANUAL' }),
    });
  });
});

// ════════════════════════════════════════════
// describe: getCollectionLogs
// ════════════════════════════════════════════
describe('getCollectionLogs', () => {
  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await buildModule(
      prismaMock,
      makeDartApiMock(),
      makeExpoPushMock(),
    );
  });

  it('status 필터 없을 때 최근 50건을 반환하는 쿼리를 실행한다', async () => {
    prismaMock.disclosureCollectionLog.findMany.mockResolvedValue([
      makeLog({ id: 1, status: 'SUCCESS' }),
      makeLog({ id: 2, status: 'FAILED' }),
    ]);

    const result = await service.getCollectionLogs();

    expect(prismaMock.disclosureCollectionLog.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    expect(result).toHaveLength(2);
  });

  it("status='FAILED' 필터 시 FAILED 조건으로 쿼리한다", async () => {
    prismaMock.disclosureCollectionLog.findMany.mockResolvedValue([
      makeLog({ id: 5, status: 'FAILED' }),
    ]);

    const result = await service.getCollectionLogs('FAILED');

    expect(prismaMock.disclosureCollectionLog.findMany).toHaveBeenCalledWith({
      where: { status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    expect(result[0].status).toBe('FAILED');
  });
});

// ════════════════════════════════════════════
// describe: classifyDisclosureType — 기존 함수 회귀 보호
// (DartApiService에 위임하므로 실제 분류 로직은 dart-api.service.ts 에서 담당)
// 여기서는 SchedulerService → DartApiService 위임 경로 회귀 테스트
// ════════════════════════════════════════════
describe('saveDisclosures — disclosureType 분류 위임 (회귀)', () => {
  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    service = await buildModule(prismaMock, dartApiMock, makeExpoPushMock());
  });

  it('saveDisclosures 호출 시 classifyDisclosureType에 reportName을 전달한다', async () => {
    const fakeItem = {
      corp_code: 'CORP001',
      corp_name: '테스트기업',
      stock_code: '000001',
      corp_cls: 'Y',
      report_nm: '사업보고서',
      rcept_no: 'RCP2026010',
      flr_nm: '테스트기업',
      rcept_dt: '20260601',
      rm: '',
    };
    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });
    dartApiMock.classifyDisclosureType.mockReturnValue('REGULAR');

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(dartApiMock.classifyDisclosureType).toHaveBeenCalledWith('사업보고서');
  });

  it('createMany에 classifyDisclosureType 반환값이 disclosureType으로 저장된다', async () => {
    const fakeItem = {
      corp_code: 'CORP001',
      corp_name: '테스트기업',
      stock_code: '000001',
      corp_cls: 'Y',
      report_nm: '주요사항보고',
      rcept_no: 'RCP2026011',
      flr_nm: '테스트기업',
      rcept_dt: '20260601',
      rm: '',
    };
    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });
    dartApiMock.classifyDisclosureType.mockReturnValue('MATERIAL');

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(prismaMock.disclosure.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ disclosureType: 'MATERIAL' }),
        ]),
      }),
    );
  });
});
