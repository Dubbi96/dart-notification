import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataFreshnessService } from '../cron-health/data-freshness.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { kstDayStart } from '../common/time/kst';

// [W11/W12] 공개 시스템 무결성(/status) 집계 — read-only.
//
// 목적: 외부 사용자가 '실제로 돌아가는 시스템'임을 확인할 수 있는 첫 신뢰 표면.
// ★운영 사실만 노출한다 — 성과·수익률·트랙레코드는 절대 포함하지 않는다
//   (M10 졸업 전 공개해도 오도 위험 0 원칙. 성과 공개는 졸업 게이트 조건부 별도 트랙).
// ★기존 데이터 재사용: collection-status 류 로그 테이블 + cron-health 신선도 SSOT 조회만.
//   신규 수집·외부호출·AI 없음. 매매·체결·Buy Score 경로 무접점(M10 클록 안전).

/** 서비스/파이프라인 상태 2단계 — 공개 표면은 단순하게(정상/지연). */
export type PublicStatusLevel = 'OK' | 'DEGRADED';

/** 파싱 파이프라인으로 묶어 보여줄 신선도 잡 키(공시 원문 파싱·폐루프·FAILED 복구). */
export const PIPELINE_JOB_KEYS: readonly string[] = [
  CRON_JOB_KEYS.PARSE_RETRY,
  CRON_JOB_KEYS.PIPELINE_DRAIN,
  CRON_JOB_KEYS.FAILED_EVENT_RECOVERY,
];

export interface PublicStatusSnapshot {
  generatedAt: string;
  service: {
    /** 전체 신선도 잡 중 하나라도 stale 이면 DEGRADED(일부 수집 지연). */
    status: PublicStatusLevel;
    label: string;
    uptimeSeconds: number;
  };
  disclosure: {
    /** 오늘(KST) 적재된 라이브 공시 건수(백필 제외). */
    todayCollectedCount: number;
    /** 마지막 수집 성공 시각(ISO). 없으면 null. */
    lastCollectedAt: string | null;
  };
  pipeline: {
    status: PublicStatusLevel;
    label: string;
    /** 지연 판정된 파이프라인 잡 키(운영 사실 — 비밀값 아님). */
    staleJobKeys: string[];
  };
  cron: {
    /** 집계 윈도(시간). */
    windowHours: number;
    /** 최근 24h 종료된 실행 수(RUNNING 제외). */
    totalRuns: number;
    /** 정상 실행 수(SUCCESS + SKIPPED — SKIPPED 는 윈도/휴장 정상 스킵). */
    okRuns: number;
    /** 성공률(%). 실행 0건이면 null(0% 오표기 방지). */
    successRatePct: number | null;
  };
}

// 도메인 수집 로그에서 '성공'으로 치는 상태(data-freshness.service 와 동일 기준).
const SUCCESS_STATES = ['SUCCESS', 'PARTIAL'];
// 크론 성공률에서 정상으로 치는 종료 상태 — SKIPPED 는 의도된 스킵(휴장·윈도 밖)이라 정상.
const CRON_OK_STATES = new Set(['SUCCESS', 'SKIPPED']);
const CACHE_TTL_MS = 60_000; // 60초 인메모리 캐시 — 공개 표면의 DB 부하 차단(스펙 요구).
const CRON_WINDOW_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

@Injectable()
export class StatusService {
  // 단일 인스턴스 배포 전제의 인메모리 캐시(멀티 인스턴스여도 각자 60초 캐시라 무해).
  private cache: { at: number; snapshot: PublicStatusSnapshot } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly freshness: DataFreshnessService,
  ) {}

  /** 공개 상태 스냅샷 — 60초 캐시. `now` 주입 가능(테스트 결정론). */
  async getStatus(now: Date = new Date()): Promise<PublicStatusSnapshot> {
    const nowMs = now.getTime();
    if (
      this.cache &&
      nowMs >= this.cache.at &&
      nowMs - this.cache.at < CACHE_TTL_MS
    ) {
      return this.cache.snapshot;
    }
    const snapshot = await this.build(now);
    this.cache = { at: nowMs, snapshot };
    return snapshot;
  }

  private async build(now: Date): Promise<PublicStatusSnapshot> {
    const since24h = new Date(now.getTime() - CRON_WINDOW_HOURS * MS_PER_HOUR);

    const [freshnessReport, todayCollectedCount, lastLog, cronGroups] =
      await Promise.all([
        this.freshness.getFreshness(now),
        // 오늘(KST 자정 이후) 적재된 라이브 공시 — createdAt 인덱스 range + 백필 제외.
        this.prisma.disclosure.count({
          where: { createdAt: { gte: kstDayStart(now) }, isBackfill: false },
        }),
        this.prisma.disclosureCollectionLog.findFirst({
          where: { status: { in: SUCCESS_STATES } },
          orderBy: { startedAt: 'desc' },
          select: { endedAt: true, startedAt: true },
        }),
        this.prisma.cronRunLog.groupBy({
          by: ['status'],
          where: { startedAt: { gte: since24h } },
          _count: { _all: true },
        }),
      ]);

    // 최근 24h 크론 성공률 — RUNNING(미종료)은 분모 제외.
    let totalRuns = 0;
    let okRuns = 0;
    for (const g of cronGroups) {
      if (g.status === 'RUNNING') continue;
      const count = g._count._all;
      totalRuns += count;
      if (CRON_OK_STATES.has(g.status)) okRuns += count;
    }
    const successRatePct =
      totalRuns > 0 ? Math.round((okRuns / totalRuns) * 1000) / 10 : null;

    // 파싱 파이프라인 상태 — 신선도 SSOT 에서 파이프라인 잡 subset 만 본다.
    const stalePipelineKeys = freshnessReport.jobs
      .filter((j) => PIPELINE_JOB_KEYS.includes(j.jobKey) && j.isStale)
      .map((j) => j.jobKey);
    const pipelineDegraded = stalePipelineKeys.length > 0;

    const degraded = freshnessReport.anyStale;

    return {
      generatedAt: now.toISOString(),
      service: {
        status: degraded ? 'DEGRADED' : 'OK',
        label: degraded ? '일부 수집 지연' : '정상 가동',
        uptimeSeconds: Math.floor(process.uptime()),
      },
      disclosure: {
        todayCollectedCount,
        lastCollectedAt: lastLog
          ? (lastLog.endedAt ?? lastLog.startedAt).toISOString()
          : null,
      },
      pipeline: {
        status: pipelineDegraded ? 'DEGRADED' : 'OK',
        label: pipelineDegraded ? '지연' : '정상',
        staleJobKeys: stalePipelineKeys,
      },
      cron: {
        windowHours: CRON_WINDOW_HOURS,
        totalRuns,
        okRuns,
        successRatePct,
      },
    };
  }
}
