import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatKstDateDashed } from '../common/time/kst';
import { OpsMetricsService } from './ops-metrics.service';
import {
  CronErrorSummary,
  OpsDailyReport,
  OpsDailyReportSeverity,
  TrackFillSummary,
  TrackPnlSummary,
} from './ops-daily-report.types';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** styleTag 미부여 행의 집계 버킷 라벨(ops-metrics 슬리피지와 동일 규약). */
const UNTAGGED_TRACK = '(untagged)';

/** 분봉 단타 트랙 식별 태그(IntradayScalpTrade.styleTag SSOT 기본값). */
const INTRADAY_SCALP_TAG = 'intraday-scalp';

/** 부호 포함 원화 표기(결정론 — 로케일 무관 수동 3자리 구분). */
function formatSignedKrw(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}원`;
}

/** 소수 digits 반올림 — null 보존. */
function roundOrNull(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * OpsDailyReportService (DAR-477, 견고화 W0·P05) — 장마감 후 일일 운영 요약 생성.
 *
 * OpsMetricsService.getMetrics(DAR-111) 집계를 재사용하고(슬리피지·freshness·신호·AI비용),
 * 여기에 일일 관점의 트랙별 손익·최근 체결·크론 오류율을 더해 하나의 다이제스트로 만든다.
 * 발송(OPS_ALERT 채널)은 스케줄러가 담당한다.
 *
 * ★read-only 관측 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
 *   집계 실패는 graceful(하위 항목 null/빈값) — 리포트 골격은 항상 반환한다.
 *   ★실주문/Kill Switch 무직결 — M10 클록 보호(측정 트랙 매매 행동 무변경).
 */
@Injectable()
export class OpsDailyReportService {
  private readonly logger = new Logger(OpsDailyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opsMetrics: OpsMetricsService,
  ) {}

  /** 일일 리포트 스냅샷. `now` 주입 가능(테스트 결정론). */
  async buildReport(now: Date = new Date()): Promise<OpsDailyReport> {
    const since24h = new Date(now.getTime() - MS_PER_DAY);

    const [metrics, pnl, fills, cron] = await Promise.all([
      this.opsMetrics.getMetrics(now),
      this.buildPnlByTrack(),
      this.buildFills(since24h),
      this.buildCronErrors(since24h),
    ]);

    // 신선도 정체 목록은 getMetrics 의 freshness 요약에서 재사용(중복 조회 방지).
    cron.staleJobs = metrics.collection?.staleJobs ?? [];

    const severity: OpsDailyReportSeverity =
      cron.failedRuns > 0 || cron.staleJobs.length > 0 ? 'WARNING' : 'INFO';

    const reportDateKst = formatKstDateDashed(now);
    const report: OpsDailyReport = {
      generatedAt: now.toISOString(),
      reportDateKst,
      severity,
      pnl,
      fills,
      cron,
      slippage: metrics.slippage,
      signals24h: metrics.signals.last24h,
      aiCostUsdTotal: metrics.aiUsage.totalCostUsd,
      body: '', // 아래에서 채움(구조화 필드 확정 후 렌더).
    };
    report.body = this.renderBody(report);
    return report;
  }

  /**
   * 트랙별 손익 — Position(포트폴리오 단위: 시스템 모의·전략 4종·철학 4종) +
   * IntradayScalpTrade(분봉 단타). CLOSED 포지션의 unrealizedPnl 은 청산 시점 고정 실현손익
   * (strategy-forward equity 산식과 동일 관점). 집계 실패 시 빈 목록(graceful).
   */
  private async buildPnlByTrack(): Promise<OpsDailyReport['pnl']> {
    try {
      const [posGroups, scalpClosed, scalpOpen] = await Promise.all([
        this.prisma.position.groupBy({
          by: ['portfolioId', 'status'],
          _sum: { unrealizedPnl: true },
          _count: { _all: true },
        }),
        this.prisma.intradayScalpTrade.groupBy({
          by: ['styleTag'],
          where: { status: 'CLOSED' },
          _sum: { netPnl: true },
          _count: { _all: true },
        }),
        this.prisma.intradayScalpTrade.groupBy({
          by: ['styleTag'],
          where: { status: 'OPEN' },
          _count: { _all: true },
        }),
      ]);

      // 포트폴리오 라벨 조회(포지션 보유 포트폴리오만).
      const portfolioIds = [...new Set(posGroups.map((g) => g.portfolioId))];
      const portfolios =
        portfolioIds.length > 0
          ? await this.prisma.portfolio.findMany({
              where: { id: { in: portfolioIds } },
              select: { id: true, name: true },
            })
          : [];
      const nameById = new Map(portfolios.map((p) => [p.id, p.name]));

      const trackMap = new Map<string, TrackPnlSummary>();
      const trackFor = (key: string, label: string): TrackPnlSummary => {
        let t = trackMap.get(key);
        if (!t) {
          t = {
            trackKey: key,
            label,
            realizedPnlKrw: 0,
            unrealizedPnlKrw: 0,
            openPositions: 0,
            closedPositions: 0,
          };
          trackMap.set(key, t);
        }
        return t;
      };

      for (const g of posGroups) {
        const t = trackFor(
          g.portfolioId,
          nameById.get(g.portfolioId) ?? g.portfolioId,
        );
        const sum = g._sum.unrealizedPnl ?? 0;
        const count = g._count._all;
        if (g.status === 'OPEN') {
          t.unrealizedPnlKrw += sum;
          t.openPositions += count;
        } else if (g.status === 'CLOSED') {
          t.realizedPnlKrw += sum;
          t.closedPositions += count;
        }
      }

      // 분봉 단타 — netPnl 이 청산 시 손익 SSOT(Position 미사용 트랙).
      const scalpOpenByTag = new Map(
        scalpOpen.map((g) => [g.styleTag ?? INTRADAY_SCALP_TAG, g._count._all]),
      );
      for (const g of scalpClosed) {
        const tag = g.styleTag ?? INTRADAY_SCALP_TAG;
        const t = trackFor(tag, tag);
        t.realizedPnlKrw += Number(g._sum.netPnl ?? 0);
        t.closedPositions += g._count._all;
      }
      for (const [tag, openCount] of scalpOpenByTag) {
        trackFor(tag, tag).openPositions += openCount;
      }

      const byTrack = [...trackMap.values()]
        .map((t) => ({
          ...t,
          realizedPnlKrw: roundOrNull(t.realizedPnlKrw, 0) ?? 0,
          unrealizedPnlKrw: roundOrNull(t.unrealizedPnlKrw, 0) ?? 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      return {
        byTrack,
        totalRealizedPnlKrw: byTrack.reduce((s, t) => s + t.realizedPnlKrw, 0),
        totalUnrealizedPnlKrw: byTrack.reduce(
          (s, t) => s + t.unrealizedPnlKrw,
          0,
        ),
      };
    } catch (err) {
      this.logger.warn(
        `트랙 손익 집계 실패(graceful, 빈 목록): ${(err as Error).message}`,
      );
      return { byTrack: [], totalRealizedPnlKrw: 0, totalUnrealizedPnlKrw: 0 };
    }
  }

  /**
   * 최근 24h 체결 — PaperTrade(체결분: filledShares>0·filledAt) + IntradayScalpTrade(청산: exitTs).
   * styleTag 트랙별 합산. 집계 실패 시 빈 목록(graceful).
   */
  private async buildFills(since: Date): Promise<OpsDailyReport['fills']> {
    try {
      const [paperFills, scalpFills] = await Promise.all([
        this.prisma.paperTrade.groupBy({
          by: ['styleTag'],
          where: { filledShares: { gt: 0 }, filledAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.intradayScalpTrade.groupBy({
          by: ['styleTag'],
          where: { status: 'CLOSED', exitTs: { gte: since } },
          _count: { _all: true },
        }),
      ]);

      const byTag = new Map<string, number>();
      const add = (tag: string | null, n: number): void => {
        const key = tag ?? UNTAGGED_TRACK;
        byTag.set(key, (byTag.get(key) ?? 0) + n);
      };
      for (const g of paperFills) add(g.styleTag, g._count._all);
      for (const g of scalpFills) add(g.styleTag, g._count._all);

      const byTrack: TrackFillSummary[] = [...byTag.entries()]
        .map(([styleTag, fills]) => ({ styleTag, fills }))
        .sort((a, b) => a.styleTag.localeCompare(b.styleTag));

      return {
        windowHours: 24,
        total: byTrack.reduce((s, t) => s + t.fills, 0),
        byTrack,
      };
    } catch (err) {
      this.logger.warn(
        `체결 집계 실패(graceful, 빈 목록): ${(err as Error).message}`,
      );
      return { windowHours: 24, total: 0, byTrack: [] };
    }
  }

  /**
   * 최근 24h 크론 실행 실패·오류율 — CronRunLog(DAR-110 실행 헬스 SSOT) 집계.
   * staleJobs 는 호출부에서 freshness 요약으로 채운다(중복 조회 방지). 집계 실패 시 0(graceful).
   */
  private async buildCronErrors(since: Date): Promise<CronErrorSummary> {
    const base: CronErrorSummary = {
      windowHours: 24,
      totalRuns: 0,
      failedRuns: 0,
      errorRatePct: null,
      failedJobKeys: [],
      staleJobs: [],
    };
    try {
      const [byStatus, failedJobs] = await Promise.all([
        this.prisma.cronRunLog.groupBy({
          by: ['status'],
          where: { startedAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.cronRunLog.groupBy({
          by: ['jobKey'],
          where: { status: 'FAILED', startedAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
      const totalRuns = byStatus.reduce((s, g) => s + g._count._all, 0);
      const failedRuns =
        byStatus.find((g) => g.status === 'FAILED')?._count._all ?? 0;
      return {
        ...base,
        totalRuns,
        failedRuns,
        errorRatePct:
          totalRuns > 0
            ? roundOrNull((failedRuns / totalRuns) * 100, 1)
            : null,
        failedJobKeys: failedJobs
          .map((g) => g.jobKey)
          .sort((a, b) => a.localeCompare(b)),
      };
    } catch (err) {
      this.logger.warn(
        `크론 오류율 집계 실패(graceful, 0): ${(err as Error).message}`,
      );
      return base;
    }
  }

  /** 구조화 필드 → 한국어 평문 다이제스트(발송 본문). */
  private renderBody(r: OpsDailyReport): string {
    const lines: string[] = [];
    // 이모지 미사용(2026-07-06 개정) — 심각도는 알림 제목('운영 · 주의/정보')이 이미 담는다.
    lines.push(`일일 운영 리포트 (${r.reportDateKst} KST)`);

    lines.push('');
    lines.push('■ 트랙별 손익 (누적 실현 / 현재 평가)');
    if (r.pnl.byTrack.length === 0) {
      lines.push(' · (집계 대상 트랙 없음)');
    } else {
      for (const t of r.pnl.byTrack) {
        lines.push(
          ` · ${t.label}: 실현 ${formatSignedKrw(t.realizedPnlKrw)} · 평가 ${formatSignedKrw(
            t.unrealizedPnlKrw,
          )} (보유 ${t.openPositions} · 청산 ${t.closedPositions})`,
        );
      }
      lines.push(
        ` 합계: 실현 ${formatSignedKrw(r.pnl.totalRealizedPnlKrw)} · 평가 ${formatSignedKrw(
          r.pnl.totalUnrealizedPnlKrw,
        )}`,
      );
    }

    lines.push('');
    lines.push(`■ 체결 (최근 ${r.fills.windowHours}h): 총 ${r.fills.total}건`);
    for (const f of r.fills.byTrack) {
      lines.push(` · ${f.styleTag}: ${f.fills}건`);
    }

    lines.push('');
    const rate = r.cron.errorRatePct === null ? '—' : `${r.cron.errorRatePct}%`;
    lines.push(
      `■ 크론 (최근 ${r.cron.windowHours}h): 실행 ${r.cron.totalRuns} · 실패 ${r.cron.failedRuns} (오류율 ${rate})`,
    );
    if (r.cron.failedJobKeys.length > 0) {
      lines.push(` · 실패 잡: ${r.cron.failedJobKeys.join(', ')}`);
    }
    if (r.cron.staleJobs.length > 0) {
      lines.push(` · 정체(stale): ${r.cron.staleJobs.join(', ')}`);
    }

    lines.push('');
    if (r.slippage) {
      const o = r.slippage.overall;
      const avgKrw = o.avgSlippageKrw === null ? '—' : `${o.avgSlippageKrw}원`;
      const p95Krw = o.p95SlippageKrw === null ? '—' : `${o.p95SlippageKrw}원`;
      const avgBps = o.avgSlippageBps === null ? '—' : `${o.avgSlippageBps}bps`;
      lines.push(
        `■ 슬리피지 (누적, ${o.tradeCount}건): 평균 ${avgKrw} · p95 ${p95Krw} · 평균 ${avgBps}`,
      );
    } else {
      lines.push('■ 슬리피지 (누적): (집계 불가)');
    }

    lines.push('');
    lines.push(
      `신호(24h): ${r.signals24h}건 · AI 누적비용: $${r.aiCostUsdTotal.toFixed(4)}`,
    );
    return lines.join('\n');
  }
}
