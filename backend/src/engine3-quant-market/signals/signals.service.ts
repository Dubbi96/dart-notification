import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SignalGrade, ExitAction, Prisma } from '@prisma/client';

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

    const sampleCountByEventType = await this.sampleCountByEventType([
      s.eventType,
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
      relatedDisclosureRcpNo: s.rcpNo,
      expiresAt: s.validUntil?.toISOString() ?? undefined,
      createdAt: s.createdAt.toISOString(),
    };
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

  async findExitSignals() {
    const exitSignals = await this.prisma.exitSignal.findMany({
      orderBy: { createdAt: 'desc' },
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
