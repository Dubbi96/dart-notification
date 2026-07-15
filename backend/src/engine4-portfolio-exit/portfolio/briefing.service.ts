import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  formatKstDateCompact,
  formatKstDateDashed,
  kstDayStart,
} from '../../common/time/kst';
import { PortfolioService, PortfolioRiskSnapshotView } from './portfolio.service';
import { mapThesisStatus, ThesisDisplayStatus } from './thesis-status.util';
import { aggregateDailyPnl, extractSummaryLine, DailyPnlAggregate } from './briefing.util';

/**
 * BriefingService (W14) — LLM $0 룰 기반 '오늘의 브리핑' 결합 표면.
 *
 * 재료는 전부 기존 DB 행(신규 AI 호출 0 · 외부 API 호출 0):
 *   (a) 내 포지션·관심종목의 당일 DisclosureEvent + 캐시된 DisclosureAnalysis 요약 1줄
 *   (b) 일간 손익 — PositionDailySnapshot 최신·직전 시점 차분(집계 산식은 briefing.util 위임)
 *   (c) 점검 필요 포지션 — 당일 ExitSignal·thesisStatus (TodayCheckSlot 소스 재사용)
 *   (d) 최신 리스크 스냅샷 — PortfolioService.findLatestRiskSnapshot 위임(중복 구현 금지)
 *
 * 억제 규칙: 섹션별 0건이면 해당 섹션 null(생략), 전 섹션 0건이면 브리핑 자체가 null.
 * freshness 정직 표기: 조립 시각(asOf)·KST 기준일(dateKst)·섹션별 데이터 기준일을 항상 포함.
 *
 * ★읽기 전용 표면 — 매매·체결·Buy Score 경로 무접촉(M10 모의운용 무오염).
 *   AI 금지영역 무관(LLM 미사용). 푸시 발송 없음(인앱 전용 v1).
 */

/** 브리핑 이벤트 항목의 종목 출처 — 보유 포지션 vs 관심종목. */
export type BriefingSourceType = 'POSITION' | 'WATCHLIST';

export interface BriefingEventItem {
  rcpNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  eventType: string;
  polarity: string;
  /** 캐시된 AI 요약 1줄(DisclosureAnalysis summary task 재사용). 캐시 없으면 null. */
  summaryLine: string | null;
  source: BriefingSourceType;
}

export interface BriefingPnlSection extends DailyPnlAggregate {
  /** 데이터 기준 거래일 'YYYYMMDD' — PositionDailySnapshot 최신 스냅샷 일자(freshness 정직). */
  snapshotDate: string;
}

export interface BriefingCheckItem {
  positionId: string;
  portfolioId: string;
  corpCode: string;
  corpName: string;
  thesisStatus: ThesisDisplayStatus;
  exitScore: number | null;
  exitAction: string | null;
  /** ExitSignal 점검 시각(ISO). 당일 신호 없이 thesis 사유만이면 null. */
  checkedAt: string | null;
  /** 점검 이유 1줄 — 순수 룰 렌더링. */
  reason: string;
}

export interface TodayBriefing {
  /** KST 기준일 'YYYY-MM-DD'. */
  dateKst: string;
  /** 브리핑 조립 시각(ISO) — 데이터 기준 시각 정직 표기. */
  asOf: string;
  events: BriefingEventItem[] | null;
  dailyPnl: BriefingPnlSection | null;
  checks: BriefingCheckItem[] | null;
  risk: PortfolioRiskSnapshotView | null;
}

/** 이벤트 섹션 상한 — 브리핑은 결합 요약 표면(전량 나열은 공시 피드 몫). */
const MAX_EVENT_ITEMS = 10;
/** 점검 섹션 상한 — TodayCheckSlot 큐레이션(상위 5건)과 동일 규약. */
const MAX_CHECK_ITEMS = 5;

/** 점검 정렬 우선순위 — TodayCheckSlot STATUS_ORDER와 동일(VIOLATED 최우선). */
const CHECK_STATUS_ORDER: Record<ThesisDisplayStatus, number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

/** Exit 액션별 점검 문구 — 순수 룰 렌더링(engine4 5액션 어휘). HOLD는 점검 대상 아님. */
const EXIT_ACTION_REASON: Record<string, string> = {
  WATCH: '관찰 필요',
  REDUCE: '비중 축소 검토',
  EXIT: '청산 검토',
  BLOCK_REBUY: '재매수 금지',
};

/** 조회 조립에 쓰는 포지션 최소 뷰(내부용). */
interface BriefingPositionRow {
  id: string;
  corpCode: string;
  portfolio: { id: string };
  company: { corpName: string };
  positionThesis: { status: string } | null;
}

/** 점검 이유 1줄 — thesis 상태 + 당일 Exit 신호를 결합한 룰 문구. */
function buildCheckReason(
  thesisStatus: ThesisDisplayStatus,
  exitScore: number | null,
  exitAction: string | null,
): string {
  const parts: string[] = [];
  if (thesisStatus === 'VIOLATED') parts.push('투자 논지 훼손');
  else if (thesisStatus === 'EXPIRED') parts.push('논지 만료');
  if (exitAction && exitAction !== 'HOLD') {
    parts.push(`Exit ${exitScore ?? 0}점 · ${EXIT_ACTION_REASON[exitAction] ?? '점검 필요'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '점검 필요';
}

@Injectable()
export class BriefingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
  ) {}

  /**
   * 오늘의 브리핑 조립. `now` 주입 가능(테스트 결정론 — KST 기준일·당일 경계 고정).
   * 전 섹션 0건이면 null(모바일은 섹션 자체를 그리지 않는다 — 0건 억제).
   */
  async buildTodayBriefing(userId: string, now: Date = new Date()): Promise<TodayBriefing | null> {
    const [positions, watchItems] = await Promise.all([
      this.prisma.position.findMany({
        where: { portfolio: { userId }, status: 'OPEN' },
        select: {
          id: true,
          corpCode: true,
          portfolio: { select: { id: true } },
          company: { select: { corpName: true } },
          positionThesis: { select: { status: true } },
        },
      }),
      this.prisma.watchList.findMany({
        where: { userId },
        select: { corpCode: true },
      }),
    ]);

    const [events, dailyPnl, checks, risk] = await Promise.all([
      this.buildEventsSection(positions, watchItems.map((w) => w.corpCode), now),
      this.buildDailyPnlSection(positions),
      this.buildChecksSection(positions, now),
      // (d) 리스크 스냅샷 — 기존 조회 서비스 위임(산출 로직 중복 금지, Engine5 하드룰 무접촉).
      this.portfolioService.findLatestRiskSnapshot(userId),
    ]);

    // 전 섹션 0건 → 브리핑 자체 억제(빈 껍데기 응답 금지).
    if (!events && !dailyPnl && !checks && !risk) return null;

    return {
      dateKst: formatKstDateDashed(now),
      asOf: now.toISOString(),
      events,
      dailyPnl,
      checks,
      risk,
    };
  }

  /**
   * (a) 당일 공시 이벤트 — 포지션·관심종목 corpCode 합집합의 당일(KST rcpDt) DisclosureEvent.
   * 백필 공시는 라이브 표면 절대 제외(isBackfill 불가침 규칙). 요약 1줄은 캐시 재사용(신규 AI 0).
   */
  private async buildEventsSection(
    positions: BriefingPositionRow[],
    watchCorpCodes: string[],
    now: Date,
  ): Promise<BriefingEventItem[] | null> {
    const positionCorpCodes = new Set(positions.map((p) => p.corpCode));
    const corpCodes = [...new Set([...positionCorpCodes, ...watchCorpCodes])];
    if (corpCodes.length === 0) return null;

    const todayCompact = formatKstDateCompact(now);
    const events = await this.prisma.disclosureEvent.findMany({
      where: {
        corpCode: { in: corpCodes },
        // rcpDt는 'YYYYMMDD' 또는 'YYYYMMDDHHmmss' — startsWith로 당일(KST) 필터.
        disclosure: { rcpDt: { startsWith: todayCompact }, isBackfill: false },
      },
      select: {
        rcpNo: true,
        corpCode: true,
        eventType: true,
        polarity: true,
        disclosure: { select: { corpName: true, reportName: true } },
      },
      orderBy: { rcpNo: 'desc' }, // rcpNo는 접수순 단조 — 최신 접수 우선
      take: MAX_EVENT_ITEMS,
    });
    if (events.length === 0) return null;

    const summaries = await this.prisma.disclosureAnalysis.findMany({
      where: { rcpNo: { in: events.map((e) => e.rcpNo) }, task: 'summary' },
      select: { rcpNo: true, resultJson: true },
    });
    const summaryByRcpNo = new Map(
      summaries.map((s) => [s.rcpNo, extractSummaryLine(s.resultJson)]),
    );

    return events.map((e) => ({
      rcpNo: e.rcpNo,
      corpCode: e.corpCode,
      corpName: e.disclosure.corpName,
      reportName: e.disclosure.reportName,
      eventType: e.eventType,
      polarity: e.polarity,
      summaryLine: summaryByRcpNo.get(e.rcpNo) ?? null,
      source: positionCorpCodes.has(e.corpCode) ? 'POSITION' : 'WATCHLIST',
    }));
  }

  /**
   * (b) 일간 손익 — PositionDailySnapshot 최신 스냅샷일과 직전 스냅샷일의 누적손익 차분.
   * 집계 산식은 aggregateDailyPnl(순수 함수)에 위임 — 서비스는 조회·기준일 표기만 담당.
   */
  private async buildDailyPnlSection(
    positions: BriefingPositionRow[],
  ): Promise<BriefingPnlSection | null> {
    const positionIds = positions.map((p) => p.id);
    if (positionIds.length === 0) return null;

    const latest = await this.prisma.positionDailySnapshot.findFirst({
      where: { positionId: { in: positionIds } },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    });
    if (!latest) return null;

    const prev = await this.prisma.positionDailySnapshot.findFirst({
      where: {
        positionId: { in: positionIds },
        snapshotDate: { lt: latest.snapshotDate },
      },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    });

    const rowSelect = { positionId: true, unrealizedPnl: true, positionValue: true };
    const [latestRows, prevRows] = await Promise.all([
      this.prisma.positionDailySnapshot.findMany({
        where: { positionId: { in: positionIds }, snapshotDate: latest.snapshotDate },
        select: rowSelect,
      }),
      prev
        ? this.prisma.positionDailySnapshot.findMany({
            where: { positionId: { in: positionIds }, snapshotDate: prev.snapshotDate },
            select: rowSelect,
          })
        : Promise.resolve([]),
    ]);

    return {
      snapshotDate: latest.snapshotDate,
      ...aggregateDailyPnl(latestRows, prevRows),
    };
  }

  /**
   * (c) 점검 필요 포지션 — TodayCheckSlot 소스(ExitSignal·thesisStatus) 재사용.
   * 포함 조건: 당일(KST) 최신 ExitSignal이 HOLD가 아니거나, thesis가 VIOLATED/EXPIRED.
   * 정렬: thesis 심각도(VIOLATED 최우선) → Exit Score 내림차순, 상위 5건.
   */
  private async buildChecksSection(
    positions: BriefingPositionRow[],
    now: Date,
  ): Promise<BriefingCheckItem[] | null> {
    if (positions.length === 0) return null;

    // 포지션별 당일 최신 ExitSignal 1건 — distinct + checkedAt desc(포지션 내 최신 우선).
    const signals = await this.prisma.exitSignal.findMany({
      where: {
        positionId: { in: positions.map((p) => p.id) },
        checkedAt: { gte: kstDayStart(now) },
      },
      orderBy: [{ positionId: 'asc' }, { checkedAt: 'desc' }],
      distinct: ['positionId'],
      select: { positionId: true, exitScore: true, exitAction: true, checkedAt: true },
    });
    const signalByPosition = new Map(signals.map((s) => [s.positionId, s]));

    const items: BriefingCheckItem[] = [];
    for (const pos of positions) {
      const thesisStatus = mapThesisStatus(pos.positionThesis?.status);
      const signal = signalByPosition.get(pos.id);
      const actionable = signal != null && signal.exitAction !== 'HOLD';
      if (!actionable && thesisStatus !== 'VIOLATED' && thesisStatus !== 'EXPIRED') continue;

      items.push({
        positionId: pos.id,
        portfolioId: pos.portfolio.id,
        corpCode: pos.corpCode,
        corpName: pos.company.corpName,
        thesisStatus,
        exitScore: signal?.exitScore ?? null,
        exitAction: signal?.exitAction ?? null,
        checkedAt: signal?.checkedAt.toISOString() ?? null,
        reason: buildCheckReason(thesisStatus, signal?.exitScore ?? null, signal?.exitAction ?? null),
      });
    }
    if (items.length === 0) return null;

    items.sort(
      (a, b) =>
        CHECK_STATUS_ORDER[a.thesisStatus] - CHECK_STATUS_ORDER[b.thesisStatus] ||
        (b.exitScore ?? 0) - (a.exitScore ?? 0),
    );
    return items.slice(0, MAX_CHECK_ITEMS);
  }
}
