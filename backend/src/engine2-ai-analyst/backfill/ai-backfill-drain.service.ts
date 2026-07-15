// backend/src/engine2-ai-analyst/backfill/ai-backfill-drain.service.ts
// DAR-379: AI 평가 백필 드레이너 — 과거 미분석 공시를 비용게이트 내에서 점진 드레인.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExtractionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import {
  QUEUE,
  JOB,
  AI_ANALYZE_JOB_OPTIONS,
  aiAnalyzeJobId,
  AiAnalyzeJobData,
} from '../../common/queues/queue.constants';
// W4 신호 검증: 제목 기반 백필 관측치(TITLE_ONLY) 구분 마커 — engine1(DisclosureEvent 소유)의
//   데이터 계약 상수 import(서비스 직접 호출 아님). 해당 관측치는 AI 백필 대상에서 제외한다.
import { TITLE_ONLY_BACKFILL_MARKER } from '../../engine1-disclosure/pipeline/title-event-backfill.constants';

/** summary 태스크는 AI 분석 파이프라인의 필수 진입 게이트. 미존재 = 미분석 공시. */
const SUMMARY_TASK = 'summary' as const;

/**
 * 1회 드레인에서 큐에 발행할 최대 후보 수의 하드 상한.
 * 예산 추정과 무관히 큐 적재 폭주를 막는 안전 캡(타 스케줄러 RECOVERY_BATCH=200과 정합).
 */
const MAX_BATCH_PER_RUN = 200;

/**
 * 공시 1건 AI 백필의 보수적 비용 추정치($). 실측 평균(<$0.005, AiCostAcceptance)의
 * 약 2배 헤드룸을 둬 과소추정으로 인한 폭주를 방지한다.
 * ★주의: 이 값은 큐 적재 페이싱용 '소프트' 추정일 뿐이다. 실제 일 $1 캡의 하드 보장은
 *   AiCostLimitGuard.enforceLimit(호출별 L0 강등)이 담당한다 — 추정이 빗나가도 비용은
 *   캡을 넘지 못한다(이중 방어).
 */
const ESTIMATED_COST_PER_DISCLOSURE_USD = 0.01;

/** AI 백필 드레인 1회 결과 — 관측·테스트·recorder itemCount 입력. */
export interface AiBackfillDrainResult {
  /** 후보 조회 결과 건수(큐 발행 시도 대상). */
  scanned: number;
  /** 실제 큐에 발행한 잡 수(=AI 분석 트리거). recorder itemCount. */
  enqueued: number;
  /** true = 일/월 예산 소진(또는 예산상 0건)으로 이번 회차 발행 생략(폭주 방지). */
  skippedByBudget: boolean;
  /** 이번 회차 예산으로 허용된 배치 상한(MAX_BATCH_PER_RUN ∩ 예산추정). */
  budgetBatchLimit: number;
  /** 판정 시점 당일 누적 AI 비용($) — 정직 로그. */
  dailyCostUsd: number;
  /** 일 한도($). */
  dailyLimitUsd: number;
  /** AI_ANALYZE 큐 주입 여부(Redis 미가용 환경에서 false → 발행 생략). */
  queueAvailable: boolean;
}

/** drainOnce 옵션. */
export interface AiBackfillDrainOptions {
  /** 예산 추정 배치 상한을 덮어쓰는 명시 한도(수동/테스트용). 미지정 시 예산 추정 사용. */
  limit?: number;
}

/**
 * AiBackfillDrainService (DAR-379) — 과거 미분석 공시 AI 평가 백필 드레이너.
 *
 * ★목적: 이벤트 추출은 SUCCESS/NEEDS_REVIEW 이나 아직 AI 분석(summary)이 없는 과거 공시를
 *   비용게이트 내에서 점진적으로 드레인해 'AI 평가자료(사전)' 커버리지를 끌어올린다.
 *   이 평가자료는 추후 EventStudy 실현결과(사후)와 결합되어 calibration(점수 튜닝) 근거가 된다.
 *
 * ★기존 인프라 재사용(신규 발명 최소):
 *   - 발행 경로: 기존 AI_ANALYZE 큐 + EventExtractedConsumer(summary/persona/thesis 실행).
 *   - 멱등: aiAnalyzeJobId(rcpNo) 자연키 + consumer 의 (rcpNo,task) 캐시 → 중복 LLM 호출 0.
 *   - AIUsageLog: consumer 가 모든 호출/스킵을 기록(누락 0) — 본 서비스는 발행만 한다.
 *   - 비용 캡: AiCostLimitGuard 가 호출별 enforceLimit 로 일 $1/월 $20 하드 캡(L0 강등).
 *
 * ★왜 신규 드레이너인가(PipelineIntegrityService.reprocessMissingAi 가 이미 있는데):
 *   기존 reprocessMissingAi 는 '수동 전용·cron 미연결'이다. 이유는 예산 소진 시에도 L0 스킵
 *   대상을 무한 재발행하면 큐 노이즈가 되기 때문. 본 드레이너는 그 문제를 정조준한다 —
 *   당일 예산이 소진됐으면(dailyExceeded) 아예 발행하지 않고(skippedByBudget) 즉시 빠지며,
 *   예산이 남았을 때만 그 잔액이 감당할 만큼만 배치 발행한다. 예산이 있을 때만 진척하므로
 *   'L0 무한 재발행 노이즈' 없이 일자별로 안전하게 적체를 드레인한다.
 */
@Injectable()
export class AiBackfillDrainService {
  private readonly logger = new Logger(AiBackfillDrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costGuard: AiCostLimitGuardService,
    // @Optional: Redis/큐 미가용 환경(일부 테스트)에서도 동작. 미주입 시 발행 생략.
    @Optional()
    @InjectQueue(QUEUE.AI_ANALYZE)
    private readonly aiQueue: Queue | null = null,
  ) {}

  /**
   * 1회 드레인: 예산 잔액이 감당하는 만큼만 미분석 공시를 큐에 발행한다.
   * 예산 소진/0건이면 발행 없이 skippedByBudget=true 로 반환(폭주·노이즈 방지).
   */
  async drainOnce(
    options: AiBackfillDrainOptions = {},
  ): Promise<AiBackfillDrainResult> {
    const status = await this.costGuard.getLimitStatus();
    const queueAvailable = this.aiQueue !== null;

    // 예산 추정 배치 상한 — 잔액이 추정 단가로 감당하는 건수, 하드 캡으로 클램프.
    const remainingDaily = Math.max(
      0,
      status.dailyLimitUsd - status.dailyCostUsd,
    );
    const affordable = Math.floor(
      remainingDaily / ESTIMATED_COST_PER_DISCLOSURE_USD,
    );
    const budgetBatchLimit = Math.min(
      MAX_BATCH_PER_RUN,
      Math.max(0, affordable),
    );

    // 명시 한도(수동/테스트)가 있으면 예산 상한과 함께 더 작은 쪽을 택한다(안전).
    const effectiveLimit =
      options.limit !== undefined
        ? Math.max(0, Math.min(options.limit, budgetBatchLimit))
        : budgetBatchLimit;

    const baseResult = {
      budgetBatchLimit,
      dailyCostUsd: status.dailyCostUsd,
      dailyLimitUsd: status.dailyLimitUsd,
      queueAvailable,
    };

    // 일/월 예산 소진 또는 예산상 0건 → 발행 생략(정직 로그). 예산 회복 시 다음 회차 진척.
    if (
      status.dailyExceeded ||
      status.monthlyExceeded ||
      effectiveLimit === 0
    ) {
      this.logger.log(
        `AI 백필 드레인 생략(예산): 일비용=$${status.dailyCostUsd.toFixed(4)}/` +
          `$${status.dailyLimitUsd} dailyExceeded=${status.dailyExceeded} ` +
          `monthlyExceeded=${status.monthlyExceeded} 배치상한=${effectiveLimit}`,
      );
      return { ...baseResult, scanned: 0, enqueued: 0, skippedByBudget: true };
    }

    const candidates = await this.findDisclosuresNeedingAi(effectiveLimit);
    if (candidates.length === 0) {
      this.logger.log('AI 백필 드레인: 미분석 후보 0건 — 적체 없음');
      return {
        ...baseResult,
        scanned: 0,
        enqueued: 0,
        skippedByBudget: false,
      };
    }

    if (!this.aiQueue) {
      this.logger.warn(
        `AI 큐 미가용 — 백필 발행 생략(후보=${candidates.length}, enqueued=0)`,
      );
      return {
        ...baseResult,
        scanned: candidates.length,
        enqueued: 0,
        skippedByBudget: false,
      };
    }

    let enqueued = 0;
    for (const ev of candidates) {
      const payload: AiAnalyzeJobData = {
        rcpNo: ev.rcpNo,
        corpCode: ev.corpCode,
        eventType: ev.eventType,
        polarity: ev.polarity,
        confidence: ev.confidence,
        isAiAssisted: ev.isAiAssisted,
      };
      // 이벤트추출 경로와 동일 자연키(ai-<rcpNo>)로 발행 → 중복 잡 적재 방지(멱등).
      await this.aiQueue.add(JOB.EVENT_EXTRACTED, payload, {
        ...AI_ANALYZE_JOB_OPTIONS,
        jobId: aiAnalyzeJobId(ev.rcpNo),
      });
      enqueued++;
    }

    this.logger.log(
      `AI 백필 드레인: 후보=${candidates.length} 발행=${enqueued} ` +
        `배치상한=${effectiveLimit} 일비용=$${status.dailyCostUsd.toFixed(4)}/$${status.dailyLimitUsd}`,
    );
    return {
      ...baseResult,
      scanned: candidates.length,
      enqueued,
      skippedByBudget: false,
    };
  }

  /**
   * 이벤트 추출은 됐으나(SUCCESS/NEEDS_REVIEW) summary AI 분석이 없는 과거 공시를
   * 오래된 순(extractedAt asc)으로 조회한다 — 시간순 코퍼스 누적에 유리.
   * (기존 PipelineIntegrityService.findEligibleEventsWithoutSummary 와 동일 술어 — DB 직접 조회.)
   */
  private async findDisclosuresNeedingAi(limit: number) {
    return this.prisma.disclosureEvent.findMany({
      where: {
        extractionStatus: {
          in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
        },
        // W4 신호 검증: 제목 기반 백필(TITLE_ONLY) 관측치는 AI 백필 대상에서 제외 —
        //   수만 건 과거 백필이 일 예산($1)을 잠식해 라이브 AI 카드가 굶는 것을 방지한다
        //   (Event Study 전용 관측치 — extractedData 가 비어 AI 입력 계약도 못 채운다).
        //   null 분기를 명시해 Prisma not-null 의미론과 무관하게 기존 행을 전부 보존한다.
        AND: [
          {
            OR: [
              { failReason: null },
              { failReason: { not: TITLE_ONLY_BACKFILL_MARKER } },
            ],
          },
        ],
        disclosure: {
          disclosureAnalyses: { none: { task: SUMMARY_TASK } },
        },
      },
      take: limit,
      orderBy: { extractedAt: 'asc' },
      select: {
        rcpNo: true,
        corpCode: true,
        eventType: true,
        polarity: true,
        confidence: true,
        isAiAssisted: true,
      },
    });
  }
}
