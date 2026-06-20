import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExtractionStatus, ParseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
// DAR-293: 파싱 재시도 캡 SSOT — disclosure-documents.service와 공유(발산 방지)
import { PARSE_MAX_RETRY } from '../disclosure-documents/disclosure-documents.constants';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
import {
  QUEUE,
  JOB,
  AiAnalyzeJobData,
  AI_ANALYZE_JOB_OPTIONS,
  aiAnalyzeJobId,
} from '../../common/queues/queue.constants';
import {
  AiReprocessResult,
  DrainProgress,
  PipelineDrainResult,
  PipelineFailureRow,
  PipelineHealth,
} from './pipeline.types';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 폐루프 1회 backfill 시 단계별 처리 상한(과도 부하 방지). */
const DEFAULT_DRAIN_LIMIT = 100;

/**
 * DAR-392 ETA 추정용 분당 공칭 파싱 처리량(성공 건/분).
 * 실측(drain limit500 ≈ parse 200·성공 ~144·56s → ~150/분)에서 보수적으로 잡은 상수.
 * ★거친 추정 — 실제는 DART 레이트리밋/쿼터·적응형 백오프에 따라 달라진다.
 */
const NOMINAL_PARSE_PER_MINUTE = 140;
/** AI 재발행(수동) 1회 상한. */
const DEFAULT_AI_REPROCESS_LIMIT = 100;
/** 실패/적체 가시화 행 상한. */
const RECENT_FAILURES_LIMIT = 20;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** summary 분석 task 식별자(Prisma AiTaskName.summary). 자연키 (rcpNo,task) 유니크. */
const SUMMARY_TASK = 'summary' as const;

/**
 * PipelineIntegrityService (DAR-126) — 수집→파싱→이벤트→AI 폐루프 견고화.
 *
 * 두 가지 책임:
 *  1. 관측(read-only): 단계별 건수·지연·실패 행을 집계해 /pipeline/health·/ops/metrics 로 노출.
 *  2. 누락 backfill(멱등): 단계 전이에서 빠진 행을 재처리한다.
 *     - 수집됐으나 파싱 큐 미등록(missingDocument) → enqueueParsing
 *     - PENDING 파싱 → processPendingBatch(파싱 후 이벤트·AI 자동 체이닝)
 *     - 파싱 DONE 이나 이벤트 없음/PENDING → processPendingDisclosures(이벤트 후 AI 체이닝)
 *
 * ★전제 발견(DAR-126 근본원인): 수집기는 신규 rcpNo를 enqueueParsing(PENDING upsert)만 하고,
 *   PENDING 문서를 실제로 드레인하는 cron이 없었다(ParseRetryScheduler는 FAILED만 대상).
 *   따라서 PENDING 문서가 무한 적체될 수 있었다 → 본 서비스+PipelineDrainScheduler가 폐루프를 닫는다.
 *
 * ★멱등: 모든 backfill은 upsert/상태조건 기반이라 반복 실행해도 중복 부작용이 없다.
 * ★AI 미개입: 집계는 순수 DB 카운트. backfill의 AI는 기존 큐 체이닝을 그대로 탄다(신규 호출 0).
 */
@Injectable()
export class PipelineIntegrityService {
  private readonly logger = new Logger(PipelineIntegrityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DisclosureDocumentsService,
    private readonly eventsService: DisclosureEventsService,
    // @Optional: Redis/큐 미배포 환경(테스트 등)에서도 동작. 미주입 시 AI 재발행만 생략.
    @Optional()
    @InjectQueue(QUEUE.AI_ANALYZE)
    private readonly aiQueue: Queue | null = null,
  ) {}

  // ─── 관측(read-only) ───────────────────────────────────────────────────────

  /**
   * 파이프라인 폐루프 헬스 스냅샷. `now` 주입 가능(테스트 결정론).
   * 모든 집계는 read-only — 부작용 0.
   */
  async getHealth(now: Date = new Date()): Promise<PipelineHealth> {
    const since24h = new Date(now.getTime() - MS_PER_DAY);

    const [
      disclosureTotal,
      disclosureLast24h,
      missingDocument,
      parseGroups,
      retryable,
      oldestPendingDoc,
      eventGroups,
      missingForParsedDocs,
      oldestPendingEvent,
      eligibleEvents,
      summarized,
      awaitingSummary,
      recentFailures,
    ] = await Promise.all([
      this.prisma.disclosure.count(),
      this.prisma.disclosure.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.disclosure.count({ where: { document: { is: null } } }),
      this.prisma.disclosureDocument.groupBy({
        by: ['parseStatus'],
        _count: { _all: true },
      }),
      this.prisma.disclosureDocument.count({
        where: {
          parseStatus: {
            in: [ParseStatus.FETCH_FAILED, ParseStatus.PARSE_FAILED],
          },
          retryCount: { lt: PARSE_MAX_RETRY },
        },
      }),
      this.prisma.disclosureDocument.findFirst({
        where: { parseStatus: ParseStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.disclosureEvent.groupBy({
        by: ['extractionStatus'],
        _count: { _all: true },
      }),
      this.countParsedDocsWithoutEvent(),
      this.prisma.disclosureEvent.findFirst({
        where: { extractionStatus: ExtractionStatus.PENDING },
        orderBy: { extractedAt: 'asc' },
        select: { extractedAt: true },
      }),
      this.prisma.disclosureEvent.count({
        where: {
          extractionStatus: {
            in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
          },
        },
      }),
      this.prisma.disclosureAnalysis.count({ where: { task: SUMMARY_TASK } }),
      this.countEligibleEventsWithoutSummary(),
      this.collectRecentFailures(),
    ]);

    const parse = this.tallyParse(parseGroups);
    const event = this.tallyEvents(eventGroups);

    return {
      generatedAt: now.toISOString(),
      collection: {
        total: disclosureTotal,
        last24h: disclosureLast24h,
        missingDocument,
      },
      parsing: {
        ...parse,
        retryable,
        oldestPendingAgeMinutes: ageMinutes(oldestPendingDoc?.createdAt, now),
      },
      events: {
        ...event,
        missingForParsedDocs,
        oldestPendingAgeMinutes: ageMinutes(
          oldestPendingEvent?.extractedAt,
          now,
        ),
      },
      ai: {
        eligibleEvents,
        summarized,
        awaitingSummary,
      },
      recentFailures,
    };
  }

  /**
   * DAR-392 드레인 진행 리포트(read-only) — 백데이터 fetch→parse 적체 소진 가시성.
   * 문서 파싱 DONE%·잔여 백로그·ETA 를 노출해 '차주 장 전 풀커버' 진척을 추적한다.
   * `now` 주입 가능(테스트 결정론). 부작용 0.
   */
  async getDrainProgress(now: Date = new Date()): Promise<DrainProgress> {
    const [parseGroups, retryable, missingDocument, eligibleEvents] =
      await Promise.all([
        this.prisma.disclosureDocument.groupBy({
          by: ['parseStatus'],
          _count: { _all: true },
        }),
        this.prisma.disclosureDocument.count({
          where: {
            parseStatus: {
              in: [ParseStatus.FETCH_FAILED, ParseStatus.PARSE_FAILED],
            },
            retryCount: { lt: PARSE_MAX_RETRY },
          },
        }),
        this.prisma.disclosure.count({ where: { document: { is: null } } }),
        this.prisma.disclosureEvent.count({
          where: {
            extractionStatus: {
              in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
            },
          },
        }),
      ]);

    const parse = this.tallyParse(parseGroups);
    const totalDocuments =
      parse.pending +
      parse.fetching +
      parse.parsing +
      parse.done +
      parse.fetchFailed +
      parse.parseFailed +
      parse.skipped;
    const pending = parse.pending + parse.fetching + parse.parsing;
    const donePercent =
      totalDocuments > 0
        ? Math.round((parse.done / totalDocuments) * 1000) / 10
        : 0;

    // ETA: 잔여 백로그(미파싱 문서 + 아직 큐에 없는 공시) / 공칭 처리량.
    const backlog = pending + missingDocument;
    const etaHours =
      backlog > 0
        ? Math.round((backlog / NOMINAL_PARSE_PER_MINUTE / 60) * 10) / 10
        : 0;

    return {
      generatedAt: now.toISOString(),
      parse: {
        totalDocuments,
        done: parse.done,
        pending,
        retryable,
        donePercent,
      },
      missingDocument,
      eligibleEvents,
      nominalParsePerMinute: NOMINAL_PARSE_PER_MINUTE,
      etaHours,
    };
  }

  // ─── 누락 backfill(멱등) ─────────────────────────────────────────────────────

  /**
   * 폐루프 1회 드레인 — 단계 누락분을 순서대로 backfill 한다(멱등).
   * 1) missingDocument → enqueueParsing  2) PENDING 파싱 → processPendingBatch
   * 3) DONE-무이벤트/PENDING 이벤트 → processPendingDisclosures
   *
   * 각 단계는 throw하지 않는 하위 서비스 계약을 따르며(상태로 실패 기록),
   * 단계 자체 예외는 흡수해 다음 단계로 진행한다(부분 진행 보장).
   */
  async drainOnce(limit = DEFAULT_DRAIN_LIMIT): Promise<PipelineDrainResult> {
    const startedAt = Date.now();

    const enqueuedMissingDocuments = await this.safe(
      () => this.backfillMissingDocuments(limit),
      0,
      'missingDocument backfill',
    );

    const parse = await this.safe(
      () => this.documentsService.processPendingBatch(limit),
      { success: 0, failed: 0, durationMs: 0 },
      'processPendingBatch',
    );

    const events = await this.safe(
      () => this.eventsService.processPendingDisclosures(limit),
      { success: 0, failed: 0, needsReview: 0, durationMs: 0 },
      'processPendingDisclosures',
    );

    const result: PipelineDrainResult = {
      enqueuedMissingDocuments,
      parse: { success: parse.success, failed: parse.failed },
      events: {
        success: events.success,
        failed: events.failed,
        needsReview: events.needsReview,
      },
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `폐루프 드레인 완료: 큐등록=${result.enqueuedMissingDocuments}, ` +
        `파싱(성공=${result.parse.success}/실패=${result.parse.failed}), ` +
        `이벤트(성공=${result.events.success}/검토=${result.events.needsReview}/실패=${result.events.failed}), ` +
        `소요=${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * 수집됐으나 파싱 문서 레코드가 없는 공시를 파싱 큐에 등록(PENDING).
   * enqueueParsing 은 upsert 기반이라 멱등. 백필 공시(isBackfill)도 분석 baseline 대상이므로 포함.
   */
  async backfillMissingDocuments(limit = DEFAULT_DRAIN_LIMIT): Promise<number> {
    const missing = await this.prisma.disclosure.findMany({
      where: { document: { is: null } },
      take: limit,
      orderBy: { createdAt: 'asc' },
      select: { rcpNo: true },
    });
    if (missing.length === 0) return 0;

    await this.documentsService.enqueueParsing(missing.map((m) => m.rcpNo));
    this.logger.log(`파싱 누락 backfill: ${missing.length}건 큐 등록`);
    return missing.length;
  }

  /**
   * AI summary 미도달 자격 이벤트를 큐에 재발행(★수동 전용, cron 미연결).
   * cron 자동화 시 L0 정당 스킵 건이 영구 재발행돼 노이즈가 되므로 운영자 트리거로 제한.
   * 멱등: consumer는 (rcpNo,task) summary 캐시가 있으면 LLM 미호출. 큐 미가용 시 0.
   */
  async reprocessMissingAi(
    limit = DEFAULT_AI_REPROCESS_LIMIT,
  ): Promise<AiReprocessResult> {
    const candidates = await this.findEligibleEventsWithoutSummary(limit);
    if (candidates.length === 0 || !this.aiQueue) {
      if (!this.aiQueue) {
        this.logger.warn('AI 큐 미가용 — summary 재발행 생략(reEnqueued=0)');
      }
      return { scanned: candidates.length, reEnqueued: 0 };
    }

    let reEnqueued = 0;
    for (const ev of candidates) {
      const payload: AiAnalyzeJobData = {
        rcpNo: ev.rcpNo,
        corpCode: ev.corpCode,
        eventType: ev.eventType,
        polarity: ev.polarity,
        confidence: ev.confidence,
        isAiAssisted: ev.isAiAssisted,
      };
      // DAR-230: 이벤트추출 경로와 동일 자연키(ai-<rcpNo>)로 발행해 중복 잡 적재 방지.
      await this.aiQueue.add(JOB.EVENT_EXTRACTED, payload, {
        ...AI_ANALYZE_JOB_OPTIONS,
        jobId: aiAnalyzeJobId(ev.rcpNo),
      });
      reEnqueued++;
    }

    this.logger.log(
      `AI summary 재발행: 스캔=${candidates.length}, 재발행=${reEnqueued}`,
    );
    return { scanned: candidates.length, reEnqueued };
  }

  // ─── Private 집계 헬퍼 ───────────────────────────────────────────────────────

  /** 파싱 DONE 이나 이벤트 레코드가 없는 건수(이벤트 추출 누락 후보). */
  private async countParsedDocsWithoutEvent(): Promise<number> {
    return this.prisma.disclosureDocument.count({
      where: {
        parseStatus: ParseStatus.DONE,
        disclosure: { disclosureEvent: { is: null } },
      },
    });
  }

  /** 자격 이벤트(SUCCESS|NEEDS_REVIEW) 중 summary 분석이 없는 건수. */
  private async countEligibleEventsWithoutSummary(): Promise<number> {
    return this.prisma.disclosureEvent.count({
      where: {
        extractionStatus: {
          in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
        },
        disclosure: {
          disclosureAnalyses: { none: { task: SUMMARY_TASK } },
        },
      },
    });
  }

  /** AI 재발행 후보 이벤트(summary 미존재) 조회 — 페이로드 구성에 필요한 필드 포함. */
  private async findEligibleEventsWithoutSummary(limit: number) {
    return this.prisma.disclosureEvent.findMany({
      where: {
        extractionStatus: {
          in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
        },
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

  /** 단계별 실패/적체 최근 행(파싱 FAILED/SKIPPED + 이벤트 FAILED) 상위 N건. */
  private async collectRecentFailures(): Promise<PipelineFailureRow[]> {
    const half = Math.ceil(RECENT_FAILURES_LIMIT / 2);

    const [parseFailures, eventFailures] = await Promise.all([
      this.prisma.disclosureDocument.findMany({
        where: {
          parseStatus: {
            in: [
              ParseStatus.FETCH_FAILED,
              ParseStatus.PARSE_FAILED,
              ParseStatus.SKIPPED,
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: half,
        select: {
          rcpNo: true,
          parseStatus: true,
          lastError: true,
          retryCount: true,
          updatedAt: true,
        },
      }),
      this.prisma.disclosureEvent.findMany({
        where: { extractionStatus: ExtractionStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        take: half,
        select: {
          rcpNo: true,
          extractionStatus: true,
          failReason: true,
          updatedAt: true,
        },
      }),
    ]);

    const rows: PipelineFailureRow[] = [
      ...parseFailures.map((d) => ({
        stage: 'PARSE' as const,
        rcpNo: d.rcpNo,
        status: d.parseStatus,
        detail: d.lastError,
        retryCount: d.retryCount,
        at: d.updatedAt?.toISOString() ?? null,
      })),
      ...eventFailures.map((e) => ({
        stage: 'EVENT' as const,
        rcpNo: e.rcpNo,
        status: e.extractionStatus,
        detail: e.failReason,
        retryCount: null,
        at: e.updatedAt?.toISOString() ?? null,
      })),
    ];

    // 최신 갱신 순으로 병합 정렬 후 상한 적용.
    rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    return rows.slice(0, RECENT_FAILURES_LIMIT);
  }

  private tallyParse(
    groups: Array<{ parseStatus: ParseStatus; _count: { _all: number } }>,
  ) {
    const get = (s: ParseStatus) =>
      groups.find((g) => g.parseStatus === s)?._count._all ?? 0;
    return {
      pending: get(ParseStatus.PENDING),
      fetching: get(ParseStatus.FETCHING),
      parsing: get(ParseStatus.PARSING),
      done: get(ParseStatus.DONE),
      fetchFailed: get(ParseStatus.FETCH_FAILED),
      parseFailed: get(ParseStatus.PARSE_FAILED),
      skipped: get(ParseStatus.SKIPPED),
    };
  }

  private tallyEvents(
    groups: Array<{
      extractionStatus: ExtractionStatus;
      _count: { _all: number };
    }>,
  ) {
    const get = (s: ExtractionStatus) =>
      groups.find((g) => g.extractionStatus === s)?._count._all ?? 0;
    return {
      pending: get(ExtractionStatus.PENDING),
      success: get(ExtractionStatus.SUCCESS),
      failed: get(ExtractionStatus.FAILED),
      needsReview: get(ExtractionStatus.NEEDS_REVIEW),
    };
  }

  /** 단계 예외를 흡수해 폴백을 반환(부분 진행 보장). */
  private async safe<T>(
    fn: () => Promise<T>,
    fallback: T,
    label: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `폐루프 단계 실패(${label}) — 다음 단계 진행: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** (now - at) 분. at 결측 시 null. 음수면 0으로 클램프. */
function ageMinutes(at: Date | null | undefined, now: Date): number | null {
  if (!at) return null;
  const diff = Math.floor((now.getTime() - at.getTime()) / MS_PER_MINUTE);
  return diff < 0 ? 0 : diff;
}
