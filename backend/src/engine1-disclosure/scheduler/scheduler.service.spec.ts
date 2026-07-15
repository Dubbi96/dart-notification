import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { ExpoPushService } from '../../expo-push/expo-push.service';
import { ExpoPushMessage } from 'expo-server-sdk';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';

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
  company: {
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

// DAR-259: 인박스 멱등 권위. 기본은 항상 신규(created=true) 발급, 롤백은 no-op.
let notifSeq = 0;
const makeNotificationsMock = () => ({
  createNotificationIfAbsent: jest.fn(async (input: { refId: string }) => ({
    notification: { id: `notif-${++notifSeq}`, refId: input.refId },
    created: true,
  })),
  rollbackNotification: jest.fn().mockResolvedValue(undefined),
});

// ────────────────────────────────────────────
// 테스트 모듈 빌더
// ────────────────────────────────────────────
async function buildModule(
  prismaMock: ReturnType<typeof makePrismaMock>,
  dartApiMock: ReturnType<typeof makeDartApiMock>,
  expoPushMock: ReturnType<typeof makeExpoPushMock>,
  notificationsMock: ReturnType<typeof makeNotificationsMock> = makeNotificationsMock(),
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SchedulerService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: DartApiService, useValue: dartApiMock },
      { provide: ExpoPushService, useValue: expoPushMock },
      { provide: NotificationsService, useValue: notificationsMock },
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

  it('기본(라이브) 수집은 isBackfill=false로 저장한다 (회귀)', async () => {
    const fakeItem = {
      corp_code: 'CORP001',
      corp_name: '테스트기업',
      stock_code: '000001',
      corp_cls: 'Y',
      report_nm: '사업보고서',
      rcept_no: 'RCP2026012',
      flr_nm: '테스트기업',
      rcept_dt: '20260601',
      rm: '',
    };
    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(prismaMock.disclosure.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ isBackfill: false }),
        ]),
      }),
    );
  });
});

// ════════════════════════════════════════════
// describe: DAR-129 백필 격리 — isBackfill 표식 + 알림 미발송
// ════════════════════════════════════════════
describe('collectByDate — DAR-129 백필 격리', () => {
  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;
  let expoPushMock: ReturnType<typeof makeExpoPushMock>;

  const fakeItem = {
    corp_code: 'CORP001',
    corp_name: '테스트기업',
    stock_code: '000001',
    corp_cls: 'Y',
    report_nm: '주요사항보고',
    rcept_no: 'RCP2026BF1',
    flr_nm: '테스트기업',
    rcept_dt: '20230601',
    rm: '',
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    expoPushMock = makeExpoPushMock();
    service = await buildModule(prismaMock, dartApiMock, expoPushMock);

    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });
  });

  it('백필 모드는 저장 행에 isBackfill=true 표식을 남긴다', async () => {
    await service.collectByDate('20230601', '20230601', 'MANUAL', {
      isBackfill: true,
    });

    expect(prismaMock.disclosure.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ isBackfill: true }),
        ]),
      }),
    );
  });

  it('★백필 모드는 사용자 알림을 발송하지 않는다 (matchAndNotify 미실행)', async () => {
    // 관심 기업 사용자가 존재해도(=라이브였다면 알림 대상) 백필은 매칭 자체를 건너뛴다.
    prismaMock.watchList.findMany.mockResolvedValue([
      {
        corpCode: 'CORP001',
        user: { id: 'u1', notificationSettings: null, devices: [] },
      },
    ]);

    const result = await service.collectByDate('20230601', '20230601', 'MANUAL', {
      isBackfill: true,
    });

    // matchAndNotify의 첫 쿼리(watchList.findMany)가 호출되지 않아야 함 = 알림 경로 미진입
    expect(prismaMock.watchList.findMany).not.toHaveBeenCalled();
    // 푸시·알림 히스토리 생성 0건
    expect(expoPushMock.sendPushNotifications).not.toHaveBeenCalled();
    expect(prismaMock.notificationHistory.create).not.toHaveBeenCalled();
    // 저장 자체는 성공
    expect(result.saved).toBe(1);
  });

  it('라이브(비백필) 모드는 알림 매칭 경로에 진입한다 (대조군)', async () => {
    prismaMock.watchList.findMany.mockResolvedValue([]);

    await service.collectByDate('20260601', '20260601', 'MANUAL');

    expect(prismaMock.watchList.findMany).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════
// describe: cleanupExpiredTokens — 실패 관측성 (DAR-232)
// ════════════════════════════════════════════
describe('cleanupExpiredTokens — CronRunRecorder 관측성 (DAR-232)', () => {
  // CronRunLog create/update 를 캡처하는 recorder 전용 prisma 목.
  function makeRecorderPrisma() {
    return {
      cronRunLog: {
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }

  function buildWithRecorder(
    prismaMock: ReturnType<typeof makePrismaMock>,
    recorderPrisma: PrismaService,
  ) {
    const recorder = new CronRunRecorderService(recorderPrisma);
    const service = new SchedulerService(
      prismaMock as unknown as PrismaService,
      makeDartApiMock() as unknown as DartApiService,
      makeExpoPushMock() as unknown as ExpoPushService,
      makeNotificationsMock() as unknown as NotificationsService,
      undefined, // disclosureDocumentsService
      recorder,
    );
    return { service, recorder, recorderPrisma };
  }

  it('성공 시 CronRunLog 에 SUCCESS·삭제건수를 기록하고 결과를 반환한다', async () => {
    const prismaMock = makePrismaMock();
    prismaMock.notificationHistory.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.userDevice.deleteMany.mockResolvedValue({ count: 2 });
    const recorderPrisma = makeRecorderPrisma();
    const { service } = buildWithRecorder(prismaMock, recorderPrisma);

    const result = await service.cleanupExpiredTokens();

    expect(result).toEqual({ notifications: 3, devices: 2 });
    // RUNNING 생성 → cleanup.daily 키
    expect((recorderPrisma.cronRunLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobKey: 'cleanup.daily', status: 'RUNNING' }),
      }),
    );
    // 종료 기록: SUCCESS·itemCount=5(3+2)
    expect((recorderPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS', itemCount: 5 }),
      }),
    );
  });

  it('정리 실패 시 CronRunLog 에 FAILED 를 남기고 cron 은 throw 없이 흡수한다', async () => {
    const prismaMock = makePrismaMock();
    prismaMock.notificationHistory.deleteMany.mockRejectedValue(new Error('db down'));
    const recorderPrisma = makeRecorderPrisma();
    const { service } = buildWithRecorder(prismaMock, recorderPrisma);

    // 스케줄 유지: 예외 흡수 후 0건 반환.
    const result = await service.cleanupExpiredTokens();
    expect(result).toEqual({ notifications: 0, devices: 0 });

    // 실패가 조용히 삼켜지지 않고 FAILED·errorMessage 로 표면화됨.
    expect((recorderPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'db down',
        }),
      }),
    );
  });

  it('recorder 미주입 환경에서도 정리 본업은 수행된다(기록만 생략)', async () => {
    const prismaMock = makePrismaMock();
    prismaMock.notificationHistory.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.userDevice.deleteMany.mockResolvedValue({ count: 0 });
    const service = new SchedulerService(
      prismaMock as unknown as PrismaService,
      makeDartApiMock() as unknown as DartApiService,
      makeExpoPushMock() as unknown as ExpoPushService,
      makeNotificationsMock() as unknown as NotificationsService,
      // disclosureDocumentsService, cronRunRecorder 모두 미주입
    );

    const result = await service.cleanupExpiredTokens();

    expect(result).toEqual({ notifications: 1, devices: 0 });
    expect(prismaMock.notificationHistory.deleteMany).toHaveBeenCalled();
    expect(prismaMock.userDevice.deleteMany).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════
// describe: DAR-233 파싱 큐 등록 실패 → 수집로그 PARTIAL
// (setImmediate fire-and-forget 제거 → await 경로 + 실패 시 부분실패 노출)
// ════════════════════════════════════════════
describe('collectByDate — DAR-233 파싱 큐 enqueue 신뢰성', () => {
  const fakeItem = {
    corp_code: 'CORP001',
    corp_name: '테스트기업',
    stock_code: '000001',
    corp_cls: 'Y',
    report_nm: '주요사항보고',
    rcept_no: 'RCP2026D233',
    flr_nm: '테스트기업',
    rcept_dt: '20260601',
    rm: '',
  };

  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;
  let docsMock: { enqueueParsing: jest.Mock };

  async function buildWithDocs() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: DartApiService, useValue: dartApiMock },
        { provide: ExpoPushService, useValue: makeExpoPushMock() },
        { provide: NotificationsService, useValue: makeNotificationsMock() },
        { provide: DisclosureDocumentsService, useValue: docsMock },
      ],
    }).compile();
    return module.get<SchedulerService>(SchedulerService);
  }

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    docsMock = { enqueueParsing: jest.fn().mockResolvedValue(undefined) };

    dartApiMock.getAllDisclosures.mockResolvedValue([fakeItem]);
    prismaMock.disclosure.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });
    service = await buildWithDocs();
  });

  it('파싱 큐 등록은 await 경로로 신규 rcpNo와 함께 호출된다 (정상)', async () => {
    const result = await service.collectByDate('20260601', '20260601', 'CRON');

    // setImmediate 타이밍에 의존하지 않고 동기적으로 호출이 끝나 있어야 한다
    expect(docsMock.enqueueParsing).toHaveBeenCalledWith(['RCP2026D233']);
    expect(result).toEqual({ saved: 1, total: 1 });
  });

  it('파싱 큐 등록 성공 시 SUCCESS·failedCount=0으로 마감한다 (대조군)', async () => {
    await service.collectByDate('20260601', '20260601', 'CRON');

    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          newCount: 1,
          failedCount: 0,
        }),
      }),
    );
  });

  it('★파싱 큐 등록 실패 시 PARTIAL·failedCount로 부분실패가 수집상태에 드러난다', async () => {
    docsMock.enqueueParsing.mockRejectedValue(new Error('큐 등록 실패'));

    // 큐 실패는 throw되지 않아야 한다(수집 자체는 성공 마감, 상태만 PARTIAL)
    const result = await service.collectByDate('20260601', '20260601', 'CRON');

    expect(result).toEqual({ saved: 1, total: 1 });
    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PARTIAL',
          newCount: 1,
          failedCount: 1, // 신규 저장 1건이 파싱 미등록 → 드레인 복구 대상
        }),
      }),
    );
  });

  it('파싱 큐 실패 + 알림 실패가 함께 failedCount에 합산된다', async () => {
    docsMock.enqueueParsing.mockRejectedValue(new Error('큐 등록 실패'));
    prismaMock.watchList.findMany.mockRejectedValue(new Error('DB 오류'));

    await service.collectByDate('20260601', '20260601', 'CRON');

    expect(prismaMock.disclosureCollectionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PARTIAL',
          // 파싱 실패 1 + 알림 실패 1 = 2 (부분실패 합산)
          failedCount: 2,
        }),
      }),
    );
  });

  it('백필 모드에서도 파싱 큐 등록은 수행된다 (회귀: 분석 baseline)', async () => {
    await service.collectByDate('20230601', '20230601', 'MANUAL', {
      isBackfill: true,
    });

    expect(docsMock.enqueueParsing).toHaveBeenCalledWith(['RCP2026D233']);
  });
});

// ════════════════════════════════════════════
// describe: matchAndNotify — DAR-259 푸시 멱등·재시도 게이트
//
// 종전엔 인박스 행을 개별 커밋한 뒤 루프 '밖'에서 1회 일괄 발송 → cron 직접 호출(BullMQ
// 재시도 부재)에서 sendPushNotifications 가 실패하면 인박스만 남고 다음 폴링은 멱등
// 가드로 스킵 → 핵심 공시 알림 영구 미발송. 이제 인박스 생성과 발송을 (user,공시) 단위로
// 묶어, 발송 실패분은 인박스 롤백 → 재폴링서 재발송, 성공분은 created=false 로 재발송
// 스킵(중복 0)을 보장한다.
// ════════════════════════════════════════════
describe('matchAndNotify — DAR-259 푸시 멱등·재시도 게이트', () => {
  const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

  const makeItem = (rcptNo: string) => ({
    corp_code: 'CORP-X',
    corp_name: '테스트기업',
    stock_code: '000001',
    corp_cls: 'Y',
    report_nm: '주요사항보고',
    rcept_no: rcptNo,
    flr_nm: '테스트기업',
    rcept_dt: '20260614',
    rm: '',
  });

  // (userId|refId) 단위로 인박스 존재를 추적하는 상태형 멱등 권위 페이크.
  // 실제 NotificationsService.createNotificationIfAbsent/rollbackNotification 의 계약
  // (unique 키 멱등 + 롤백 시 재생성 가능)을 결정론적으로 재현한다.
  function makeStatefulNotifications() {
    const inbox = new Set<string>();
    return {
      inbox,
      createNotificationIfAbsent: jest.fn(
        async (input: { userId: string; refId: string }) => {
          const key = `${input.userId}|${input.refId}`;
          if (inbox.has(key)) {
            return { notification: { id: key }, created: false };
          }
          inbox.add(key);
          return { notification: { id: key }, created: true };
        },
      ),
      rollbackNotification: jest.fn(async (id: string) => {
        inbox.delete(id);
      }),
    };
  }

  const rcpOf = (messages: ExpoPushMessage[]) =>
    (messages[0]?.data as { disclosureRcpNo?: string })?.disclosureRcpNo;

  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;
  let expoPushMock: ReturnType<typeof makeExpoPushMock>;
  let notif: ReturnType<typeof makeStatefulNotifications>;
  let service: SchedulerService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    expoPushMock = makeExpoPushMock();
    expoPushMock.isValidExpoPushToken.mockReturnValue(true);
    notif = makeStatefulNotifications();

    prismaMock.watchList.findMany.mockResolvedValue([
      {
        corpCode: 'CORP-X',
        user: {
          id: 'user-1',
          notificationSettings: { isEnabled: true, disclosureTypes: [], keywords: [] },
          devices: [{ deviceToken: VALID_TOKEN }],
        },
      },
    ]);

    service = await buildModule(
      prismaMock,
      dartApiMock,
      expoPushMock,
      notif as unknown as ReturnType<typeof makeNotificationsMock>,
    );
  });

  // 비공개 matchAndNotify 직접 구동(수집 파이프라인 의존 없이 알림 경로만 검증)
  const run = (items: ReturnType<typeof makeItem>[]) =>
    (
      service as unknown as { matchAndNotify: (i: unknown[]) => Promise<void> }
    ).matchAndNotify(items);

  it('발송 실패분은 인박스를 롤백하고 성공분은 인박스를 유지한다 (1차 폴링)', async () => {
    expoPushMock.sendPushNotifications.mockImplementation(
      async (messages: ExpoPushMessage[]) => {
        if (rcpOf(messages) === 'RCP-B') throw new Error('expo 503');
        return [];
      },
    );

    await run([makeItem('RCP-A'), makeItem('RCP-B')]);

    // 두 건 모두 신규 인박스 발급 시도
    expect(notif.createNotificationIfAbsent).toHaveBeenCalledTimes(2);
    // 실패한 RCP-B 만 롤백, 성공한 RCP-A 는 유지
    expect(notif.rollbackNotification).toHaveBeenCalledTimes(1);
    expect(notif.rollbackNotification).toHaveBeenCalledWith('user-1|RCP-B');
    expect(notif.inbox.has('user-1|RCP-A')).toBe(true);
    expect(notif.inbox.has('user-1|RCP-B')).toBe(false);
  });

  it('★재폴링: 성공분(RCP-A) 중복 발송 0 · 미발송분(RCP-B) 재발송 (DoD)', async () => {
    let failB = true;
    expoPushMock.sendPushNotifications.mockImplementation(
      async (messages: ExpoPushMessage[]) => {
        if (rcpOf(messages) === 'RCP-B' && failB) throw new Error('expo 503');
        return [];
      },
    );

    // 1차 폴링 — B 실패 → 인박스 롤백
    await run([makeItem('RCP-A'), makeItem('RCP-B')]);
    expoPushMock.sendPushNotifications.mockClear();
    failB = false; // 2차에는 B 정상 발송

    // 2차 폴링 — 동일 두 공시 재유입(멱등 폴링)
    await run([makeItem('RCP-A'), makeItem('RCP-B')]);

    const sentRcps = expoPushMock.sendPushNotifications.mock.calls.map((c) =>
      rcpOf(c[0] as ExpoPushMessage[]),
    );
    // RCP-A 는 이미 통지(인박스 존재) → 재발송 0(중복 0)
    expect(sentRcps).not.toContain('RCP-A');
    // RCP-B 는 1차 롤백분 → 정확히 1회 재발송
    expect(sentRcps).toEqual(['RCP-B']);
    expect(notif.inbox.has('user-1|RCP-B')).toBe(true);
  });

  it('이미 통지된 공시는 created=false → 푸시 미발송·롤백 없음 (중복 0)', async () => {
    await run([makeItem('RCP-A')]); // 1차 정상 발송
    expoPushMock.sendPushNotifications.mockClear();
    notif.rollbackNotification.mockClear();

    await run([makeItem('RCP-A')]); // 2차 동일 공시 재유입

    expect(expoPushMock.sendPushNotifications).not.toHaveBeenCalled();
    expect(notif.rollbackNotification).not.toHaveBeenCalled();
  });

  it('회귀: 발송 전건 성공 시 롤백 없이 인박스 전건 유지', async () => {
    await run([makeItem('RCP-A'), makeItem('RCP-B')]);

    expect(notif.rollbackNotification).not.toHaveBeenCalled();
    expect(notif.inbox.size).toBe(2);
    expect(expoPushMock.sendPushNotifications).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════
// describe: saveDisclosures — Company FK 가드 (2026-07-15 prod 장애 회귀)
// 미동기 corpCode 1건이 createMany 배치 전체를 P2003으로 죽여
// 수집이 통째로 FAILED 반복되던 결함 — 누락 기업 자동 생성으로 배치를 살린다.
// ════════════════════════════════════════════
describe('saveDisclosures — Company FK 가드 (미동기 기업 자동 생성)', () => {
  let service: SchedulerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let dartApiMock: ReturnType<typeof makeDartApiMock>;

  const makeItem = (over: Partial<Record<string, string>> = {}) => ({
    corp_code: 'NEWCORP1',
    corp_name: '신규상장사',
    stock_code: '123456',
    corp_cls: 'Y',
    report_nm: '단일판매ㆍ공급계약체결',
    rcept_no: 'RCP2026FK1',
    flr_nm: '신규상장사',
    rcept_dt: '20260715',
    rm: '',
    ...over,
  });

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    dartApiMock = makeDartApiMock();
    service = await buildModule(prismaMock, dartApiMock, makeExpoPushMock());
  });

  it('Company에 없는 corpCode는 DART 목록 메타로 자동 생성 후 공시를 저장한다', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([makeItem()]);
    prismaMock.company.findMany.mockResolvedValue([]); // 미동기
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });

    await service.collectByDate('20260715', '20260715', 'MANUAL');

    expect(prismaMock.company.createMany).toHaveBeenCalledWith({
      data: [
        {
          corpCode: 'NEWCORP1',
          corpName: '신규상장사',
          stockCode: '123456',
          market: 'KOSPI',
        },
      ],
      skipDuplicates: true,
    });
    expect(prismaMock.disclosure.createMany).toHaveBeenCalled();
  });

  it('전부 알려진 기업이면 Company 생성을 건너뛴다', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([makeItem()]);
    prismaMock.company.findMany.mockResolvedValue([{ corpCode: 'NEWCORP1' }]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });

    await service.collectByDate('20260715', '20260715', 'MANUAL');

    expect(prismaMock.company.createMany).not.toHaveBeenCalled();
  });

  it('corp_cls K는 KOSDAQ, 그 외(N/E)는 null 시장으로 매핑하고 같은 기업 중복은 1건만 만든다', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([
      makeItem({ corp_code: 'KOSDAQ01', corp_cls: 'K', rcept_no: 'RCP-K1' }),
      makeItem({ corp_code: 'KOSDAQ01', corp_cls: 'K', rcept_no: 'RCP-K2' }),
      makeItem({ corp_code: 'KONEX001', corp_cls: 'N', rcept_no: 'RCP-N1' }),
    ]);
    prismaMock.company.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 3 });

    await service.collectByDate('20260715', '20260715', 'MANUAL');

    const args = prismaMock.company.createMany.mock.calls[0][0];
    expect(args.data).toHaveLength(2); // 중복 corpCode 1건으로 축약
    expect(args.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ corpCode: 'KOSDAQ01', market: 'KOSDAQ' }),
        expect.objectContaining({ corpCode: 'KONEX001', market: null }),
      ]),
    );
  });

  it('공백 stock_code는 null로 저장한다 (DART가 비상장 기업에 공백 문자열을 보냄)', async () => {
    dartApiMock.getAllDisclosures.mockResolvedValue([
      makeItem({ corp_code: 'UNLISTED', stock_code: '  ', corp_cls: 'E' }),
    ]);
    prismaMock.company.findMany.mockResolvedValue([]);
    prismaMock.disclosure.createMany.mockResolvedValue({ count: 1 });

    await service.collectByDate('20260715', '20260715', 'MANUAL');

    expect(prismaMock.company.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ corpCode: 'UNLISTED', stockCode: null, market: null }),
    );
  });
});
