// backend/src/disclosure-events/disclosure-events.service.ts
// 이벤트 추출 파이프라인 진입점 (M2)

import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DisclosureEvent, EventType, ExtractionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParsedJson } from '../disclosure-documents/types/parsed-json.type';
import { classifyEventType } from './extractors/event-classifier';
import { extractEventData } from './extractors/index';
import { QUEUE, JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;
const MAX_FAIL_REASON_LENGTH = 500;

// confidence 임계값 (계약서 §4-7 준수)
const CONFIDENCE_SUCCESS_THRESHOLD = 0.85;   // ≥ 이면 SUCCESS, AI 불필요
const CONFIDENCE_NEEDS_REVIEW_THRESHOLD = 0.60; // < 이면 NEEDS_REVIEW

// ─── 이벤트 타입별 필수 필드 목록 (validateExtractedData용) ─────────────────

const REQUIRED_FIELDS_MAP: Partial<Record<EventType, string[]>> = {
  [EventType.SUPPLY_CONTRACT]:          ['contractAmount'],
  [EventType.SHARE_BUYBACK]:            ['buybackShares', 'buybackAmount'],
  [EventType.SHARE_CANCELLATION]:       ['cancellationShares'],
  [EventType.DIVIDEND_INCREASE]:        ['dividendPerShare'],
  [EventType.PAID_IN_CAPITAL_INCREASE]: ['newShares', 'fundingAmount'],
  [EventType.CB_ISSUANCE]:              ['totalAmount', 'conversionPrice'],
  [EventType.BW_ISSUANCE]:              ['totalAmount'],
};

@Injectable()
export class DisclosureEventsService {
  private readonly logger = new Logger(DisclosureEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @InjectQueue(QUEUE.AI_ANALYZE) private readonly aiQueue: Queue | null,
  ) {}

  /**
   * 공시 1건 처리 파이프라인
   *
   * 1. DisclosureDocument 조회 (parsedJson 필수)
   * 2. classifyEventType(reportName, parsedJson)
   * 3. extractEventData(eventType, parsedJson, reportName)
   * 4. validateExtractedData(eventType, data)
   * 5. upsert DisclosureEvent
   *
   * 절대 throw하지 않음 — 오류는 extractionStatus 전이로 기록
   */
  async processDisclosure(rcpNo: string): Promise<DisclosureEvent> {
    try {
      // Step 1: Disclosure 조회
      const disclosure = await this.prisma.disclosure.findUnique({
        where: { rcpNo },
      });
      if (!disclosure) {
        return this.upsertFailed(rcpNo, '', 'DISCLOSURE_NOT_FOUND');
      }

      // Step 2: DisclosureDocument 조회 (parsedJson 필수)
      const doc = await this.prisma.disclosureDocument.findUnique({
        where: { rcpNo },
      });
      if (!doc || !doc.parsedJson) {
        return this.upsertFailed(rcpNo, disclosure.corpCode, 'NO_PARSED_DOC');
      }

      const parsedJson = doc.parsedJson as unknown as ParsedJson;

      // Step 3: 이벤트 타입 분류
      const { eventType, polarity, confidence: classifyConfidence } =
        classifyEventType(disclosure.reportName, parsedJson);

      // confidence < 0.60 이면 바로 NEEDS_REVIEW
      if (classifyConfidence < CONFIDENCE_NEEDS_REVIEW_THRESHOLD) {
        return this.upsertEvent({
          rcpNo,
          corpCode: disclosure.corpCode,
          eventType,
          polarity,
          extractedData: {},
          confidence: classifyConfidence,
          isAiAssisted: true,
          extractionStatus: ExtractionStatus.NEEDS_REVIEW,
          failReason: 'LOW_CONFIDENCE_CLASSIFY',
          isAmendment: doc.isAmendment,
          originalRcpNo: doc.originalRcpNo,
        });
      }

      // Step 4: 수치 추출 + 파생값 보정(서비스 레이어, 계약 §4-2 Step 4)
      const { data: rawExtracted, confidence: extractConfidence } =
        extractEventData(eventType, parsedJson, disclosure.reportName);
      const data = this.computeDerivedValues(eventType, rawExtracted);

      // 필수 필드 전부 누락 (confidence = 0.0)
      if (extractConfidence === 0.0 && eventType !== EventType.OTHER) {
        return this.upsertEvent({
          rcpNo,
          corpCode: disclosure.corpCode,
          eventType,
          polarity,
          extractedData: data,
          confidence: 0.0,
          isAiAssisted: false,
          extractionStatus: ExtractionStatus.FAILED,
          failReason: 'NO_PARSED_FIELD',
          isAmendment: doc.isAmendment,
          originalRcpNo: doc.originalRcpNo,
        });
      }

      // Step 5: 검증 및 confidence 조정
      const { confidenceAdjustment, needsReview } = this.validateExtractedData(
        eventType,
        data,
      );

      const finalConfidence = Math.max(
        0.0,
        Math.round((extractConfidence + confidenceAdjustment) * 100) / 100,
      );

      // 분류 confidence와 추출 confidence 중 낮은 값 채택
      const combinedConfidence = Math.min(classifyConfidence, finalConfidence);

      let extractionStatus: ExtractionStatus;
      let isAiAssisted = false;

      if (needsReview || combinedConfidence < CONFIDENCE_NEEDS_REVIEW_THRESHOLD) {
        extractionStatus = ExtractionStatus.NEEDS_REVIEW;
        isAiAssisted = true;
      } else if (combinedConfidence < CONFIDENCE_SUCCESS_THRESHOLD) {
        extractionStatus = ExtractionStatus.NEEDS_REVIEW;
        isAiAssisted = true; // AI L1 보조 플래그
      } else {
        extractionStatus = ExtractionStatus.SUCCESS;
      }

      const saved = await this.upsertEvent({
        rcpNo,
        corpCode: disclosure.corpCode,
        eventType,
        polarity,
        extractedData: data,
        confidence: combinedConfidence,
        isAiAssisted,
        extractionStatus,
        failReason: null,
        isAmendment: doc.isAmendment,
        originalRcpNo: doc.originalRcpNo,
      });

      this.logger.log(
        `이벤트 추출 완료: rcpNo=${rcpNo}, eventType=${eventType}, status=${extractionStatus}, confidence=${combinedConfidence}`,
      );

      // Engine2로 비동기 AI 분석 트리거 (SUCCESS / NEEDS_REVIEW 모두 큐에 발행)
      if (this.aiQueue) {
        const payload: AiAnalyzeJobData = {
          rcpNo,
          corpCode: disclosure.corpCode,
          eventType,
          polarity,
          confidence: combinedConfidence,
          isAiAssisted,
        };
        await this.aiQueue.add(JOB.EVENT_EXTRACTED, payload);
        this.logger.debug(`[Engine1→Engine2] ${JOB.EVENT_EXTRACTED} 큐 발행: rcpNo=${rcpNo}`);
      }

      return saved;
    } catch (error) {
      this.logger.error(`이벤트 추출 실패: rcpNo=${rcpNo}`, error);
      // 오류 발생 시에도 throw하지 않고 FAILED 상태로 저장 시도
      try {
        return await this.upsertFailed(
          rcpNo,
          '',
          truncate((error as Error).message ?? 'UNKNOWN_ERROR', MAX_FAIL_REASON_LENGTH),
        );
      } catch {
        // upsert 자체도 실패하면 빈 객체 반환 (최후 수단)
        return { id: '', rcpNo } as unknown as DisclosureEvent;
      }
    }
  }

  /**
   * 미처리(PENDING) 공시 일괄 처리
   * extractionStatus = PENDING 또는 DisclosureDocument.parseStatus = DONE이지만
   * DisclosureEvent가 없는 건을 처리한다.
   */
  async processPendingDisclosures(
    limit = DEFAULT_BATCH_LIMIT,
  ): Promise<{ success: number; failed: number; needsReview: number; durationMs: number }> {
    const safeLimit = Math.min(limit, MAX_BATCH_LIMIT);
    const startTime = Date.now();

    // PENDING 상태 이벤트 레코드 대상
    const pendingEvents = await this.prisma.disclosureEvent.findMany({
      where: { extractionStatus: ExtractionStatus.PENDING },
      take: safeLimit,
      orderBy: { extractedAt: 'asc' },
      select: { rcpNo: true },
    });

    // 이미 이벤트 레코드가 있는 rcpNo는 전부 제외 (PENDING은 위에서 별도 처리,
    // SUCCESS/FAILED/NEEDS_REVIEW 완료건의 무한 재처리 방지 — BLOCKER 수정)
    const existingEventRcpNos = (
      await this.prisma.disclosureEvent.findMany({ select: { rcpNo: true } })
    ).map((e) => e.rcpNo);

    // parsedJson DONE이지만 DisclosureEvent가 아직 없는 건만 신규 처리
    const docsWithoutEvent = await this.prisma.disclosureDocument.findMany({
      where: {
        parseStatus: 'DONE',
        rcpNo: {
          notIn: existingEventRcpNos.length > 0 ? existingEventRcpNos : ['_placeholder_'],
        },
      },
      take: safeLimit - pendingEvents.length,
      orderBy: { parsedAt: 'asc' },
      select: { rcpNo: true },
    });

    const rcpNosToProcess = [
      ...pendingEvents.map((e) => e.rcpNo),
      ...docsWithoutEvent.map((d) => d.rcpNo),
    ].slice(0, safeLimit);

    if (rcpNosToProcess.length === 0) {
      return { success: 0, failed: 0, needsReview: 0, durationMs: Date.now() - startTime };
    }

    this.logger.log(`일괄 이벤트 추출 시작: ${rcpNosToProcess.length}건`);

    let success = 0;
    let failed = 0;
    let needsReview = 0;

    for (const rcpNo of rcpNosToProcess) {
      const result = await this.processDisclosure(rcpNo);
      switch (result.extractionStatus) {
        case ExtractionStatus.SUCCESS:
          success++;
          break;
        case ExtractionStatus.NEEDS_REVIEW:
          needsReview++;
          break;
        default:
          failed++;
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `일괄 추출 완료: 성공=${success}, 실패=${failed}, 검토=${needsReview}, 소요=${durationMs}ms`,
    );

    return { success, failed, needsReview, durationMs };
  }

  /**
   * M1 DisclosureDocument 파싱 완료 후 자동 체이닝 진입점
   * disclosure-documents.service.ts에서 @Optional() 주입 후 호출
   */
  async onDocumentParsed(rcpNo: string): Promise<void> {
    await this.processDisclosure(rcpNo);
  }

  /**
   * 단건 조회
   */
  async findOne(rcpNo: string): Promise<DisclosureEvent> {
    const event = await this.prisma.disclosureEvent.findUnique({
      where: { rcpNo },
    });
    if (!event) {
      throw new NotFoundException(`이벤트 없음: rcpNo=${rcpNo}`);
    }
    return event;
  }

  /**
   * 목록 조회 (필터 + 페이지네이션)
   */
  async findMany(params: {
    corpCode?: string;
    eventType?: EventType;
    extractionStatus?: ExtractionStatus;
    page?: number;
    limit?: number;
  }): Promise<{ items: DisclosureEvent[]; total: number }> {
    const { corpCode, eventType, extractionStatus, page = 1, limit = 20 } = params;

    const where = {
      ...(corpCode ? { corpCode } : {}),
      ...(eventType ? { eventType } : {}),
      ...(extractionStatus ? { extractionStatus } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.disclosureEvent.findMany({
        where,
        orderBy: { extractedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.disclosureEvent.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 파생값 계산 (외부에서 직접 호출 가능, 유닛 테스트 대상)
   *
   * 현재는 extractors/ 파서 내에서 각자 처리하므로 이 함수는
   * 서비스 레이어에서의 후처리 파생값 보정에 사용한다.
   */
  computeDerivedValues(
    eventType: EventType,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...raw };

    try {
      switch (eventType) {
        case EventType.SUPPLY_CONTRACT: {
          const contractAmount = raw['contractAmount'] as number | null;
          const recentSales = raw['recentSales'] as number | null;
          if (contractAmount && recentSales && recentSales !== 0) {
            result['salesRatio'] = round2((contractAmount / recentSales) * 100);
          }
          break;
        }
        case EventType.PAID_IN_CAPITAL_INCREASE:
        case EventType.THIRD_PARTY_ALLOTMENT: {
          const newShares = raw['newShares'] as number | null;
          const existingShares = raw['existingShares'] as number | null;
          const referencePrice = raw['referencePrice'] as number | null;
          const issuePrice = raw['issuePrice'] as number | null;
          if (newShares && existingShares && existingShares !== 0) {
            result['dilutionRate'] = round2((newShares / existingShares) * 100);
          }
          if (referencePrice && issuePrice && referencePrice !== 0) {
            result['discountRate'] = round2(
              ((referencePrice - issuePrice) / referencePrice) * 100,
            );
          }
          break;
        }
        case EventType.CB_ISSUANCE:
        case EventType.BW_ISSUANCE: {
          const totalAmount = raw['totalAmount'] as number | null;
          const conversionPrice = raw['conversionPrice'] as number | null;
          const existingSharesCb = raw['existingShares'] as number | null;
          if (totalAmount && conversionPrice && conversionPrice !== 0) {
            const maxDilutionShares = Math.floor(totalAmount / conversionPrice);
            result['maxDilutionShares'] = maxDilutionShares;
            if (existingSharesCb && existingSharesCb !== 0) {
              result['maxDilutionRate'] = round2((maxDilutionShares / existingSharesCb) * 100);
            }
          }
          break;
        }
        case EventType.DIVIDEND_INCREASE:
        case EventType.DIVIDEND_CUT: {
          const current = raw['dividendPerShare'] as number | null;
          const previous = raw['previousDividendPerShare'] as number | null;
          if (current !== null && previous !== null && previous !== 0) {
            result['changeRate'] = round2(((current - previous) / previous) * 100);
          }
          break;
        }
        default:
          break;
      }
    } catch {
      // 파생값 계산 오류는 무시 (기존 값 반환)
    }

    return result;
  }

  // ─── Private 헬퍼 ──────────────────────────────────────────────────────────

  /**
   * 필수 필드 누락 검증 및 confidence 조정
   *
   * @returns { confidenceAdjustment, needsReview }
   *   confidenceAdjustment: 누락 필드당 -0.05 (최대 -0.20)
   */
  private validateExtractedData(
    eventType: EventType,
    data: Record<string, unknown>,
  ): { data: Record<string, unknown>; confidenceAdjustment: number; needsReview: boolean } {
    const requiredFields = REQUIRED_FIELDS_MAP[eventType] ?? [];
    let missingCount = 0;

    for (const field of requiredFields) {
      if (data[field] === null || data[field] === undefined) {
        missingCount++;
      }
    }

    const confidenceAdjustment = missingCount > 0 ? -Math.min(missingCount * 0.05, 0.20) : 0;
    const needsReview = missingCount > 0;

    return { data, confidenceAdjustment, needsReview };
  }

  /** FAILED 상태로 upsert */
  private async upsertFailed(
    rcpNo: string,
    corpCode: string,
    reason: string,
  ): Promise<DisclosureEvent> {
    // corpCode가 없으면 Disclosure에서 조회
    let resolvedCorpCode = corpCode;
    if (!resolvedCorpCode) {
      const disclosure = await this.prisma.disclosure.findUnique({
        where: { rcpNo },
        select: { corpCode: true },
      });
      resolvedCorpCode = disclosure?.corpCode ?? '';
    }

    if (!resolvedCorpCode) {
      // Disclosure 자체가 없으면 저장 불가 — 빈 객체 반환
      this.logger.warn(`upsertFailed: Disclosure 없음 rcpNo=${rcpNo}`);
      return { id: '', rcpNo } as unknown as DisclosureEvent;
    }

    return this.upsertEvent({
      rcpNo,
      corpCode: resolvedCorpCode,
      eventType: EventType.OTHER,
      polarity: 'UNKNOWN',
      extractedData: {},
      confidence: 0.0,
      isAiAssisted: false,
      extractionStatus: ExtractionStatus.FAILED,
      failReason: truncate(reason, MAX_FAIL_REASON_LENGTH),
      isAmendment: false,
      originalRcpNo: null,
    });
  }

  /** DisclosureEvent upsert */
  private async upsertEvent(params: {
    rcpNo: string;
    corpCode: string;
    eventType: EventType;
    polarity: string;
    extractedData: Record<string, unknown>;
    confidence: number;
    isAiAssisted: boolean;
    extractionStatus: ExtractionStatus;
    failReason: string | null;
    isAmendment: boolean;
    originalRcpNo: string | null | undefined;
  }): Promise<DisclosureEvent> {
    const {
      rcpNo,
      corpCode,
      eventType,
      polarity,
      extractedData,
      confidence,
      isAiAssisted,
      extractionStatus,
      failReason,
      isAmendment,
      originalRcpNo,
    } = params;

    return this.prisma.disclosureEvent.upsert({
      where: { rcpNo },
      create: {
        rcpNo,
        corpCode,
        eventType,
        polarity,
        extractedData: extractedData as object,
        confidence,
        isAiAssisted,
        extractionStatus,
        failReason: failReason ?? null,
        isAmendment,
        originalRcpNo: originalRcpNo ?? null,
      },
      update: {
        eventType,
        polarity,
        extractedData: extractedData as object,
        confidence,
        isAiAssisted,
        extractionStatus,
        failReason: failReason ?? null,
        isAmendment,
        originalRcpNo: originalRcpNo ?? null,
        updatedAt: new Date(),
      },
    });
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}
