import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SignalGrade, ExitAction, Prisma } from '@prisma/client';
import { tradeDateFromMs } from '../market-data/candle-query';
import { isTradingDay } from '../../common/time/market-calendar';
import {
  FALLBACK_BRIEFING_LIMIT,
  FallbackBriefingItem,
  FallbackBriefingRow,
  buildFallbackBriefingItems,
} from './fallback-briefing';

// 등급무관 탐색(DAR-46): 백엔드 6단계 enum을 모바일에 1:1로 노출한다.
// 기존엔 NEUTRAL/AVOID/WATCH를 'WATCH'로 합쳐 등급 칩·필터가 무의미해졌으므로,
// 전 등급을 보존해 탐색 화면이 등급별로 변별·필터·표시할 수 있게 한다.
type MobileGrade =
  | 'STRONG_BUY'
  | 'BUY'
  | 'WATCH'
  | 'NEUTRAL'
  | 'AVOID'
  | 'BLOCKED';

/** 모바일 등급값 → Prisma SignalGrade enum (필터 where 절 역매핑) */
const MOBILE_GRADE_TO_ENUM: Record<MobileGrade, SignalGrade> = {
  STRONG_BUY: SignalGrade.STRONG_BUY_CANDIDATE,
  BUY: SignalGrade.BUY_CANDIDATE,
  WATCH: SignalGrade.WATCH,
  NEUTRAL: SignalGrade.NEUTRAL,
  AVOID: SignalGrade.AVOID,
  BLOCKED: SignalGrade.BLOCKED,
};

/** 신호 정렬 옵션(DAR-46): 점수 내림차순 / 최신순 */
export type SignalSort = 'score' | 'latest';

/**
 * 점수순 큐레이션 최신성 윈도우 기본값(일).
 * 점수 정렬은 전체 이력에서 buyScore 내림차순이라, 과거 고득점 신호(6월 지표공백기 이전)가
 * 영원히 상단에 고정돼 홈 '오늘의 투자판단'이 수 주째 미갱신되는 정체를 만들었다.
 * sort=score 이고 sinceDays 미지정이면 이 기본값을 적용한다 — 파라미터를 모르는 구 APK 도
 * 재빌드 없이 즉시 최신성을 획득한다("오늘의 투자판단"의 계약). sinceDays=0 명시 시 해제.
 */
const DEFAULT_SCORE_SINCE_DAYS = 14;

const DAY_MS = 86_400_000;

const SCORE_BREAKDOWN_MAX: Record<string, number> = {
  disclosureEvent: 25,
  keyMetric: 20,
  personaFit: 20,
  historicalEvent: 15,
  chart: 10,
  volumeLiquidity: 5,
  marketSector: 5,
  insider: 5,
  fundamental: 5,
};

const SCORE_BREAKDOWN_LABEL: Record<string, string> = {
  disclosureEvent: '공시 이벤트',
  keyMetric: '핵심 지표',
  personaFit: '페르소나 적합성',
  historicalEvent: '과거 이벤트',
  chart: '차트',
  volumeLiquidity: '거래량/유동성',
  marketSector: '시장/섹터',
  insider: '내부자/대량보유',
  fundamental: '펀더멘털(성장률/본문수치)',
};

/**
 * EventStudyResult.sampleCount(표본수)에서 신뢰도를 파생하는 통계 근거 항목.
 * 현재 `historicalEvent`(과거 유사 공시 성과)만 EventStudy 집계 기반.
 * 차트·페르소나 등 비통계 항목은 여기에 없으므로 sampleN 미부여(undefined 유지).
 */
const STAT_DERIVED_KEYS = ['historicalEvent'] as const;

/**
 * 표본수 조회가 소비하는 EventStudy 버킷 좌표(코어스 버킷 고정).
 * `@@unique([eventType, bucketKey, marketType])` 이므로 (eventType, '__ALL__', 'ALL')은
 * eventType당 최대 1행 — "최신 1건 채택"의 버킷 비결정성을 제거한다(홈 카드 '표본' 오표시 결함).
 */
const SAMPLE_SOURCE_BUCKET_KEY = '__ALL__';
const SAMPLE_SOURCE_MARKET_TYPE = 'ALL';

/**
 * scoreBreakdown.sampleScope 계약값 — 모바일(BuyScoreComponent.sampleScope?: string)이
 * `${EVENT_TYPE_LABEL(eventType)}(${sampleScope})` 형태로 괄호에 **그대로** 병기한다
 * (mobile/types/signal.types.ts · components/home/HomeSignalPreview.tsx).
 * 표시 목표 '표본 1,871건 · 대규모 공급계약(전체시장)' → 값은 리터럴 '전체시장'.
 * 현재 표본수 출처가 (marketType=ALL, bucketKey=__ALL__) 코어스 버킷으로 고정이므로
 * sampleN이 존재할 때 항상 이 스코프가 부여된다(표시 표본의 출처 정직화).
 * NOTE(후속): 표시 표본 ≠ 점수 계산 소비 버킷(스코어링은 시장별 세분 버킷 소비) 문제의
 * 근본 해결은 신호 생성 시 실제 소비한 버킷 좌표를 TradingSignal에 persist하는 것 —
 * 이 이슈 범위 밖(별도 후속 이슈).
 */
const SAMPLE_SCOPE_ALL_MARKET = '전체시장';

function mapGrade(grade: SignalGrade): MobileGrade {
  switch (grade) {
    case SignalGrade.STRONG_BUY_CANDIDATE:
      return 'STRONG_BUY';
    case SignalGrade.BUY_CANDIDATE:
      return 'BUY';
    case SignalGrade.WATCH:
      return 'WATCH';
    case SignalGrade.NEUTRAL:
      return 'NEUTRAL';
    case SignalGrade.AVOID:
      return 'AVOID';
    case SignalGrade.BLOCKED:
    default:
      return 'BLOCKED';
  }
}

/** 단일 등급 토큰(모바일 값 또는 raw enum)을 Prisma enum으로 정규화. 미인식이면 undefined. */
function resolveGradeToken(token: string): SignalGrade | undefined {
  if (token in MOBILE_GRADE_TO_ENUM) {
    return MOBILE_GRADE_TO_ENUM[token as MobileGrade];
  }
  // raw enum 값(STRONG_BUY_CANDIDATE 등)도 하위호환으로 허용
  if ((Object.values(SignalGrade) as string[]).includes(token)) {
    return token as SignalGrade;
  }
  return undefined;
}

/**
 * 등급 필터를 Prisma where 조건으로 정규화한다(DAR-193).
 * - 단일 등급: `signal: <enum>` (기존 계약 보존).
 * - 콤마 구분 다중 등급("STRONG_BUY,BUY"): `signal: { in: [...] }` —
 *   홈 '상위 매수 신호' 큐레이션이 매수등급(STRONG_BUY+BUY)만 점수순으로 받기 위함.
 * - 인식 가능한 토큰이 없으면 undefined → signal 조건 미생성(전 등급).
 */
function resolveGradeFilter(
  grade?: string,
): SignalGrade | { in: SignalGrade[] } | undefined {
  if (!grade) return undefined;
  const enums: SignalGrade[] = [];
  for (const token of grade.split(',')) {
    const resolved = resolveGradeToken(token.trim());
    if (resolved && !enums.includes(resolved)) enums.push(resolved);
  }
  if (enums.length === 0) return undefined;
  if (enums.length === 1) return enums[0];
  return { in: enums };
}

function mapScoreBreakdown(
  breakdown: Prisma.JsonValue,
  sampleNByKey: Partial<Record<string, number>> = {},
): {
  key: string;
  label: string;
  score: number;
  max: number;
  sampleN?: number;
  sampleScope?: string;
}[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return [];
  }
  const obj = breakdown as Record<string, unknown>;
  return Object.keys(SCORE_BREAKDOWN_MAX).map((key) => {
    const sampleN = sampleNByKey[key];
    return {
      key,
      label: SCORE_BREAKDOWN_LABEL[key] ?? key,
      score: typeof obj[key] === 'number' ? (obj[key] as number) : 0,
      max: SCORE_BREAKDOWN_MAX[key],
      // 표본수가 있는 통계 항목에만 sampleN + 출처 스코프(sampleScope) 부여.
      // 표본수 출처가 (ALL, __ALL__) 코어스 버킷으로 고정이므로 스코프도 상수 —
      // 그 외 항목은 키 자체를 생략(undefined 유지, 기존 응답 필드 불변·하위호환).
      ...(typeof sampleN === 'number'
        ? { sampleN, sampleScope: SAMPLE_SCOPE_ALL_MARKET }
        : {}),
    };
  });
}

/**
 * eventType별 통계 항목 sampleN(EventStudyResult.sampleCount) 매핑을 만든다.
 * 해당 eventType의 최신(calculatedAt desc) READY 집계 표본수를 통계 파생 항목에 부여.
 * 집계가 없으면 키를 비워 두어 sampleN이 undefined(미표시)로 남는다.
 */
function buildSampleNByKey(
  eventType: string | null | undefined,
  sampleCountByEventType: Map<string, number>,
): Partial<Record<string, number>> {
  const sampleN = eventType
    ? sampleCountByEventType.get(eventType)
    : undefined;
  if (typeof sampleN !== 'number') return {};
  const out: Partial<Record<string, number>> = {};
  for (const key of STAT_DERIVED_KEYS) {
    out[key] = sampleN;
  }
  return out;
}

/**
 * W13 '근거 지표 펼치기' — 스코어링(signal-generation.loadStockContextAsOf)이 소비하는
 * TechnicalIndicator 원시 수치의 read-only 스냅샷. 점수 계산 로직 무변경(노출만).
 * nullable 유지(커버리지 구멍 가능) — 모바일이 '—' 처리한다(빈 값 노출 방지).
 */
export interface SignalEvidenceIndicators {
  /** 지표 기준 거래일(YYYYMMDD) — 신호 생성 KST 거래일 이하 최신 행(as-of 근사). */
  tradeDate: string;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  bollingerMid: number | null;
  volumeRatio20: number | null;
  /** 공시 전 선행상승률 D-5~D-1 (%). */
  preDsclReturn: number | null;
}

function mapExitReasons(exitSignal: {
  lossRiskScore: number;
  thesisBreakScore: number;
  chartBreakScore: number;
  timeExceededScore: number;
}): { id: string; label: string; kind: 'loss' | 'thesis' | 'chart' | 'time' }[] {
  const reasons: { id: string; label: string; kind: 'loss' | 'thesis' | 'chart' | 'time' }[] = [];

  if (exitSignal.lossRiskScore > 0) {
    reasons.push({ id: 'loss_risk', label: '손실 리스크', kind: 'loss' });
  }
  if (exitSignal.thesisBreakScore > 0) {
    reasons.push({ id: 'thesis_break', label: '투자 논리 훼손', kind: 'thesis' });
  }
  if (exitSignal.chartBreakScore > 0) {
    reasons.push({ id: 'chart_break', label: '차트 이탈', kind: 'chart' });
  }
  if (exitSignal.timeExceededScore > 0) {
    reasons.push({ id: 'time_exceeded', label: '보유 기간 초과', kind: 'time' });
  }
  return reasons;
}

@Injectable()
export class SignalsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 주어진 eventType들의 통계 표본수(EventStudyResult.sampleCount)를 일괄 조회한다.
   * (marketType='ALL', bucketKey='__ALL__')·status='READY' 코어스 버킷 고정 —
   * `@@unique([eventType, bucketKey, marketType])` 이므로 eventType당 최대 1행이라
   * 결과가 결정적이다(기존 "최신 1건" 채택은 세분 버킷들 사이에서 비결정적이었음).
   * eventType별로 매핑(N+1 회피용 단일 쿼리). 집계가 없으면 맵에서 누락.
   */
  private async sampleCountByEventType(
    eventTypes: (string | null | undefined)[],
  ): Promise<Map<string, number>> {
    const unique = [...new Set(eventTypes.filter((e): e is string => !!e))];
    const map = new Map<string, number>();
    if (unique.length === 0) return map;

    const results = await this.prisma.eventStudyResult.findMany({
      where: {
        eventType: { in: unique },
        marketType: SAMPLE_SOURCE_MARKET_TYPE,
        bucketKey: SAMPLE_SOURCE_BUCKET_KEY,
        status: 'READY',
      },
      orderBy: { calculatedAt: 'desc' },
      select: { eventType: true, sampleCount: true },
    });
    for (const r of results) {
      // calculatedAt desc 정렬이므로 eventType별 첫 항목(최신)만 채택
      if (!map.has(r.eventType)) map.set(r.eventType, r.sampleCount);
    }
    return map;
  }

  async findAll(filters: {
    grade?: string;
    personaType?: string;
    eventType?: string;
    entryReady?: boolean;
    sort?: SignalSort;
    /** 최신성 윈도우(일). createdAt ≥ now−N일. 0=해제(전체 이력). 미지정 시 sort=score 만 기본 14일. */
    sinceDays?: number;
    page?: number;
    limit?: number;
  }) {
    const {
      grade,
      personaType,
      eventType,
      entryReady,
      sort = 'latest',
      sinceDays,
      page = 1,
      limit = 20,
    } = filters;

    const gradeFilter = resolveGradeFilter(grade);

    // 최신성 윈도우 기본값 규칙: sort=score(점수순 큐레이션)이고 sinceDays 미지정이면 기본 14일 —
    // 전체 이력 고득점 고정(홈 '오늘의 투자판단' 정체)을 차단한다. sinceDays=0 명시 시 윈도우
    // 해제(전체 이력·이전 동작). sort=latest 는 기본 무윈도우(기존 동작 유지, 명시 지정만 적용).
    const effectiveSinceDays =
      sinceDays ?? (sort === 'score' ? DEFAULT_SCORE_SINCE_DAYS : 0);

    const where: Prisma.TradingSignalWhereInput = {
      // ★DAR-129: 신호 피드는 백필(과거 분석 baseline) 공시 기반 신호를 절대 노출하지 않는다.
      //   신호 생성 단계에서 이미 백필을 배제하지만, 피드 조회에도 방어적으로 relation 필터를 둔다.
      disclosure: { isBackfill: false },
      ...(gradeFilter && { signal: gradeFilter }),
      ...(personaType && { persona: personaType }),
      ...(eventType && { eventType }),
      ...(entryReady !== undefined && { entryReady }),
      ...(effectiveSinceDays > 0 && {
        createdAt: { gte: new Date(Date.now() - effectiveSinceDays * DAY_MS) },
      }),
    };

    // 정렬(DAR-46): 점수순은 동점 시 최신순으로 안정화. 기본은 최신순.
    // DAR-289: createdAt 도 같은 배치에서 동값 가능 → 유니크 id 로 최종 tie-break(페이지 경계 안정화)
    const orderBy: Prisma.TradingSignalOrderByWithRelationInput[] =
      sort === 'score'
        ? [{ buyScore: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];

    const [signals, total] = await Promise.all([
      this.prisma.tradingSignal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          company: {
            select: { corpCode: true, corpName: true, stockCode: true },
          },
        },
      }),
      this.prisma.tradingSignal.count({ where }),
    ]);

    const sampleCountByEventType = await this.sampleCountByEventType(
      signals.map((s) => s.eventType),
    );

    const items = signals.map((s) => ({
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      summary: s.signalSummary ?? undefined,
      entryConditions: [
        ...s.entryConditionMet.map((label, i) => ({
          id: `met_${i}`,
          label,
          required: true,
          met: true,
        })),
        ...s.entryConditionUnmet.map((label, i) => ({
          id: `unmet_${i}`,
          label,
          required: true,
          met: false,
        })),
      ],
      riskFlags: s.riskFactors.map((label, i) => ({
        id: `risk_${i}`,
        label,
        severity: 'medium' as const,
      })),
      blockedReason: s.blockedReason ?? undefined,
      // DAR-323: '왜 강한 신호가 아닌지' 억제 사유 enum(BUY 이상·BLOCKED 는 null→undefined).
      suppressionReason: s.suppressionReason ?? undefined,
      scoreBreakdown: mapScoreBreakdown(
        s.scoreBreakdown,
        buildSampleNByKey(s.eventType, sampleCountByEventType),
      ),
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    }));

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const s = await this.prisma.tradingSignal.findUnique({
      where: { id },
      include: {
        company: {
          select: { corpCode: true, corpName: true, stockCode: true },
        },
      },
    });

    if (!s) {
      throw new NotFoundException('Signal not found');
    }

    const [sampleCountByEventType, evidenceIndicators] = await Promise.all([
      this.sampleCountByEventType([s.eventType]),
      this.loadEvidenceIndicators(
        s.company?.stockCode ?? s.stockCode,
        s.createdAt,
      ),
    ]);

    return {
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      summary: s.signalSummary ?? undefined,
      entryConditions: [
        ...s.entryConditionMet.map((label, i) => ({
          id: `met_${i}`,
          label,
          required: true,
          met: true,
        })),
        ...s.entryConditionUnmet.map((label, i) => ({
          id: `unmet_${i}`,
          label,
          required: true,
          met: false,
        })),
      ],
      riskFlags: s.riskFactors.map((label, i) => ({
        id: `risk_${i}`,
        label,
        severity: 'medium' as const,
      })),
      blockedReason: s.blockedReason ?? undefined,
      // DAR-323: '왜 강한 신호가 아닌지' 억제 사유 enum(BUY 이상·BLOCKED 는 null→undefined).
      suppressionReason: s.suppressionReason ?? undefined,
      scoreBreakdown: mapScoreBreakdown(
        s.scoreBreakdown,
        buildSampleNByKey(s.eventType, sampleCountByEventType),
      ),
      // W13: '근거 지표 펼치기' — 스코어링 소비 원시 수치 read-only(미가용 null → 모바일 미표시).
      evidenceIndicators,
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /**
   * W13 '근거 지표 펼치기' — 신호 상세에 스코어링이 소비한 TechnicalIndicator 원시 수치를
   * read-only 로 동봉한다. 스코어링(loadStockContextAsOf)과 동일 규칙으로 '신호 생성 KST
   * 거래일 이하 최신 행'을 as-of 조회한다(TradingSignal 이 지표 스냅샷을 persist 하지 않으므로
   * point-in-time 근사 — tradeDate 를 함께 노출해 기준 시점을 정직 고지).
   *
   * ★graceful: 근거 지표는 보조 표면 — 조회 실패·미적재가 신호 상세 자체를 막지 않는다(null).
   * ★AI 금지영역 무관: 순수 조회. 점수 계산 로직 무변경(노출만).
   */
  private async loadEvidenceIndicators(
    stockCode: string | null | undefined,
    createdAt: Date,
  ): Promise<SignalEvidenceIndicators | null> {
    if (!stockCode) return null;
    try {
      const asOfTradeDate = tradeDateFromMs(createdAt.getTime());
      const ti = await this.prisma.technicalIndicator.findFirst({
        where: { stockCode, tradeDate: { lte: asOfTradeDate } },
        orderBy: { tradeDate: 'desc' },
        select: {
          tradeDate: true,
          ma5: true,
          ma20: true,
          ma60: true,
          rsi14: true,
          macdLine: true,
          macdSignal: true,
          bollingerMid: true,
          volumeRatio20: true,
          preDsclReturn: true,
        },
      });
      if (!ti) return null;
      return {
        tradeDate: ti.tradeDate,
        ma5: ti.ma5,
        ma20: ti.ma20,
        ma60: ti.ma60,
        rsi14: ti.rsi14,
        macdLine: ti.macdLine,
        macdSignal: ti.macdSignal,
        bollingerMid: ti.bollingerMid,
        volumeRatio20: ti.volumeRatio20,
        preDsclReturn: ti.preDsclReturn,
      };
    } catch {
      // 미주입 목/DB 오류 등 — 근거 지표 없이 상세를 서빙(비파괴 graceful).
      return null;
    }
  }

  /**
   * DAR-159: 특정 종목(corpCode)의 최신 매수 신호 단건을 조회한다.
   * 종목 상세 화면의 신호 배지(등급·점수·진입준비)용 경량 응답.
   * - ★DAR-129: 백필(과거 분석 baseline) 공시 기반 신호는 절대 노출하지 않는다(피드와 동일 방어).
   * - 신호가 없는 종목은 null 반환(호출측이 빈상태로 흡수).
   */
  async findLatestByCorpCode(corpCode: string) {
    const s = await this.prisma.tradingSignal.findFirst({
      where: {
        corpCode,
        disclosure: { isBackfill: false },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: { corpCode: true, corpName: true, stockCode: true },
        },
      },
    });

    if (!s) return null;

    return {
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      entryReady: s.entryReady,
      summary: s.signalSummary ?? undefined,
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /**
   * DAR-208: 공시(rcpNo)로 생성된 최신 매수 신호 단건을 조회한다(역링크).
   * 공시 상세 → 그 공시로 생성된 매수 신호 진입 카드용 경량 응답
   * (기존엔 신호 → 공시 단방향만 존재, 공시 → 신호 동선이 끊겨 있었다).
   * - ★DAR-129: 백필(과거 분석 baseline) 공시 기반 신호는 절대 노출하지 않는다(피드와 동일 방어).
   * - 한 공시에 신호가 여러 건이면 최신(createdAt desc) 1건. 신호가 없으면 null(호출측 미표시).
   * 응답 형태는 by-corp 배지(findLatestByCorpCode)와 동일하게 맞춘다(모바일 재사용).
   */
  async findByDisclosureRcpNo(rcpNo: string) {
    const s = await this.prisma.tradingSignal.findFirst({
      where: {
        rcpNo,
        disclosure: { isBackfill: false },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: { corpCode: true, corpName: true, stockCode: true },
        },
      },
    });

    if (!s) return null;

    return {
      id: s.id,
      corpCode: s.corpCode,
      corpName: s.company?.corpName ?? '',
      ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
      eventType: s.eventType,
      grade: mapGrade(s.signal),
      buyScore: s.buyScore,
      entryReady: s.entryReady,
      summary: s.signalSummary ?? undefined,
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DAR-505: 일일 에디션 API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * YYYYMMDD(KST) → UTC 폐구간 [gte, lt).
   * KST 자정 00:00 = UTC 전날 15:00. 하루치 = 24h.
   */
  private kstDateToUtcRange(ymd: string): { gteUtc: Date; ltUtc: Date } {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const gteMs = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000;
    return { gteUtc: new Date(gteMs), ltUtc: new Date(gteMs + 86_400_000) };
  }

  /**
   * 매수등급(STRONG_BUY+BUY) 신호를 KST 폐구간 [gteUtc, ltUtc)로 조회·매핑한다.
   * findAll 매퍼 재사용 — 응답 item에 rcpDt(Disclosure.rcpDt 조인) 추가.
   *
   * DAR-553: TradingSignal 자연키는 (corpCode,rcpNo,eventType,persona) — 공시 1건당
   * 최대 4장(페르소나별)이 개별 카드로 노출돼 같은 종목이 에디션에 중복 표시됐다.
   * corpCode당 대표 1건(최고 buyScore, 동점은 orderBy 그대로 tie-break)으로 dedup하고,
   * 나머지는 personaCount·otherPersonas 메타로 흡수한다(정보 손실 없이 '외 N개 관점' 표기 가능).
   */
  private async findByCreatedRange(gteUtc: Date, ltUtc: Date) {
    const where: Prisma.TradingSignalWhereInput = {
      disclosure: { isBackfill: false },
      signal: { in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE] },
      createdAt: { gte: gteUtc, lt: ltUtc },
    };

    const signals = await this.prisma.tradingSignal.findMany({
      where,
      orderBy: [{ buyScore: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        company: { select: { corpCode: true, corpName: true, stockCode: true } },
        disclosure: { select: { rcpDt: true } },
      },
    });

    // 정렬이 이미 tie-break 규칙(buyScore desc→createdAt desc→id desc)이므로,
    // corpCode별 첫 등장 행이 대표(최고 buyScore)다. Map은 삽입 순서를 보존하므로
    // groups.values() 는 대표들을 원래 정렬 순서 그대로 산출한다(재정렬 불필요).
    const groups = new Map<string, typeof signals>();
    for (const s of signals) {
      const group = groups.get(s.corpCode);
      if (group) {
        group.push(s);
      } else {
        groups.set(s.corpCode, [s]);
      }
    }
    const representatives = [...groups.values()].map((group) => group[0]);

    const sampleCountMap = await this.sampleCountByEventType(
      representatives.map((s) => s.eventType),
    );

    return representatives.map((s) => {
      const group = groups.get(s.corpCode)!;
      const otherPersonas = [...new Set(group.map((g) => g.persona))].filter(
        (persona) => persona !== s.persona,
      );
      return {
        id: s.id,
        corpCode: s.corpCode,
        corpName: s.company?.corpName ?? '',
        ticker: s.company?.stockCode ?? s.stockCode ?? undefined,
        eventType: s.eventType,
        grade: mapGrade(s.signal),
        buyScore: s.buyScore,
        summary: s.signalSummary ?? undefined,
        entryConditions: [
          ...s.entryConditionMet.map((label, i) => ({ id: `met_${i}`, label, required: true, met: true })),
          ...s.entryConditionUnmet.map((label, i) => ({ id: `unmet_${i}`, label, required: true, met: false })),
        ],
        riskFlags: s.riskFactors.map((label, i) => ({ id: `risk_${i}`, label, severity: 'medium' as const })),
        blockedReason: s.blockedReason ?? undefined,
        suppressionReason: s.suppressionReason ?? undefined,
        scoreBreakdown: mapScoreBreakdown(
          s.scoreBreakdown,
          buildSampleNByKey(s.eventType, sampleCountMap),
        ),
        relatedDisclosureRcpNo: s.rcpNo,
        rcpDt: s.disclosure?.rcpDt ?? undefined,
        expiresAt: s.validUntil?.toISOString() ?? undefined,
        createdAt: s.createdAt.toISOString(),
        // DAR-553: 대표 카드 뒤에 흡수된 페르소나 관점 수(대표 포함) + 대표를 제외한 목록.
        personaCount: otherPersonas.length + 1,
        otherPersonas,
      };
    });
  }

  /** RawEditionRow for $queryRaw result. COUNT returns bigint in PostgreSQL. */
  private parseEditionRow(row: {
    date: string;
    count: bigint;
    strongBuyCount: bigint;
    headlineCorpName: string | null;
    topGradeRaw: string | null;
  }) {
    return {
      date: row.date,
      count: Number(row.count),
      strongBuyCount: Number(row.strongBuyCount),
      headlineCorpName: row.headlineCorpName ?? undefined,
      topGrade: row.topGradeRaw ? mapGrade(row.topGradeRaw as SignalGrade) : undefined,
    };
  }

  /**
   * GET /signals/daily-editions — 판단 존재일만 최신순 목록(단일 $queryRaw, AT TIME ZONE 'Asia/Seoul').
   * @param before YYYYMMDD 커서(해당 날짜 미만, 미지정=전체 최신부터)
   * @param limit 페이지 크기 (기본 7, 최대 90)
   */
  async findDailyEditions(before?: string, limit?: number) {
    const STRONG_BUY = SignalGrade.STRONG_BUY_CANDIDATE;
    const BUY = SignalGrade.BUY_CANDIDATE;
    const clampedLimit = Math.min(Math.max(limit ?? 7, 1), 90);
    const todayKst = tradeDateFromMs(Date.now());

    // 커서 조건 — 미지정이면 적용 안 함.
    // ★KST 거래일 환산: "createdAt" 은 `timestamp WITHOUT time zone`(UTC 벽시계 저장)이므로
    //   단일 `AT TIME ZONE 'Asia/Seoul'` 은 UTC 값을 KST 로 오해석해 하루 어긋난다(서버 TZ=UTC).
    //   먼저 `AT TIME ZONE 'UTC'`(UTC 로 해석→instant) 후 `AT TIME ZONE 'Asia/Seoul'`(KST 벽시계)
    //   로 이중 환산해야 세션 TZ 무관하게 정확한 KST 거래일이 나온다. 단순화(단일 환산) 금지.
    const beforeCond = before
      ? Prisma.sql`AND (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date < ${before}::date`
      : Prisma.sql``;

    const [rows, todayCount, latestSig] = await Promise.all([
      this.prisma.$queryRaw<
        {
          date: string;
          count: bigint;
          strongBuyCount: bigint;
          headlineCorpName: string | null;
          topGradeRaw: string | null;
        }[]
      >(Prisma.sql`
        WITH ranked AS (
          -- DAR-553: corpCode당 대표 1건(최고 buyScore, 동점 tie-break 기존 규칙)만 남긴다 —
          -- 공시 1건당 최대 4장(페르소나별)이 개별 신호로 부풀리던 count/headline을 정정.
          SELECT
            (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
            ts.signal::text                                  AS signal,
            ts."buyScore",
            ts."createdAt",
            ts.id,
            c."corpName" AS corp_name,
            ROW_NUMBER() OVER (
              PARTITION BY (ts."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
                           ts."corpCode"
              ORDER BY ts."buyScore" DESC, ts."createdAt" DESC, ts.id DESC
            ) AS rn_corp
          FROM trading_signals ts
          JOIN companies c ON c."corpCode" = ts."corpCode"
          JOIN disclosures d ON d."rcpNo" = ts."rcpNo"
          WHERE d."isBackfill" = false
            AND ts.signal::text IN (${STRONG_BUY}, ${BUY})
            ${beforeCond}
        ),
        corp_reps AS (
          SELECT
            kst_date,
            signal,
            "buyScore",
            corp_name,
            ROW_NUMBER() OVER (
              PARTITION BY kst_date
              ORDER BY "buyScore" DESC, "createdAt" DESC, id DESC
            ) AS rn_day
          FROM ranked
          WHERE rn_corp = 1
        )
        SELECT
          -- date 는 API 계약상 compact 'YYYYMMDD'(todayDate·before 커서와 동일 형식) —
          -- date::text 는 ISO 대시('2026-07-16')라 nextCursor 왕복(before=\d{8})이 깨진다.
          to_char(kst_date, 'YYYYMMDD')                                 AS date,
          COUNT(*)::bigint                                               AS count,
          SUM(CASE WHEN signal = ${STRONG_BUY} THEN 1 ELSE 0 END)::bigint AS "strongBuyCount",
          MAX(CASE WHEN rn_day = 1 THEN corp_name END)                   AS "headlineCorpName",
          MAX(CASE WHEN rn_day = 1 THEN signal    END)                   AS "topGradeRaw"
        FROM corp_reps
        GROUP BY kst_date
        ORDER BY kst_date DESC
        LIMIT ${clampedLimit}
      `),
      this.prisma.tradingSignal.count({
        where: {
          disclosure: { isBackfill: false },
          signal: { in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE] },
          createdAt: {
            gte: this.kstDateToUtcRange(todayKst).gteUtc,
            lt: this.kstDateToUtcRange(todayKst).ltUtc,
          },
        },
      }),
      this.prisma.tradingSignal.findFirst({
        where: {
          disclosure: { isBackfill: false },
          signal: { in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE] },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const items = rows.map((r) => this.parseEditionRow(r));
    const hasMore = items.length === clampedLimit;
    const nextCursor = hasMore ? items[items.length - 1].date : undefined;
    const latestDate = latestSig ? tradeDateFromMs(latestSig.createdAt.getTime()) : null;

    return {
      items,
      meta: {
        latestDate,
        todayDate: todayKst,
        todayHasEdition: todayCount > 0,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * GET /signals/daily/:date — 해당 KST 거래일 매수등급 랭킹 + meta.
   * @param date YYYYMMDD (KST 거래일)
   */
  async findDailyEdition(date: string) {
    const { gteUtc, ltUtc } = this.kstDateToUtcRange(date);
    const todayKst = tradeDateFromMs(Date.now());

    const [items, prevSig, nextSig, firstSig] = await Promise.all([
      this.findByCreatedRange(gteUtc, ltUtc),
      // 이 날짜 UTC 범위 이전의 가장 최근 매수 신호 (prevEditionDate 산출)
      this.prisma.tradingSignal.findFirst({
        where: {
          disclosure: { isBackfill: false },
          signal: { in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE] },
          createdAt: { lt: gteUtc },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      // 이 날짜 UTC 범위 이후의 가장 이른 매수 신호 (nextEditionDate 산출)
      this.prisma.tradingSignal.findFirst({
        where: {
          disclosure: { isBackfill: false },
          signal: { in: [SignalGrade.STRONG_BUY_CANDIDATE, SignalGrade.BUY_CANDIDATE] },
          createdAt: { gte: ltUtc },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      // 시스템 최초 신호 시각 (COLD_START 판정용)
      this.prisma.tradingSignal.findFirst({
        where: { disclosure: { isBackfill: false } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const isEmpty = items.length === 0;
    const isToday = date === todayKst;

    let emptyReason: 'CLOSED' | 'PENDING' | 'QUIET' | 'COLD_START' | 'FUTURE' | undefined;
    if (isEmpty) {
      if (!isTradingDay(date)) {
        // 주말/공휴일은 과거·미래 불문 CLOSED (휴장일에 신호가 생길 일이 없음)
        emptyReason = 'CLOSED';
      } else if (date > todayKst) {
        emptyReason = 'FUTURE';
      } else if (isToday) {
        // 19:15 KST 이전이면 PENDING (engine3 아직 실행 전 휴리스틱)
        const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
        const kstH = kstNow.getUTCHours();
        const kstM = kstNow.getUTCMinutes();
        emptyReason = kstH < 19 || (kstH === 19 && kstM < 15) ? 'PENDING' : 'QUIET';
      } else if (
        firstSig &&
        tradeDateFromMs(firstSig.createdAt.getTime()) > date
      ) {
        emptyReason = 'COLD_START';
      } else {
        emptyReason = 'QUIET';
      }
    }

    const prevEditionDate = prevSig ? tradeDateFromMs(prevSig.createdAt.getTime()) : undefined;
    const nextEditionDate = nextSig ? tradeDateFromMs(nextSig.createdAt.getTime()) : undefined;

    // DAR-551: 빈 에디션 폴백 브리핑. 판단(items)이 없는 거래일에만, '그 KST 거래일 주요 공시'를
    //   meta.fallbackBriefing 으로 분리 노출한다(판단 count 무변경 — 정직 불변식).
    //   휴장(CLOSED)·미래(FUTURE)는 브리핑 대상이 아니므로 조회 자체를 생략한다(불필요 쿼리 0).
    const fallbackBriefing =
      isEmpty && emptyReason !== 'CLOSED' && emptyReason !== 'FUTURE'
        ? await this.buildFallbackBriefing(date)
        : undefined;

    return {
      items,
      meta: {
        date,
        isToday,
        isEmpty,
        emptyReason,
        prevEditionDate,
        nextEditionDate,
        fallbackBriefing,
      },
    };
  }

  /**
   * DAR-551: 그 KST 거래일(rcpDt) 주요 공시 top N 을 중요도 순으로 뽑아 브리핑 항목으로 매핑한다.
   *
   * 중요도 정렬(이슈 명세 순): ①이벤트성(분류된 DisclosureEvent 존재, OTHER 제외)
   *   → ②시총(스키마 미보유 — KOSPI 본판을 대용 프록시로 사용) → ③AI 요약 존재
   *   → ④최신·결정론 tiebreak(rcpNo desc). 랭킹·LIMIT 은 SQL 이 수행(전일 로드 회피).
   *
   * 신규 AI 호출 0: 기존 DisclosureAnalysis(summary task) 캐시(`resultJson->>'summary'`)만 읽는다.
   * 백필 공시(isBackfill=true) 는 라이브 표면 불가침 원칙에 따라 제외한다.
   * rcpDt 범위는 인덱스 친화적 [date, nextYmd) 문자열 범위로 조회한다(prefix LIKE 회피).
   */
  private async buildFallbackBriefing(date: string): Promise<FallbackBriefingItem[]> {
    const nextYmd = this.nextYmd(date);
    const rows = await this.prisma.$queryRaw<FallbackBriefingRow[]>(Prisma.sql`
      SELECT
        d."rcpNo"                    AS "rcpNo",
        d."corpName"                 AS "corpName",
        d."reportName"               AS "reportName",
        e."eventType"::text          AS "eventType",
        a."resultJson"->>'summary'   AS "summaryText"
      FROM disclosures d
      JOIN companies c              ON c."corpCode" = d."corpCode"
      LEFT JOIN disclosure_events e ON e."rcpNo"   = d."rcpNo"
      -- summary task 는 (rcpNo, task) UNIQUE 이므로 rcpNo 당 ≤1행(중복 없음)
      LEFT JOIN disclosure_analyses a
        ON a."rcpNo" = d."rcpNo" AND a."task"::text = 'summary'
      WHERE d."isBackfill" = false
        AND d."rcpDt" >= ${date}
        AND d."rcpDt" <  ${nextYmd}
      ORDER BY
        (e."eventType" IS NOT NULL AND e."eventType"::text <> 'OTHER') DESC, -- ①이벤트성
        (c."market" = 'KOSPI') DESC,                                        -- ②시총(대용 프록시)
        ((a."resultJson"->>'summary') IS NOT NULL) DESC,                    -- ③AI 요약 존재
        d."rcpNo" DESC                                                      -- ④최신·결정론 tiebreak
      LIMIT ${FALLBACK_BRIEFING_LIMIT}
    `);
    return buildFallbackBriefingItems(rows);
  }

  /** YYYYMMDD 의 다음 날(YYYYMMDD). rcpDt 문자열 상한(반개구간 [date, nextYmd)) 산출용. */
  private nextYmd(ymd: string): string {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(next.getUTCDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  // DAR-559: where·take·사용자 스코프 없는 전량조회가 axios 10s를 넘겨 매도 탭이
  //   "백엔드 연결 실패"로 낙하했다(모의매매 5+트랙이 청산당 1행 상시 적재). OPEN 포지션·
  //   요청자 소유로 한정하고 positionId당 최신 1건(distinct는 orderBy 적용 후 첫 행을 취하므로
  //   createdAt desc 정렬 뒤 dedupe = 최신행 보존)만 take 50 상한으로 반환한다.
  async findExitSignals(userId: string) {
    const exitSignals = await this.prisma.exitSignal.findMany({
      where: {
        position: {
          status: 'OPEN',
          portfolio: { userId },
        },
      },
      distinct: ['positionId'],
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        position: {
          select: {
            id: true,
            corpCode: true,
            unrealizedPnlPct: true,
            company: {
              select: { corpName: true, stockCode: true },
            },
          },
        },
      },
    });

    return exitSignals.map((e) => {
      const action = e.exitAction as ExitAction;
      return {
        id: e.id,
        corpCode: e.position?.corpCode ?? '',
        corpName: e.position?.company?.corpName ?? '',
        ticker: e.position?.company?.stockCode ?? undefined,
        exitScore: e.exitScore,
        action,
        reasons: mapExitReasons({
          lossRiskScore: e.lossRiskScore,
          thesisBreakScore: e.thesisBreakScore,
          chartBreakScore: e.chartBreakScore,
          timeExceededScore: e.timeExceededScore,
        }),
        pnlPercent: e.position?.unrealizedPnlPct ?? undefined,
        blockRebuy: action === ExitAction.BLOCK_REBUY,
        createdAt: e.createdAt.toISOString(),
      };
    });
  }
}
