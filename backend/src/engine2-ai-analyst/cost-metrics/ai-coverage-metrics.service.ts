import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 공시수신→분석생성 지연 분위수(초). 표본 0건이면 p50/p95 null. */
export interface AiCoverageLatency {
  p50Sec: number | null;
  p95Sec: number | null;
  /** 지연 표본 수 = 분석이 생성된 대상 공시 수 */
  sampleCount: number;
}

/** AI 분석 커버리지 스냅샷 — 최근 N일 대상 공시 대비 생성률·지연. */
export interface AiCoverageSnapshot {
  windowDays: number;
  from: string; // ISO8601
  to: string; // ISO8601
  /** 대상 공시 수 — 윈도 내 수신(Disclosure.createdAt) + 이벤트 추출 완료(DisclosureEvent 존재) + 라이브(isBackfill=false) */
  targetCount: number;
  /** 대상 중 DisclosureAnalysis 1건 이상 생성된 공시 수 */
  analyzedCount: number;
  /** 분석 생성률(%) 0~100 — 대상 0건이면 100(제로런 아님, 표본 없음 graceful) */
  coverageRatePct: number;
  latency: AiCoverageLatency;
}

/**
 * W10(갭분석) — AI 커버리지 계기판.
 * '언제 채워질지 보장 못 함'이라는 SLA 공백 논쟁의 측정 기반: 최근 7일
 *   1) 대상 공시 대비 분석 생성률(%)  2) 공시수신→분석생성 P50/P95 지연(초)
 * 을 기존 테이블(Disclosure·DisclosureEvent·DisclosureAnalysis)만으로 집계한다.
 *
 * 정의:
 *  - 대상 공시 = 이벤트 추출이 완료된 라이브 공시(DisclosureEvent 존재, isBackfill=false).
 *    event.extracted 큐가 AI 분석의 유일한 트리거이므로 '이벤트 있음'이 곧 분석 대상이다.
 *    isBackfill=true(과거 대량 적재)는 수신시각이 적재시각이라 지연 표본을 오염시키므로 제외.
 *  - 수신시각 = Disclosure.createdAt(DB 적재 시각), 생성시각 = 해당 rcpNo 최초 DisclosureAnalysis.createdAt.
 *
 * 안전: 순수 DB 읽기 집계 — LLM 미호출, engine5 무접촉, 쓰기 0.
 */
@Injectable()
export class AiCoverageMetricsService {
  static readonly DEFAULT_WINDOW_DAYS = 7;
  /** 조회창 상한 — 과대 스캔 방지(운영 계기판 용도로 충분). */
  static readonly MAX_WINDOW_DAYS = 90;

  constructor(private readonly prisma: PrismaService) {}

  async getCoverage(
    now: Date = new Date(),
    windowDays: number = AiCoverageMetricsService.DEFAULT_WINDOW_DAYS,
  ): Promise<AiCoverageSnapshot> {
    const days = AiCoverageMetricsService.clampWindowDays(windowDays);
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.disclosure.findMany({
      where: {
        createdAt: { gte: from, lte: now },
        isBackfill: false,
        disclosureEvent: { isNot: null },
      },
      select: {
        createdAt: true,
        // 최초 생성 분석 1건만 — 지연은 '첫 카드가 채워진 시점' 기준.
        disclosureAnalyses: {
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    const latencySecs: number[] = [];
    for (const row of rows) {
      const first = row.disclosureAnalyses[0];
      if (!first) continue;
      // 시계 오차·백필 선행 생성 등으로 음수가 나오면 0으로 클램프(지연 아님).
      latencySecs.push(Math.max(0, (first.createdAt.getTime() - row.createdAt.getTime()) / 1000));
    }

    const targetCount = rows.length;
    const analyzedCount = latencySecs.length;
    const coverageRatePct =
      targetCount === 0 ? 100 : round2((analyzedCount / targetCount) * 100);

    return {
      windowDays: days,
      from: from.toISOString(),
      to: now.toISOString(),
      targetCount,
      analyzedCount,
      coverageRatePct,
      latency: {
        p50Sec: percentile(latencySecs, 0.5),
        p95Sec: percentile(latencySecs, 0.95),
        sampleCount: analyzedCount,
      },
    };
  }

  /** 조회창 정규화 — 비수치·0 이하는 기본 7일, 상한 90일. */
  static clampWindowDays(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return AiCoverageMetricsService.DEFAULT_WINDOW_DAYS;
    return Math.min(Math.floor(days), AiCoverageMetricsService.MAX_WINDOW_DAYS);
  }
}

/** nearest-rank 분위수(초, 소수 2자리). 표본 0건이면 null. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return round2(sorted[rank - 1]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
