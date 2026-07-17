import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostGateService } from '../cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from '../usage-log/ai-usage-log.service';
import {
  DisclosureReactionStatsResponse,
  DisclosureReactionStatsService,
} from '../../engine3-quant-market/event-study/disclosure-reaction-stats.service';
import { AiGateInput, AiCostLevel, TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { estimateCostUsd } from '../pricing/estimate-cost';
import { buildExcerpt } from '../input/build-minimal-input';
import { formatKstDateCompact, kstDayStart } from '../../common/time/kst';
import { PriceMoveReasonJobData } from '../../common/queues/queue.constants';
import {
  PriceMoveReasoningTask,
  PriceMoveReasoningDraft,
  ReactionStatSummary,
} from './price-move-reasoning.task';
import {
  PriceMoveReasoningRecord,
  PriceMoveReasoningRepository,
} from './price-move-reasoning.repository';
import {
  NO_DISCLOSURE_LABEL,
  PRICE_MOVE_REASONING_DAILY_LIMIT_ENV,
  PRICE_MOVE_REASONING_DEFAULT_DAILY_LIMIT_USD,
  PRICE_MOVE_REASONING_LOOKBACK_HOURS,
  PRICE_MOVE_REASONING_TASK,
} from './price-move-reasoning.constants';
import { ANNUAL_REPRT_CODE, buildFinancialContext } from './price-move-financial-context';

/** AIUsageLog.task Prisma enum 값(역방향 리즈닝). */
const PRISMA_TASK = 'price_move_reasoning';

/** 부호 포함 등락률 표기(설명 텍스트용). */
function signedPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * DAR-522 (Wave C1·P0) — PRICE_MOVE 역방향 리즈닝 오케스트레이터.
 *
 * engine3 price-move-alert 발화(등락 이벤트) 1건마다:
 *   1) refId 멱등 캐시 — 이미 처리했으면 AI 재호출 0.
 *   2) 48h 내 해당 종목 공시 조회(백필 제외).
 *   3) 무공시 → ★AI 호출 0, '관련 공시 없음(48h)' 포맷 응답(분석 위장 금지, 수용기준 1).
 *   4) 일일 비용 상한(env) 초과 → AI 호출 0(CAP_SKIPPED, 수용기준 2).
 *   5) 비용게이트 L0~L3 편입 + 전역 한도가드(L0 강등 시 스킵).
 *   6) 공시 이벤트 + 등락 방향 + EventStudy 유사사례 통계 → AI 원인 해석(설명층 한정).
 *   7) AIUsageLog 기록(누락 0) + refId 멱등 저장.
 *
 * ★AI 금지영역 불가침(수용기준 3): 산출=설명(원인 해석·근거)뿐 — 주문·점수·하드룰 무접점.
 */
@Injectable()
export class PriceMoveReasoningService {
  private readonly logger = new Logger(PriceMoveReasoningService.name);

  /** 이 태스크 전용 일일 비용 상한(USD) — env PRICE_MOVE_REASONING_DAILY_USD_LIMIT. */
  private readonly dailyLimitUsd: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: AiCostGateService,
    private readonly limitGuard: AiCostLimitGuardService,
    private readonly usageLog: AiUsageLogService,
    private readonly reactionStats: DisclosureReactionStatsService,
    private readonly task: PriceMoveReasoningTask,
    private readonly repo: PriceMoveReasoningRepository,
    config: ConfigService,
  ) {
    const raw = Number(config.get<string>(PRICE_MOVE_REASONING_DAILY_LIMIT_ENV));
    this.dailyLimitUsd =
      Number.isFinite(raw) && raw > 0 ? raw : PRICE_MOVE_REASONING_DEFAULT_DAILY_LIMIT_USD;
  }

  /**
   * 등락 이벤트 1건의 역방향 리즈닝. @param now 테스트 주입 가능(미지정 시 실제 시각).
   */
  async reason(
    event: PriceMoveReasonJobData,
    now: Date = new Date(),
  ): Promise<PriceMoveReasoningRecord> {
    const { refId, corpCode, stockCode, corpName, tradeDate, changePct } = event;

    // 1) 멱등 캐시 — 이미 처리한 등락 이벤트면 AI 재호출 없이 반환.
    const cached = await this.repo.find(refId);
    if (cached) {
      this.logger.debug(`[PMReason] 멱등 캐시 히트 refId=${refId} (status=${cached.status})`);
      return cached;
    }

    // 2) 48h 공시 유무 — engine3 팩트체크와 동일 창(48h·백필 제외). rcpDt 는 사전식=시간순.
    const from48h = formatKstDateCompact(
      new Date(now.getTime() - PRICE_MOVE_REASONING_LOOKBACK_HOURS * 3600 * 1000),
    );
    const primary = await this.prisma.disclosure.findFirst({
      where: { corpCode, isBackfill: false, rcpDt: { gte: from48h } },
      orderBy: { rcpDt: 'desc' },
      select: { rcpNo: true, reportName: true },
    });

    // 3) 무공시 → AI 호출 0, '관련 공시 없음(48h)' 포맷 응답(분석 위장 금지).
    if (!primary) {
      this.logger.log(`[PMReason] 무공시(48h) refId=${refId} → AI 호출 0, 포맷 응답`);
      return this.persist(
        {
          refId,
          stockCode,
          corpCode,
          tradeDate,
          changePct,
          rcpNo: null,
          status: 'NO_DISCLOSURE',
          level: null,
          resultJson: {
            status: 'NO_DISCLOSURE',
            label: NO_DISCLOSURE_LABEL,
            message: `${corpName} ${signedPct(changePct)} — ${NO_DISCLOSURE_LABEL}`,
          },
        },
        now,
      );
    }

    // 4) 일일 비용 상한(env) — 오늘 이 태스크 누적 비용이 상한 이상이면 AI 호출 0.
    const spentToday = await this.spentTodayUsd(now);
    if (spentToday >= this.dailyLimitUsd) {
      this.logger.warn(
        `[PMReason] 일일 비용 상한 도달 ($${spentToday.toFixed(4)} ≥ $${this.dailyLimitUsd}) → AI 스킵 refId=${refId}`,
      );
      return this.capSkipped(event, primary.rcpNo, '일일 비용 상한 도달 — 원인 해석 보류', now);
    }

    // 5) 비용게이트 L0~L3 편입 + 전역 한도가드.
    const gateInput: AiGateInput = {
      isManagementStock: false,
      isTargetEventType: true, // 48h 공시 존재 확정
      tradingValue: 0, // 게이트 임계=0(전수분석) — 이 값으로 L0 강등되지 않음
      confidence: 0.7, // ±5% 실현 = 강한 현실 확인
      polarity: changePct >= 0 ? 'POSITIVE' : 'NEGATIVE',
    };
    const proposed = this.gate.evaluateGate(gateInput);
    const reservation = await this.limitGuard.enforceLimit(proposed);
    const level = reservation.level;

    try {
      // 전역 AI 비용 한도 초과로 L0 강등 → AI 스킵.
      if (level === AiCostLevel.L0) {
        this.logger.warn(`[PMReason] 전역 비용 한도(L0 강등) → AI 스킵 refId=${refId}`);
        return this.capSkipped(event, primary.rcpNo, '전역 AI 비용 한도 — 원인 해석 보류', now);
      }

      // 6) 입력 충실화: 이벤트 유형·추출수치·원문 핵심 단락·EventStudy 유사사례 통계·연매출(재무 맥락).
      const [eventRow, doc, statsResp, annualFin] = await Promise.all([
        this.prisma.disclosureEvent.findUnique({
          where: { rcpNo: primary.rcpNo },
          select: { eventType: true, extractedData: true },
        }),
        this.prisma.disclosureDocument.findUnique({
          where: { rcpNo: primary.rcpNo },
          select: { rawText: true },
        }),
        this.reactionStats.getReactionStatsByRcpNo(primary.rcpNo),
        this.latestAnnualRevenue(corpCode),
      ]);
      const eventType = eventRow?.eventType ?? 'UNKNOWN';
      const excerpt = doc?.rawText ? buildExcerpt(doc.rawText) : '';
      const reactionStats = this.toStatSummary(statsResp);

      // DAR-528 — 재무 맥락 한 줄(규칙 기반·AI 무접점). 분자(공시 규모)·분모(연매출)
      // 중 하나라도 결측/불확실이면 null → 표시 생략(수치 발명 금지).
      const financialContext = buildFinancialContext({
        eventType,
        extractedData: eventRow?.extractedData ?? null,
        annualRevenueWon: annualFin.revenueWon,
        annualRevenueYear: annualFin.year,
      });

      // 7) AI Task 실행(설명층 한정). 파싱 실패 시에도 usage 를 먼저 기록(누락 0)한다.
      const { result, usage } = await this.runTaskPreservingUsage(primary.rcpNo, level, () =>
        this.task.run({
          rcpNo: primary.rcpNo,
          corpName,
          changePct,
          direction: changePct >= 0 ? 'UP' : 'DOWN',
          eventType,
          disclosureTitle: primary.reportName,
          excerpt,
          reactionStats,
        }),
      );

      // 8) AIUsageLog 기록(누락 0).
      await this.usageLog.logUsage({
        rcpNo: primary.rcpNo,
        task: PRICE_MOVE_REASONING_TASK,
        level,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: estimateCostUsd(usage),
      });

      // 9) refId 멱등 저장(rcpNo × 등락 이벤트).
      this.logger.log(
        `[PMReason] 원인 해석 완료 refId=${refId} rcpNo=${primary.rcpNo} level=${level} linkage=${result.eventLinkage}`,
      );
      return this.persist(
        {
          refId,
          stockCode,
          corpCode,
          tradeDate,
          changePct,
          rcpNo: primary.rcpNo,
          status: 'ANALYZED',
          level,
          resultJson: { status: 'ANALYZED', eventType, ...result, financialContext },
        },
        now,
      );
    } finally {
      reservation.settle(); // DAR-242 — 인플라이트 예약 항상 해제.
    }
  }

  /**
   * DAR-528 — 재무 맥락 분모(연매출) 조회. 연간 보고서(reprtCode=11011)의 매출만 인정한다
   * (분기/반기 누적 부분치는 '연매출' 분모로 불확실 → 배제). 연결(CFS) 우선, 없으면 별도(OFS).
   * 결측 시 revenueWon=null → 재무 맥락 표시 생략(분모 불확실, 수치 발명 금지).
   * ★DB 경유 읽기(엔진 간 통신 규약) — AI·비용게이트·AIUsageLog 무접점.
   */
  private async latestAnnualRevenue(
    corpCode: string,
  ): Promise<{ revenueWon: number | null; year: string | null }> {
    const row = await this.prisma.companyFinancial.findFirst({
      where: { corpCode, reprtCode: ANNUAL_REPRT_CODE, revenue: { not: null } },
      orderBy: [{ bsnsYear: 'desc' }, { fsDiv: 'asc' }], // fsDiv asc → 'CFS' < 'OFS'(연결 우선)
      select: { revenue: true, bsnsYear: true },
    });
    if (!row || row.revenue === null) return { revenueWon: null, year: null };
    // revenue 는 BigInt(원). 조 단위(≤~10^13)로 Number.MAX_SAFE_INTEGER(9×10^15) 내 안전 변환.
    return { revenueWon: Number(row.revenue), year: row.bsnsYear };
  }

  /** 오늘(KST) 이 태스크 누적 실호출 비용(USD) — cacheHit 제외. */
  private async spentTodayUsd(now: Date): Promise<number> {
    const dayStart = kstDayStart(now);
    const agg = await this.prisma.aIUsageLog.aggregate({
      where: { task: PRISMA_TASK as never, cacheHit: false, createdAt: { gte: dayStart } },
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd ?? 0;
  }

  /** 파싱 실패 시 usage 를 먼저 기록(AIUsageLog 누락 0)한 뒤 그대로 전파(BullMQ 재시도). */
  private async runTaskPreservingUsage(
    rcpNo: string,
    level: AiCostLevel,
    run: () => Promise<TaskRunResult<PriceMoveReasoningDraft>>,
  ): Promise<TaskRunResult<PriceMoveReasoningDraft>> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof TaskParseFailureError) {
        await this.usageLog.logUsage({
          rcpNo,
          task: PRICE_MOVE_REASONING_TASK,
          level,
          model: err.usage.model,
          inputTokens: err.usage.inputTokens,
          outputTokens: err.usage.outputTokens,
          costUsd: estimateCostUsd(err.usage),
        });
      }
      throw err;
    }
  }

  /** 비용 상한 스킵 결과 저장(AI 호출 0). */
  private capSkipped(
    event: PriceMoveReasonJobData,
    rcpNo: string,
    message: string,
    now: Date,
  ): Promise<PriceMoveReasoningRecord> {
    return this.persist(
      {
        refId: event.refId,
        stockCode: event.stockCode,
        corpCode: event.corpCode,
        tradeDate: event.tradeDate,
        changePct: event.changePct,
        rcpNo,
        status: 'CAP_SKIPPED',
        level: null,
        resultJson: { status: 'CAP_SKIPPED', message },
      },
      now,
    );
  }

  /** DisclosureReactionStats 응답 → 프롬프트 통계(n≥30 게이트 통과분만, 아니면 null). */
  private toStatSummary(resp: DisclosureReactionStatsResponse): ReactionStatSummary | null {
    const r = resp.results[0];
    if (!r || !r.stats) return null;
    return {
      eventType: r.eventType,
      sampleCount: r.sampleCount,
      d1: { ...r.stats.d1 },
      d5: { ...r.stats.d5 },
      d20: { ...r.stats.d20 },
    };
  }

  private async persist(
    partial: Omit<PriceMoveReasoningRecord, 'createdAt'>,
    now: Date,
  ): Promise<PriceMoveReasoningRecord> {
    const record: PriceMoveReasoningRecord = { ...partial, createdAt: now };
    await this.repo.save(record);
    return record;
  }
}
