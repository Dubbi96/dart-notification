import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatKstDateCompact, formatKstDateDashed, kstDayStart } from '../common/time/kst';
import { PaperSimulationService } from '../engine5-trading-risk/paper-simulation/paper-simulation.service';
import {
  parsePhilosophyStyle,
  STYLE_LABELS,
} from '../engine5-trading-risk/paper-simulation/philosophy-style';
import { STRATEGY_TAG_PREFIX } from '../engine5-trading-risk/paper-simulation/strategy-forward-simulation.service';
import {
  INTRADAY_SCALP_STYLE_TAG,
  SCALP_INITIAL_CAPITAL,
} from '../engine5-trading-risk/paper-simulation/intraday-scalp/intraday-scalp-exit';
import { DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL } from '../engine5-trading-risk/paper-simulation/dual-momentum-forward/dual-momentum-forward.service';
import { CORE_STYLE_TAG } from '../engine3-quant-market/dual-momentum/dual-momentum.constants';
import {
  findPreset,
  STRATEGY_INITIAL_CAPITAL,
} from '../engine3-quant-market/backtest/strategies/strategy-presets';
import { MarketRegimeService } from '../engine5-trading-risk/paper-simulation/persona/market-regime.service';
import { MarketRegime } from '../engine5-trading-risk/paper-simulation/persona/market-regime';
import { BiweeklyTrackReview, TrackReviewSummary } from './biweekly-track-review.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 트레일링 윈도 길이(캘린더 일, KST) — 격주 리포트 주기와 동일한 14일. */
export const TRACK_REVIEW_WINDOW_DAYS = 14;

/** 표본부족 정직 표기 임계 — 청산 < 5건이면 lowSample(철학/전략 트랙 비교 임계와 동일 값). */
export const TRACK_REVIEW_LOW_SAMPLE_THRESHOLD = 5;

/** 분봉 단타 트랙 라벨. */
const INTRADAY_SCALP_LABEL = '분봉 단타';
/** 듀얼모멘텀 코어 트랙 라벨. */
const DUAL_MOMENTUM_LABEL = '듀얼모멘텀 코어';

/**
 * 트레일링 14일 윈도 시작 절대시각(UTC Date) — KST 캘린더 기준.
 *
 * 경계 의미론(스펙 고정): 윈도는 '리포트 생성일(KST) 포함 최근 14 캘린더 일'이다.
 *   시작 = (생성일 KST 자정) − 13일. 청산시각 ≥ 시작(포함) AND ≤ now(포함)만 집계 —
 *   시작 자정 정각 청산은 포함, 그 1ms 전 청산은 제외.
 */
export function reviewWindowStart(now: Date): Date {
  return new Date(kstDayStart(now).getTime() - (TRACK_REVIEW_WINDOW_DAYS - 1) * MS_PER_DAY);
}

/** 트랙 정체성 — 집계 키·라벨·원금(수익률 분모). */
export interface TrackIdentity {
  trackKey: string;
  label: string;
  initialCapitalKrw: number;
}

/**
 * 모의운용 포트폴리오 이름 → 트랙 정체성(순수 함수).
 *
 * 이름 규약(SSOT: PaperSimulationService.SIM_PORTFOLIO_NAME + 트랙 러너 suffix):
 *  - '모의운용 포트폴리오'                     → 시스템 모의('paper-simulation')
 *  - '모의운용 포트폴리오 [BUFFETT]' 등        → 철학 4종(원금 = 시스템 모의와 동일)
 *  - '모의운용 포트폴리오 [strategy:<key>]'   → 전략 forward(키는 이름에서 동적 수집)
 * 알 수 없는 suffix 는 null(미집계 — 오귀속 방지 정직).
 */
export function parseSimPortfolioTrack(name: string): TrackIdentity | null {
  const base = PaperSimulationService.SIM_PORTFOLIO_NAME;
  if (name === base) {
    return {
      trackKey: PaperSimulationService.TRADE_STRATEGY_KEY,
      label: PaperSimulationService.TRADE_STRATEGY_LABEL,
      initialCapitalKrw: PaperSimulationService.INITIAL_CAPITAL,
    };
  }
  if (!name.startsWith(`${base} [`) || !name.endsWith(']')) return null;
  const tag = name.slice(base.length + 2, -1);

  const style = parsePhilosophyStyle(tag);
  if (style) {
    return {
      trackKey: style,
      label: `철학 ${STYLE_LABELS[style]}`,
      initialCapitalKrw: PaperSimulationService.INITIAL_CAPITAL,
    };
  }
  if (tag.startsWith(STRATEGY_TAG_PREFIX)) {
    const key = tag.slice(STRATEGY_TAG_PREFIX.length);
    return {
      trackKey: tag,
      label: `전략 ${findPreset(key)?.label ?? key}`,
      initialCapitalKrw: STRATEGY_INITIAL_CAPITAL,
    };
  }
  return null;
}

/** 청산 1건의 집계 입력 — 순손익(원) + 보유기간(일, 산출 불가면 null). */
export interface ClosedTradeLike {
  netPnl: number;
  holdDays: number | null;
}

/** 소수 digits 반올림. */
function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * 트랙 청산 목록 → 성과 요약(순위 제외, 순수 함수).
 *  - 승률: 순손익 > 0 비율(%). 청산 0건이면 null(가짜 비율 금지).
 *  - 수익률: 실현손익 합 / 원금 × 100 (실현 기준 — OPEN 평가 미포함).
 *  - 평균 보유: holdDays 산출 가능한 표본 평균. 표본 0이면 null.
 *  - lowSample: 청산 < TRACK_REVIEW_LOW_SAMPLE_THRESHOLD(5) 정직 표기.
 */
export function summarizeTrackTrades(
  identity: TrackIdentity,
  trades: ClosedTradeLike[],
): Omit<TrackReviewSummary, 'rank'> {
  const closedTrades = trades.length;
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const realizedPnlKrw = Math.round(trades.reduce((s, t) => s + t.netPnl, 0));
  const holdSamples = trades
    .map((t) => t.holdDays)
    .filter((h): h is number => h !== null && Number.isFinite(h));
  return {
    trackKey: identity.trackKey,
    label: identity.label,
    closedTrades,
    wins,
    winRatePct: closedTrades > 0 ? roundTo((wins / closedTrades) * 100, 1) : null,
    realizedPnlKrw,
    initialCapitalKrw: identity.initialCapitalKrw,
    returnPct:
      identity.initialCapitalKrw > 0
        ? roundTo((realizedPnlKrw / identity.initialCapitalKrw) * 100, 2)
        : 0,
    avgHoldDays:
      holdSamples.length > 0
        ? roundTo(holdSamples.reduce((s, h) => s + h, 0) / holdSamples.length, 2)
        : null,
    lowSample: closedTrades < TRACK_REVIEW_LOW_SAMPLE_THRESHOLD,
  };
}

/**
 * 순위 부여(순수 함수) — 수익률 내림차순. 동률은 청산 건수 desc → trackKey asc(결정론 안정 정렬).
 * lowSample 트랙도 순위에 포함(플래그로만 노출 — 배제하면 순위 자체가 표본 편향).
 */
export function rankTracks(
  summaries: Array<Omit<TrackReviewSummary, 'rank'>>,
): TrackReviewSummary[] {
  return [...summaries]
    .sort(
      (a, b) =>
        b.returnPct - a.returnPct ||
        b.closedTrades - a.closedTrades ||
        a.trackKey.localeCompare(b.trackKey),
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/** 부호 포함 원화 표기(결정론 — 로케일 무관 수동 3자리 구분, ops-daily-report 와 동일 규약). */
function formatSignedKrw(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}원`;
}

/** 부호 포함 % 표기. */
function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}%`;
}

/** 평균 보유 표기 — 1일 미만은 분 단위(단타 정직 표기), 그 외 일 단위. null 은 '—'. */
function formatHold(avgHoldDays: number | null): string {
  if (avgHoldDays === null) return '—';
  if (avgHoldDays < 1) return `${Math.round(avgHoldDays * 24 * 60)}분`;
  return `${roundTo(avgHoldDays, 1)}일`;
}

/** 시장국면 한국어 라벨(순수 함수) — 추세·변동성·이벤트 편향 3축. */
export function describeRegime(regime: MarketRegime): string {
  const trend = { UPTREND: '상승추세', DOWNTREND: '하락추세', SIDEWAYS: '횡보' }[regime.trend];
  const vol = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' }[regime.volatility];
  const skew = {
    RISK_HEAVY: '악재우세',
    OPPORTUNITY: '호재우세',
    BALANCED: '중립',
  }[regime.eventSkew];
  const changePct =
    regime.trendChangePct === null ? '—' : formatSignedPct(roundTo(regime.trendChangePct, 1));
  const limited = regime.dataLimited ? ' [표본부족]' : '';
  return `${trend} · 변동성 ${vol} · 공시분위기 ${skew} (지수 ${changePct} / 표본 ${regime.indexSampleSize})${limited}`;
}

/**
 * 구조화 리포트 → 한국어 평문 다이제스트(순수 함수, 발송 본문).
 * ★이모지 미사용(2026-07-06 알림 표기 개정) — 텍스트만.
 */
export function renderReviewBody(r: Omit<BiweeklyTrackReview, 'body'>): string {
  const lines: string[] = [];
  lines.push(
    `격주 트랙 성과 리포트 (${r.periodStartKst} ~ ${r.periodEndKst} KST · 트레일링 ${r.windowDays}일)`,
  );

  lines.push('');
  if (r.regime) {
    lines.push(`■ 시장국면: ${describeRegime(r.regime)}`);
  } else {
    lines.push('■ 시장국면: (판정 불가)');
  }

  lines.push('');
  lines.push('■ 트랙 순위 (실현 기준 · 수익률 = 실현손익/원금)');
  if (r.tracks.length === 0) {
    lines.push(' · (집계 대상 트랙 없음)');
  } else {
    for (const t of r.tracks) {
      const winRate = t.winRatePct === null ? '—' : `${t.winRatePct}%`;
      const low = t.lowSample ? ` [표본부족 ${t.closedTrades}건]` : '';
      lines.push(
        ` ${t.rank}. ${t.label}: ${formatSignedPct(t.returnPct)} (실현 ${formatSignedKrw(
          t.realizedPnlKrw,
        )} · 청산 ${t.closedTrades}건 · 승률 ${winRate} · 평균보유 ${formatHold(t.avgHoldDays)})${low}`,
      );
    }
  }

  lines.push('');
  lines.push('실현(청산) 기준 비교 — 보유 중 평가손익 미포함. 표본부족 트랙 순위는 과신 금지.');
  return lines.join('\n');
}

/**
 * BiweeklyTrackReviewService — 모의투자 전 트랙의 트레일링 14일(캘린더, KST) 실현 성과를
 * 집계·순위화하고 시장국면을 태깅한다. 발송은 스케줄러, 온디맨드 조회는 컨트롤러가 담당.
 *
 * 데이터 소스(전부 CLOSED/실현 기준):
 *  - Position 기반 트랙(시스템 모의·철학 4종·전략 forward 4종): `Position(status=CLOSED,
 *    closedAt∈윈도)` 를 모의운용 포트폴리오 이름 규약으로 트랙 귀속. CLOSED Position 의
 *    unrealizedPnl 은 청산 시점 고정 실현 순손익(SSOT — ops-daily-report·RiskGuard 월간손실
 *    산정과 동일 관점). ★PaperTrade.styleTag 를 쓰지 않는 이유: 시스템 모의 청산(SELL)은
 *    styleTag=null 로 기록되고(risk-guard SSOT '−styleTag null=단일 시뮬'), 장중 모니터의
 *    공용 executeSell 이 철학/전략 포트폴리오 청산에도 태그를 남기지 않아 태그 기반 귀속이
 *    체계적으로 오귀속된다. Position→Portfolio 귀속은 청산 경로와 무관하게 항상 정확하다.
 *  - 분봉 단타: `IntradayScalpTrade(status=CLOSED, exitTs∈윈도)` — netPnl·holdMinutes.
 *  - 듀얼모멘텀 코어: `DualMomentumForwardTrade(status=CLOSED, exitDate∈윈도)` — netPnl·entryTs/exitTs.
 *
 * ★read-only 관측 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
 *   집계 실패는 graceful(해당 트랙군 빈 목록/0건) — 리포트 골격은 항상 반환한다.
 *   ★실주문/Kill Switch 무직결 — M10 클록 보호(측정 트랙 매매 행동 무변경).
 */
@Injectable()
export class BiweeklyTrackReviewService {
  private readonly logger = new Logger(BiweeklyTrackReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketRegime: MarketRegimeService,
  ) {}

  /** 격주 리포트 스냅샷. `now` 주입 가능(테스트 결정론). */
  async buildReview(now: Date = new Date()): Promise<BiweeklyTrackReview> {
    const windowStart = reviewWindowStart(now);

    const [positionTracks, scalpTrack, dualTrack, regime] = await Promise.all([
      this.buildPositionTracks(windowStart, now),
      this.buildScalpTrack(windowStart, now),
      this.buildDualMomentumTrack(windowStart, now),
      this.loadRegime(),
    ]);

    const tracks = rankTracks([...positionTracks, scalpTrack, dualTrack]);
    const review: Omit<BiweeklyTrackReview, 'body'> = {
      generatedAt: now.toISOString(),
      periodStartKst: formatKstDateDashed(windowStart),
      periodEndKst: formatKstDateDashed(now),
      windowDays: TRACK_REVIEW_WINDOW_DAYS,
      regime,
      tracks,
    };
    return { ...review, body: renderReviewBody(review) };
  }

  /**
   * Position 기반 트랙(시스템 모의 + 철학 4종 + 전략 forward N종) — 모의운용 포트폴리오
   * 이름 규약으로 동적 수집(하드코딩 목록 금지 — 새 트랙 규약 준수 시 자동 편입).
   * 발견된 트랙은 윈도 내 청산 0건이어도 목록에 포함(0건 정직 표기). 실패 시 빈 목록(graceful).
   */
  private async buildPositionTracks(
    windowStart: Date,
    now: Date,
  ): Promise<Array<Omit<TrackReviewSummary, 'rank'>>> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { email: PaperSimulationService.SIM_USER_EMAIL },
        select: { id: true },
      });
      if (!user) return [];

      const portfolios = await this.prisma.portfolio.findMany({
        where: {
          userId: user.id,
          name: { startsWith: PaperSimulationService.SIM_PORTFOLIO_NAME },
        },
        select: { id: true, name: true },
      });
      const identities = new Map<string, TrackIdentity>();
      for (const pf of portfolios) {
        const identity = parseSimPortfolioTrack(pf.name);
        if (identity) identities.set(pf.id, identity);
      }
      if (identities.size === 0) return [];

      const closed = await this.prisma.position.findMany({
        where: {
          portfolioId: { in: [...identities.keys()] },
          status: 'CLOSED',
          closedAt: { gte: windowStart, lte: now },
        },
        select: { portfolioId: true, unrealizedPnl: true, entryDate: true, closedAt: true },
      });

      const tradesByPortfolio = new Map<string, ClosedTradeLike[]>();
      for (const p of closed) {
        const holdMs =
          p.closedAt !== null ? p.closedAt.getTime() - p.entryDate.getTime() : null;
        const list = tradesByPortfolio.get(p.portfolioId) ?? [];
        list.push({
          netPnl: p.unrealizedPnl ?? 0, // CLOSED 는 청산 시점 고정 실현 순손익(SSOT)
          holdDays: holdMs !== null && holdMs >= 0 ? holdMs / MS_PER_DAY : null,
        });
        tradesByPortfolio.set(p.portfolioId, list);
      }

      return [...identities.entries()].map(([portfolioId, identity]) =>
        summarizeTrackTrades(identity, tradesByPortfolio.get(portfolioId) ?? []),
      );
    } catch (err) {
      this.logger.warn(
        `Position 트랙 집계 실패(graceful, 빈 목록): ${(err as Error).message}`,
      );
      return [];
    }
  }

  /** 분봉 단타 트랙 — IntradayScalpTrade CLOSED(exitTs∈윈도). 실패 시 0건 요약(graceful). */
  private async buildScalpTrack(
    windowStart: Date,
    now: Date,
  ): Promise<Omit<TrackReviewSummary, 'rank'>> {
    const identity: TrackIdentity = {
      trackKey: INTRADAY_SCALP_STYLE_TAG,
      label: INTRADAY_SCALP_LABEL,
      initialCapitalKrw: SCALP_INITIAL_CAPITAL,
    };
    try {
      const rows = await this.prisma.intradayScalpTrade.findMany({
        where: { status: 'CLOSED', exitTs: { gte: windowStart, lte: now } },
        select: { netPnl: true, holdMinutes: true },
      });
      return summarizeTrackTrades(
        identity,
        rows.map((r) => ({
          netPnl: Number(r.netPnl ?? 0),
          holdDays: r.holdMinutes !== null ? r.holdMinutes / (24 * 60) : null,
        })),
      );
    } catch (err) {
      this.logger.warn(`분봉 단타 집계 실패(graceful, 0건): ${(err as Error).message}`);
      return summarizeTrackTrades(identity, []);
    }
  }

  /**
   * 듀얼모멘텀 코어 트랙 — DualMomentumForwardTrade CLOSED(exitDate∈윈도, YYYYMMDD 프리픽스
   * 비교 — 월말 리밸런싱 트랙의 거래일 SSOT). 실패 시 0건 요약(graceful).
   */
  private async buildDualMomentumTrack(
    windowStart: Date,
    now: Date,
  ): Promise<Omit<TrackReviewSummary, 'rank'>> {
    const identity: TrackIdentity = {
      trackKey: CORE_STYLE_TAG,
      label: DUAL_MOMENTUM_LABEL,
      initialCapitalKrw: DUAL_MOMENTUM_FORWARD_INITIAL_CAPITAL,
    };
    try {
      const rows = await this.prisma.dualMomentumForwardTrade.findMany({
        where: {
          styleTag: CORE_STYLE_TAG,
          status: 'CLOSED',
          exitDate: {
            gte: formatKstDateCompact(windowStart),
            lte: formatKstDateCompact(now),
          },
        },
        select: { netPnl: true, entryTs: true, exitTs: true },
      });
      return summarizeTrackTrades(
        identity,
        rows.map((r) => {
          const holdMs =
            r.entryTs !== null && r.exitTs !== null
              ? r.exitTs.getTime() - r.entryTs.getTime()
              : null;
          return {
            netPnl: Number(r.netPnl ?? 0),
            holdDays: holdMs !== null && holdMs >= 0 ? holdMs / MS_PER_DAY : null,
          };
        }),
      );
    } catch (err) {
      this.logger.warn(`듀얼모멘텀 코어 집계 실패(graceful, 0건): ${(err as Error).message}`);
      return summarizeTrackTrades(identity, []);
    }
  }

  /** 현재 시장국면 — MarketRegimeService(DAR-130 순수 Rule) 재사용. 실패 시 null(graceful). */
  private async loadRegime(): Promise<MarketRegime | null> {
    try {
      return await this.marketRegime.getCurrentRegime();
    } catch (err) {
      this.logger.warn(`시장국면 판정 실패(graceful, null): ${(err as Error).message}`);
      return null;
    }
  }
}
