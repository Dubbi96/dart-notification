// W5 리얼타임성 ①②⑤ — 장중 1분 공시 델타 폴링 단위 스펙.
//
// 검증 계약(레인 스펙 ⑤):
//  - 델타 조기종료: 신규 0건 시 정확히 1콜로 종료.
//  - 예산 상한 도달 시 스킵(콜 0, CronRunLog SKIPPED).
//  - 중복 저장 0: 풀스캔·델타 동시 실행(둘 다 필터를 통과한 최악 경합)에도
//    createMany(skipDuplicates)가 원자적으로 차단 + (user,공시) 중복 푸시 0.
//  - 락 분리: 풀스캔 isCollecting 락이 델타를 블로킹하지 않는다(델타 전용 락은 별도).
//  - CronRunLog: jobKey 'disclosure.delta' 로 기록(krx.daily 거짓 stale 선례 방지).

import { ExpoPushMessage } from 'expo-server-sdk';
import {
  SchedulerService,
  DISCLOSURE_DELTA_CRON,
  DISCLOSURE_DELTA_DAILY_CALL_BUDGET,
} from './scheduler.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService, DartListResponse } from '../dart-api/dart-api.service';
import { ExpoPushService } from '../../expo-push/expo-push.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { formatKstDateCompact } from '../../common/time/kst';

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

const makeItem = (rcptNo: string, over: Partial<Record<string, string>> = {}) => ({
  corp_code: 'CORP-D',
  corp_name: '델타기업',
  stock_code: '000001',
  corp_cls: 'Y',
  report_nm: '주요사항보고서',
  rcept_no: rcptNo,
  flr_nm: '델타기업',
  rcept_dt: '20260716',
  rm: '',
  ...over,
});

const listResponse = (over: Partial<DartListResponse>): DartListResponse => ({
  status: '000',
  message: '정상',
  page_no: 1,
  page_count: 100,
  total_count: 0,
  total_page: 1,
  list: [],
  ...over,
});

/**
 * 상태형 prisma 목 — disclosure 저장을 Set 으로 추적해
 * filterNewDisclosures(findMany)·createMany(skipDuplicates) 의 실제 계약을 재현한다.
 */
function makeStatefulPrisma() {
  const savedRcpNos = new Set<string>();
  return {
    savedRcpNos,
    disclosureCollectionLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    disclosure: {
      findMany: jest.fn(async (args: { where: { rcpNo: { in: string[] } } }) =>
        args.where.rcpNo.in
          .filter((r) => savedRcpNos.has(r))
          .map((rcpNo) => ({ rcpNo })),
      ),
      // skipDuplicates 계약: 이미 있는 rcpNo 는 세지 않는다(경합 시 한쪽만 count).
      createMany: jest.fn(
        async (args: { data: Array<{ rcpNo: string }>; skipDuplicates: boolean }) => {
          let count = 0;
          for (const row of args.data) {
            if (!savedRcpNos.has(row.rcpNo)) {
              savedRcpNos.add(row.rcpNo);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([{ corpCode: 'CORP-D' }]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    watchList: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

/** (userId|refId) 상태형 인박스 — 유니크 제약 멱등(created 플래그) 재현. */
function makeStatefulNotifications() {
  const inbox = new Set<string>();
  return {
    inbox,
    createNotificationIfAbsent: jest.fn(
      async (input: { userId: string; refId: string }) => {
        const key = `${input.userId}|${input.refId}`;
        if (inbox.has(key)) return { notification: { id: key }, created: false };
        inbox.add(key);
        return { notification: { id: key }, created: true };
      },
    ),
    rollbackNotification: jest.fn(async (id: string) => {
      inbox.delete(id);
    }),
  };
}

function makeExpoPushMock(valid = false) {
  return {
    sendPushNotifications: jest.fn().mockResolvedValue([]),
    isValidExpoPushToken: jest.fn().mockReturnValue(valid),
  };
}

function makeDartApiMock() {
  return {
    getAllDisclosures: jest.fn().mockResolvedValue([]),
    getDisclosureList: jest.fn().mockResolvedValue(listResponse({ status: '013' })),
    classifyDisclosureType: jest.fn().mockReturnValue('MATERIAL'),
  };
}

/** CronRunLog 기록을 캡처하는 recorder(실물 서비스 + prisma 목). */
function makeRecorder() {
  const cronPrisma = {
    cronRunLog: {
      create: jest.fn().mockResolvedValue({ id: 'run-delta-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  return { recorder: new CronRunRecorderService(cronPrisma), cronPrisma };
}

function buildService(opts: {
  prisma: ReturnType<typeof makeStatefulPrisma>;
  dartApi: ReturnType<typeof makeDartApiMock>;
  expoPush?: ReturnType<typeof makeExpoPushMock>;
  notifications?: ReturnType<typeof makeStatefulNotifications>;
  recorder?: CronRunRecorderService;
}) {
  return new SchedulerService(
    opts.prisma as unknown as PrismaService,
    opts.dartApi as unknown as DartApiService,
    (opts.expoPush ?? makeExpoPushMock()) as unknown as ExpoPushService,
    (opts.notifications ??
      makeStatefulNotifications()) as unknown as NotificationsService,
    undefined, // disclosureDocumentsService
    opts.recorder,
  );
}

/** 델타 예산 카운터를 오늘 일자 기준 지정값으로 고정. */
function fixDeltaBudget(service: SchedulerService, calls: number): void {
  const internal = service as unknown as {
    deltaDayKey: string;
    deltaCallsToday: number;
  };
  internal.deltaDayKey = formatKstDateCompact(new Date());
  internal.deltaCallsToday = calls;
}

describe('델타 폴링 — 크론식·예산 상수 (W5 ①)', () => {
  it('크론식은 장중(09~15시) 매 분에서 풀스캔 분(매 10분 정각)을 제외한다', () => {
    expect(DISCLOSURE_DELTA_CRON).toBe(
      '1-9,11-19,21-29,31-39,41-49,51-59 9-15 * * 1-5',
    );
  });

  it('델타 일일 예산은 400콜(장중 6.5h 1분 카덴스 여유분)', () => {
    expect(DISCLOSURE_DELTA_DAILY_CALL_BUDGET).toBe(400);
  });
});

describe('델타 폴링 — 조기 종료 (W5 ①·⑤)', () => {
  it('신규 0건(전건 기존) 시 정확히 1콜로 종료하고 저장·알림 경로 미진입', async () => {
    const prisma = makeStatefulPrisma();
    prisma.savedRcpNos.add('RCP-OLD1');
    prisma.savedRcpNos.add('RCP-OLD2');
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList.mockResolvedValue(
      listResponse({
        total_page: 3, // 다음 페이지가 있어도 기존 rcpNo 를 만나면 멈춘다
        list: [makeItem('RCP-OLD1'), makeItem('RCP-OLD2')],
      }),
    );
    const service = buildService({ prisma, dartApi });

    const result = await service.runDeltaCollection();

    expect(result).toEqual({ saved: 0, calls: 1 });
    expect(dartApi.getDisclosureList).toHaveBeenCalledTimes(1);
    expect(prisma.disclosure.createMany).not.toHaveBeenCalled();
    expect(prisma.watchList.findMany).not.toHaveBeenCalled(); // 알림 경로 미진입
  });

  it('오늘 공시 없음(013)도 1콜 정상 종료', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList.mockResolvedValue(listResponse({ status: '013' }));
    const service = buildService({ prisma, dartApi });

    const result = await service.runDeltaCollection();

    expect(result).toEqual({ saved: 0, calls: 1 });
    expect(prisma.disclosure.createMany).not.toHaveBeenCalled();
  });

  it('페이지 전건 신규면 다음 페이지로 진행, 기존 rcpNo 를 만난 페이지에서 종료', async () => {
    const prisma = makeStatefulPrisma();
    prisma.savedRcpNos.add('RCP-OLD');
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList
      .mockResolvedValueOnce(
        listResponse({ total_page: 3, page_no: 1, list: [makeItem('RCP-N1')] }),
      )
      .mockResolvedValueOnce(
        listResponse({
          total_page: 3,
          page_no: 2,
          list: [makeItem('RCP-N2'), makeItem('RCP-OLD')],
        }),
      );
    const service = buildService({ prisma, dartApi });

    const result = await service.runDeltaCollection();

    // 3페이지는 요청하지 않는다(2페이지에서 기존 rcpNo 조기 종료)
    expect(dartApi.getDisclosureList).toHaveBeenCalledTimes(2);
    expect(result.calls).toBe(2);
    expect(result.saved).toBe(2); // RCP-N1 + RCP-N2
    expect(prisma.savedRcpNos.has('RCP-N1')).toBe(true);
    expect(prisma.savedRcpNos.has('RCP-N2')).toBe(true);
  });

  it('델타는 라이브 list 레인으로만 호출한다(bulk 플래그 미사용 = 예약분 보호 경로)', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    const service = buildService({ prisma, dartApi });

    await service.runDeltaCollection();

    const [params, opts] = dartApi.getDisclosureList.mock.calls[0];
    expect(params).toMatchObject({
      page_no: 1,
      page_count: 100,
      sort: 'date',
      sort_mth: 'desc',
    });
    expect(params.bgn_de).toBe(params.end_de); // 오늘치만
    expect(opts).toBeUndefined(); // bulk:true 미전달 → 라이브 예약분 레인
  });
});

describe('델타 폴링 — 예산 상한·락 (W5 ①②·⑤)', () => {
  it('★일일 예산 도달 시 콜 없이 스킵하고 CronRunLog 에 SKIPPED 를 남긴다', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    const { recorder, cronPrisma } = makeRecorder();
    const service = buildService({ prisma, dartApi, recorder });
    fixDeltaBudget(service, DISCLOSURE_DELTA_DAILY_CALL_BUDGET);

    const result = await service.runDeltaCollection();

    expect(result).toEqual({ saved: 0, calls: 0, skipped: 'BUDGET' });
    expect(dartApi.getDisclosureList).not.toHaveBeenCalled();
    expect((cronPrisma.cronRunLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobKey: 'disclosure.delta' }),
      }),
    );
    expect((cronPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SKIPPED' }),
      }),
    );
  });

  it('예산 카운터는 KST 일자가 바뀌면 리셋된다(전일 소진이 오늘을 굶기지 않음)', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    const service = buildService({ prisma, dartApi });
    // 전일 키로 소진 상태 세팅 → rollDeltaBudgetDayIfNeeded 가 리셋해야 한다.
    const internal = service as unknown as {
      deltaDayKey: string;
      deltaCallsToday: number;
    };
    internal.deltaDayKey = '20200101';
    internal.deltaCallsToday = DISCLOSURE_DELTA_DAILY_CALL_BUDGET;

    const result = await service.runDeltaCollection();

    expect(result.skipped).toBeUndefined();
    expect(dartApi.getDisclosureList).toHaveBeenCalledTimes(1);
  });

  it('델타 전용 락: 이전 델타 틱 진행 중이면 스킵(LOCK)', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    let release: (v: DartListResponse) => void = () => undefined;
    dartApi.getDisclosureList.mockImplementation(
      () => new Promise<DartListResponse>((resolve) => (release = resolve)),
    );
    const service = buildService({ prisma, dartApi });

    const first = service.runDeltaCollection(); // 락 점유(fetch 대기)
    await new Promise((r) => setImmediate(r));
    const second = await service.runDeltaCollection();

    expect(second).toEqual({ saved: 0, calls: 0, skipped: 'LOCK' });
    expect(dartApi.getDisclosureList).toHaveBeenCalledTimes(1);

    release(listResponse({ status: '013' }));
    await first; // 정리
  });

  it('★락 분리: 풀스캔(isCollecting) 진행 중에도 델타는 실행된다 (W5 ②)', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    let releaseFullScan: (v: unknown[]) => void = () => undefined;
    dartApi.getAllDisclosures.mockImplementation(
      () => new Promise<unknown[]>((resolve) => (releaseFullScan = resolve)),
    );
    dartApi.getDisclosureList.mockResolvedValue(
      listResponse({ list: [makeItem('RCP-WHILE-FULL')] }),
    );
    const service = buildService({ prisma, dartApi });

    // 풀스캔이 isCollecting=true 로 블로킹 중인 상태를 만든다.
    const fullScan = service.collectByDate('20260716', '20260716', 'CRON');
    await new Promise((r) => setImmediate(r));

    // 델타는 풀스캔 락과 무관하게 fetch·저장까지 완주한다.
    const result = await service.runDeltaCollection();
    expect(result.skipped).toBeUndefined();
    expect(result.saved).toBe(1);
    expect(dartApi.getDisclosureList).toHaveBeenCalledTimes(1);

    releaseFullScan([]);
    await fullScan; // 정리
  });

  it('크론 진입점은 예외를 흡수한다(1분 틱 유지) — recorder 는 FAILED 기록', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList.mockRejectedValue(new Error('DART 장애'));
    const { recorder, cronPrisma } = makeRecorder();
    const service = buildService({ prisma, dartApi, recorder });

    await expect(service.collectDisclosuresDelta()).resolves.toEqual({
      saved: 0,
      calls: 0,
    });
    expect((cronPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'DART 장애',
        }),
      }),
    );
  });
});

describe('델타 폴링 — 풀스캔 동시 실행 dedup (W5 ②·⑤ 중복 저장 0)', () => {
  it('★최악 경합(둘 다 신규 필터 통과)에도 skipDuplicates 로 총 저장 1·중복 푸시 0', async () => {
    const prisma = makeStatefulPrisma();
    // 최악 경합 재현: 두 레인 모두 필터 시점에 '신규'로 판단하도록 findMany 를 빈 배열로 고정
    // (실서비스에서 filter→createMany 사이의 레이스 윈도) — 원자성은 createMany(skipDuplicates)
    // 와 인박스 유니크 제약이 담당함을 검증한다.
    prisma.disclosure.findMany.mockResolvedValue([]);

    const dartApi = makeDartApiMock();
    const item = makeItem('RCP-RACE');
    dartApi.getAllDisclosures.mockResolvedValue([item]); // 풀스캔 유입
    dartApi.getDisclosureList.mockResolvedValue(listResponse({ list: [item] })); // 델타 유입

    const expoPush = makeExpoPushMock(true);
    const notifications = makeStatefulNotifications();
    prisma.watchList.findMany.mockResolvedValue([
      {
        corpCode: 'CORP-D',
        user: {
          id: 'user-1',
          notificationSettings: { isEnabled: true, disclosureTypes: [], keywords: [] },
          devices: [{ deviceToken: VALID_TOKEN }],
        },
      },
    ]);
    const service = buildService({ prisma, dartApi, expoPush, notifications });

    // 두 레인 동시 실행(락은 서로 독립).
    const [fullScan, delta] = await Promise.all([
      service.collectByDate('20260716', '20260716', 'CRON'),
      service.runDeltaCollection(),
    ]);

    // ① 중복 저장 0 — 상태형 createMany(skipDuplicates 계약)가 한쪽만 count.
    expect(fullScan.saved + delta.saved).toBe(1);
    expect(prisma.savedRcpNos.size).toBe(1);
    for (const call of prisma.disclosure.createMany.mock.calls) {
      expect(call[0]).toMatchObject({ skipDuplicates: true });
    }

    // ② 중복 푸시 0 — 인박스 유니크 제약(created=false → 발송 스킵).
    expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.inbox.size).toBe(1);
    expect(notifications.inbox.has('user-1|RCP-RACE')).toBe(true);
  });

  it('순차 실행(정상 경로): 풀스캔이 먼저 저장하면 델타는 신규 0건으로 1콜 종료', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    const item = makeItem('RCP-SEQ');
    dartApi.getAllDisclosures.mockResolvedValue([item]);
    dartApi.getDisclosureList.mockResolvedValue(listResponse({ list: [item] }));
    const service = buildService({ prisma, dartApi });

    await service.collectByDate('20260716', '20260716', 'CRON');
    const delta = await service.runDeltaCollection();

    expect(delta).toEqual({ saved: 0, calls: 1 });
    expect(prisma.savedRcpNos.size).toBe(1);
  });
});

describe('델타 폴링 — CronRunLog 기록 (W5 ⑤)', () => {
  it("성공 시 jobKey 'disclosure.delta' 로 SUCCESS·저장건수를 기록한다", async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList.mockResolvedValue(
      listResponse({ list: [makeItem('RCP-LOG1'), makeItem('RCP-LOG2')] }),
    );
    const { recorder, cronPrisma } = makeRecorder();
    const service = buildService({ prisma, dartApi, recorder });

    const result = await service.runDeltaCollection();

    expect(result.saved).toBe(2);
    expect((cronPrisma.cronRunLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobKey: 'disclosure.delta',
          status: 'RUNNING',
        }),
      }),
    );
    expect((cronPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS', itemCount: 2 }),
      }),
    );
  });

  it('recorder 미주입 환경에서도 델타 본업은 수행된다(기록만 생략)', async () => {
    const prisma = makeStatefulPrisma();
    const dartApi = makeDartApiMock();
    dartApi.getDisclosureList.mockResolvedValue(
      listResponse({ list: [makeItem('RCP-NOREC')] }),
    );
    const service = buildService({ prisma, dartApi });

    const result = await service.runDeltaCollection();

    expect(result.saved).toBe(1);
  });
});
