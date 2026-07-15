// W5 리얼타임성 ③ — 공시 알림 '감지→푸시' 지연 일별 p50/p95 집계 단위 스펙.
//
// 핵심 계약:
//  - 지표 정의 정직성: DART 접수시각 부재 → '감지(Disclosure.createdAt)→푸시(sentAt)'만 측정,
//    정의 문자열·필드명(detectToPush*)에 반영.
//  - KST 일자 버킷(UTC 컨테이너에서도 KST 벽시계 기준) + nearest-rank p50/p95.
//  - 시계 역전(음수)·고아(disclosure null) 표본은 지표 오염 방지를 위해 제외.

import {
  NotificationLatencyService,
  percentileNearestRank,
  DETECT_TO_PUSH_DEFINITION,
} from './notification-latency.service';
import { PrismaService } from '../prisma/prisma.service';

describe('percentileNearestRank (순수 함수)', () => {
  it('빈 표본은 null', () => {
    expect(percentileNearestRank([], 50)).toBeNull();
    expect(percentileNearestRank([], 95)).toBeNull();
  });

  it('단일 표본은 모든 백분위에서 그 값', () => {
    expect(percentileNearestRank([42], 50)).toBe(42);
    expect(percentileNearestRank([42], 95)).toBe(42);
  });

  it('nearest-rank: 10개 표본의 p50=5번째, p95=10번째 값', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileNearestRank(sorted, 50)).toBe(50); // ceil(0.5×10)=5번째
    expect(percentileNearestRank(sorted, 95)).toBe(100); // ceil(0.95×10)=10번째
  });

  it('20개 표본의 p95=19번째 값(최댓값 아님)', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentileNearestRank(sorted, 95)).toBe(1900); // ceil(0.95×20)=19번째
  });
});

describe('NotificationLatencyService.getDisclosureLatencyDaily', () => {
  // KST(UTC+9) 벽시계 기준 헬퍼 — 컨테이너 TZ 와 무관하게 결정론.
  const kst = (iso: string) => new Date(`${iso}+09:00`);

  function build(rows: Array<{ sentAt: Date; disclosure: { createdAt: Date } | null }>) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = {
      notificationHistory: { findMany },
    } as unknown as PrismaService;
    return { service: new NotificationLatencyService(prisma), findMany };
  }

  it('감지→푸시 지연을 KST 일자별로 묶어 count·p50·p95·max 를 집계한다', async () => {
    const { service } = build([
      // 7/15(KST): 30s, 60s, 90s
      { sentAt: kst('2026-07-15T09:10:30'), disclosure: { createdAt: kst('2026-07-15T09:10:00') } },
      { sentAt: kst('2026-07-15T10:01:00'), disclosure: { createdAt: kst('2026-07-15T10:00:00') } },
      { sentAt: kst('2026-07-15T11:01:30'), disclosure: { createdAt: kst('2026-07-15T11:00:00') } },
      // 7/16(KST): 10s
      { sentAt: kst('2026-07-16T09:00:10'), disclosure: { createdAt: kst('2026-07-16T09:00:00') } },
    ]);

    const report = await service.getDisclosureLatencyDaily(7);

    expect(report.metric).toBe('disclosure-detect-to-push');
    expect(report.daily).toHaveLength(2);
    // 최신 일자 우선 정렬
    expect(report.daily[0]).toEqual({
      kstDate: '2026-07-16',
      count: 1,
      detectToPushP50Ms: 10_000,
      detectToPushP95Ms: 10_000,
      detectToPushMaxMs: 10_000,
    });
    expect(report.daily[1]).toEqual({
      kstDate: '2026-07-15',
      count: 3,
      detectToPushP50Ms: 60_000, // ceil(0.5×3)=2번째
      detectToPushP95Ms: 90_000, // ceil(0.95×3)=3번째
      detectToPushMaxMs: 90_000,
    });
  });

  it('★KST 일자 버킷: UTC 늦저녁 발송(=KST 익일 새벽)은 KST 익일로 묶인다', async () => {
    const { service } = build([
      // UTC 2026-07-14T16:30:00Z = KST 2026-07-15 01:30
      {
        sentAt: new Date('2026-07-14T16:30:00Z'),
        disclosure: { createdAt: new Date('2026-07-14T16:29:00Z') },
      },
    ]);

    const report = await service.getDisclosureLatencyDaily(7);

    expect(report.daily).toHaveLength(1);
    expect(report.daily[0].kstDate).toBe('2026-07-15');
  });

  it('시계 역전(음수 지연)·고아(disclosure null) 표본은 제외한다', async () => {
    const { service } = build([
      { sentAt: kst('2026-07-15T09:00:00'), disclosure: { createdAt: kst('2026-07-15T09:05:00') } }, // 음수
      { sentAt: kst('2026-07-15T09:10:00'), disclosure: null }, // 고아
      { sentAt: kst('2026-07-15T09:20:20'), disclosure: { createdAt: kst('2026-07-15T09:20:00') } }, // 정상 20s
    ]);

    const report = await service.getDisclosureLatencyDaily(7);

    expect(report.daily).toHaveLength(1);
    expect(report.daily[0].count).toBe(1);
    expect(report.daily[0].detectToPushP50Ms).toBe(20_000);
  });

  it('표본이 전혀 없으면 daily 는 빈 배열(행 생성 없음)', async () => {
    const { service } = build([]);
    const report = await service.getDisclosureLatencyDaily(7);
    expect(report.daily).toEqual([]);
  });

  it('쿼리는 DISCLOSURE 타입·rcpNo 존재·윈도 시작 이후로 한정한다', async () => {
    const { service, findMany } = build([]);

    await service.getDisclosureLatencyDaily(7);

    const args = findMany.mock.calls[0][0];
    expect(args.where.type).toBe('DISCLOSURE');
    expect(args.where.disclosureRcpNo).toEqual({ not: null });
    expect(args.where.sentAt.gte).toBeInstanceOf(Date);
    expect(args.select).toEqual({
      sentAt: true,
      disclosure: { select: { createdAt: true } },
    });
  });

  it('윈도는 1~30일로 클램프된다(기본 7)', async () => {
    const { service } = build([]);

    expect((await service.getDisclosureLatencyDaily(99)).windowDays).toBe(30);
    expect((await service.getDisclosureLatencyDaily(-5)).windowDays).toBe(1);
    expect((await service.getDisclosureLatencyDaily()).windowDays).toBe(7);
  });

  it('★정의 정직성: 리포트 정의가 감지→푸시 구간과 접수시각 부재를 명시한다', async () => {
    const { service } = build([]);
    const report = await service.getDisclosureLatencyDaily();

    expect(report.definition).toBe(DETECT_TO_PUSH_DEFINITION);
    expect(report.definition).toContain('감지');
    expect(report.definition).toContain('푸시');
    expect(report.definition).toContain('접수');
  });
});
