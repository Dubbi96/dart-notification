import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiAnalystService, SummaryRequest } from '../ai-analyst.service';
import { AiGateInput } from '../types/ai-analyst.types';
import { QUEUE, JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { DartStockStatusService } from '../../engine3-quant-market/market-data/dart-stock-status.service';
import { buildExcerpt } from '../input/build-minimal-input';

/** AI Task 입력으로 전달할, DB에서 조회한 실데이터 묶음. */
interface EnrichedInput {
  /** DisclosureEvent.extractedData(추출 수치) — 없으면 빈 객체 */
  keyMetrics: Record<string, unknown>;
  /** DisclosureDocument.rawText 핵심 단락(절단됨) — 없으면 빈 문자열 */
  excerpt: string;
  /** StockDailyPrice.tradingValue 실값(원). 결측 시 0(→ 비용게이트 L0 스킵) */
  tradingValue: number;
}

/**
 * Engine2 — event.extracted 컨슈머.
 * Engine1이 이벤트 추출 완료 후 큐에 발행한 잡을 소비해
 * AiAnalystService.runSummary를 비동기로 호출한다.
 *
 * AI Task 호출 전에 DB에서 실데이터(excerpt·keyMetrics·tradingValue)를 조회해
 * 전달한다(DAR-66). 빈 스텁을 넣지 않아 SummaryTask·하위 신호 품질 천장을 해소한다.
 *
 * 비용 게이트(AiCostGateService)는 runSummary 내부에서 적용되므로(Rule 유지),
 * 컨슈머는 조회한 거래대금 실값을 게이트 입력으로 넘기기만 한다(AI 미개입).
 */
@Processor(QUEUE.AI_ANALYZE)
export class EventExtractedConsumer extends WorkerHost {
  private readonly logger = new Logger(EventExtractedConsumer.name);

  constructor(
    private readonly aiAnalyst: AiAnalystService,
    private readonly prisma: PrismaService,
    private readonly dartStockStatus: DartStockStatusService,
  ) {
    super();
  }

  async process(job: Job<AiAnalyzeJobData>): Promise<void> {
    if (job.name !== JOB.EVENT_EXTRACTED) return;

    const { rcpNo, corpCode, eventType, polarity, confidence } = job.data;
    this.logger.log(`[Engine2] ${JOB.EVENT_EXTRACTED} 수신: rcpNo=${rcpNo}`);

    const enriched = await this.loadEnrichedInput(rcpNo, corpCode);

    // DAR-69: 관리종목 여부를 DART 공시 폴백에서 실조회한다(하드코딩 false 제거).
    // 관리종목이면 AiCostGate가 L0(AI 미사용)로 차단 → 유료 AI 호출 방지.
    const isManagementStock = await this.loadManagementFlag(corpCode);

    const gate: AiGateInput = {
      isManagementStock,
      isTargetEventType: true,
      tradingValue: enriched.tradingValue, // DB 실조회값(결측 시 0 → L0 스킵)
      confidence,
      polarity: polarity as AiGateInput['polarity'],
    };

    const req: SummaryRequest = {
      gate,
      input: {
        rcpNo,
        eventType,
        keyMetrics: enriched.keyMetrics, // DisclosureEvent 추출 수치
        excerpt: enriched.excerpt, // DisclosureDocument 원문 핵심 단락(절단)
      },
    };

    try {
      await this.aiAnalyst.runSummary(req);
      this.logger.log(`[Engine2] runSummary 완료: rcpNo=${rcpNo}`);
    } catch (err) {
      // BullMQ가 자동 재시도하도록 예외를 전파한다
      this.logger.error(`[Engine2] runSummary 실패: rcpNo=${rcpNo}`, err);
      throw err;
    }
  }

  /**
   * 관리종목 여부 실조회 (DAR-69). DART 공시 폴백에서 도출하며, 조회 실패 시
   * graceful 하게 false(게이트 미차단)로 처리하되 사실은 로깅한다.
   */
  private async loadManagementFlag(corpCode: string): Promise<boolean> {
    try {
      return await this.dartStockStatus.isManagementStock(corpCode);
    } catch (err) {
      this.logger.error(`[Engine2] 관리종목 조회 실패: corpCode=${corpCode}`, err);
      return false;
    }
  }

  /**
   * AI Task 입력 충실화: DB에서 excerpt·keyMetrics·tradingValue를 조회한다.
   * 조회 실패/결측은 graceful 처리(빈 입력으로라도 깨지지 않되, 결측 사실을 로깅).
   */
  private async loadEnrichedInput(rcpNo: string, corpCode: string): Promise<EnrichedInput> {
    let keyMetrics: Record<string, unknown> = {};
    let excerpt = '';
    let tradingValue = 0;

    // 1) excerpt — DisclosureDocument.rawText 핵심 단락(절단)
    try {
      const doc = await this.prisma.disclosureDocument.findUnique({
        where: { rcpNo },
        select: { rawText: true },
      });
      if (doc?.rawText) {
        excerpt = buildExcerpt(doc.rawText);
      } else {
        this.logger.warn(`[Engine2] excerpt 결측: rcpNo=${rcpNo} (DisclosureDocument.rawText 없음)`);
      }
    } catch (err) {
      this.logger.error(`[Engine2] excerpt 조회 실패: rcpNo=${rcpNo}`, err);
    }

    // 2) keyMetrics — DisclosureEvent.extractedData(추출 수치)
    try {
      const event = await this.prisma.disclosureEvent.findUnique({
        where: { rcpNo },
        select: { extractedData: true },
      });
      if (event?.extractedData && typeof event.extractedData === 'object') {
        keyMetrics = event.extractedData as Record<string, unknown>;
      } else {
        this.logger.warn(`[Engine2] keyMetrics 결측: rcpNo=${rcpNo} (DisclosureEvent.extractedData 없음)`);
      }
    } catch (err) {
      this.logger.error(`[Engine2] keyMetrics 조회 실패: rcpNo=${rcpNo}`, err);
    }

    // 3) tradingValue — StockDailyPrice 최신 일별 거래대금 실값
    try {
      const price = await this.prisma.stockDailyPrice.findFirst({
        where: { corpCode, tradingValue: { not: null } },
        orderBy: { tradeDate: 'desc' },
        select: { tradingValue: true, tradeDate: true },
      });
      if (price?.tradingValue != null) {
        tradingValue = Number(price.tradingValue);
      } else {
        this.logger.warn(
          `[Engine2] tradingValue 결측: corpCode=${corpCode} (StockDailyPrice 없음) → 0 처리(L0 스킵)`,
        );
      }
    } catch (err) {
      this.logger.error(`[Engine2] tradingValue 조회 실패: corpCode=${corpCode}`, err);
    }

    return { keyMetrics, excerpt, tradingValue };
  }
}
