import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiAnalystService, SummaryRequest } from '../ai-analyst.service';
import { RawTextStoreService } from '../../common/storage/raw-text-store.service';
import { AiGateInput } from '../types/ai-analyst.types';
import { QUEUE, JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { DartStockStatusService } from '../../engine3-quant-market/market-data/dart-stock-status.service';
import { buildExcerpt } from '../input/build-minimal-input';
import { DisclosureSummaryDraft } from '../tasks/summary.task';
import { PersonaAnalysisDraft, PersonaType } from '../tasks/persona-interpretation.task';

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
 * Engine2 — event.extracted 컨슈머 (DAR-78: AI 파이프라인 전체 Task 오케스트레이션).
 * Engine1이 이벤트 추출 완료 후 큐에 발행한 잡을 소비해, 비용게이트 레벨에 따라
 * 적용 가능한 AI Task를 **모두** 순차 실행한다:
 *   1) Summary           — L1+ (게이트 통과 시)
 *   2) PersonaInterpret. — L2+ (Summary 산출물을 입력으로) → PersonaAnalysis/personaViews 영속
 *   3) PositionThesis    — L3  (보유종목 악재 등) → invalidConditions 등 영속
 * EventClassification은 Engine1 Rule(event-classifier)이 담당하므로 여기서 실행하지 않는다(중복 금지).
 *
 * 각 Task는 AiAnalystService 내부에서 게이트+한도가드로 자체 분기(L0=스킵)하고
 * AIUsageLog를 기록하며 rcpNo+task 멱등 캐시로 중복 job 재실행에 안전하다.
 *
 * AI Task 호출 전에 DB에서 실데이터(excerpt·keyMetrics·tradingValue)를 조회해
 * 전달한다(DAR-66). 빈 스텁을 넣지 않아 SummaryTask·하위 신호 품질 천장을 해소한다.
 *
 * 비용 게이트(AiCostGateService)는 AiAnalystService 내부에서 적용되므로(Rule 유지),
 * 컨슈머는 조회한 거래대금 실값을 게이트 입력으로 넘기기만 한다(AI 미개입).
 */
@Processor(QUEUE.AI_ANALYZE)
export class EventExtractedConsumer extends WorkerHost {
  private readonly logger = new Logger(EventExtractedConsumer.name);

  /** Persona 해석 대상 4종(전 성향). */
  private static readonly DEFAULT_PERSONAS: PersonaType[] = [
    'CONSERVATIVE',
    'BALANCED',
    'AGGRESSIVE',
    'EVENT_DRIVEN',
  ];

  constructor(
    private readonly aiAnalyst: AiAnalystService,
    private readonly prisma: PrismaService,
    private readonly dartStockStatus: DartStockStatusService,
    // DAR-395: 원문 rawText 오프로드 읽기 경로(@Optional — 미배선 시 DB 컬럼 직접 사용).
    @Optional() private readonly rawTextStore?: RawTextStoreService,
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

    // DAR-74: 보유종목 여부를 DB(OPEN 포지션)에서 실조회한다. 보유 중 종목에
    // 악재(polarity NEGATIVE)가 발생하면 AiCostGate가 L3(Thesis 재평가)로 올린다.
    const isHolding = await this.loadHoldingFlag(corpCode);

    // polarity 는 Engine1 분류기가 Rule로 도출해 잡 데이터로 전달한다.
    // 결측/비정상 값이면 eventType 기반 Rule 폴백으로 보정한다(AI 미개입).
    const resolvedPolarity = this.resolvePolarity(polarity, eventType);

    const gate: AiGateInput = {
      isManagementStock,
      isTargetEventType: true,
      tradingValue: enriched.tradingValue, // DB 실조회값(결측 시 0 → L0 스킵)
      confidence,
      polarity: resolvedPolarity,
      isHolding, // DAR-74: 보유종목 실조회값(결측/실패 시 false → L3 미발동, 비용 안전)
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

    // ── 1) Summary — 게이트 통과(L1+) 시 실행. 실패는 BullMQ 재시도로 전파한다. ──
    let summary: DisclosureSummaryDraft | null;
    try {
      summary = await this.aiAnalyst.runSummary(req);
      this.logger.log(`[Engine2] runSummary 완료: rcpNo=${rcpNo}`);
    } catch (err) {
      // BullMQ가 자동 재시도하도록 예외를 전파한다(Summary는 파이프라인 임계 경로)
      this.logger.error(`[Engine2] runSummary 실패: rcpNo=${rcpNo}`, err);
      throw err;
    }

    // 게이트 L0(또는 한도 초과 강등) → Summary 스킵 = 하위 Task도 전부 스킵(비용 안전).
    if (!summary) {
      this.logger.debug(`[Engine2] rcpNo=${rcpNo} Summary 스킵(L0) → Persona/Thesis 미실행`);
      return;
    }

    // ── 2) PersonaInterpretation — L2+ 시 실행. Summary 산출물을 입력으로 재투입 최소화. ──
    //     personaViews/PersonaAnalysis 영속은 AiAnalystService가 담당(DAR-72 융합 입력 충전).
    const personaViews = await this.runPersona(gate, rcpNo, summary);

    // ── 3) PositionThesis — L3(보유종목 악재 등) 시 실행. invalidConditions 등 영속. ──
    //     L3에서는 Persona도 실행되므로 personaViews가 충전돼 있다(없으면 빈 배열로 진행).
    await this.runThesis(gate, rcpNo, corpCode, summary, personaViews ?? []);
  }

  /**
   * Persona 해석 실행(L2+). 게이트 미달이면 AiAnalystService가 null 반환(스킵).
   * 보조 Task 실패는 파이프라인을 깨지 않도록 graceful 처리(Summary는 이미 영속됨).
   */
  private async runPersona(
    gate: AiGateInput,
    rcpNo: string,
    summary: DisclosureSummaryDraft,
  ): Promise<PersonaAnalysisDraft[] | null> {
    try {
      const views = await this.aiAnalyst.runPersonaInterpretation({
        gate,
        input: { rcpNo, summary, personas: EventExtractedConsumer.DEFAULT_PERSONAS },
      });
      if (views) this.logger.log(`[Engine2] runPersonaInterpretation 완료: rcpNo=${rcpNo}`);
      return views;
    } catch (err) {
      this.logger.error(`[Engine2] runPersonaInterpretation 실패(graceful): rcpNo=${rcpNo}`, err);
      return null;
    }
  }

  /**
   * Position Thesis 초안 실행(L3 전용). 게이트 미달이면 AiAnalystService가 null 반환(스킵).
   * signalId/buyScore는 TradingSignal 실조회(결측 시 graceful 폴백). 보조 Task 실패는
   * 파이프라인을 깨지 않는다.
   */
  private async runThesis(
    gate: AiGateInput,
    rcpNo: string,
    corpCode: string,
    summary: DisclosureSummaryDraft,
    personaViews: PersonaAnalysisDraft[],
  ): Promise<void> {
    try {
      const signal = await this.loadSignalForThesis(rcpNo);
      const draft = await this.aiAnalyst.runPositionThesis({
        gate,
        input: {
          rcpNo,
          signalId: signal.signalId,
          summary,
          personaViews,
          buyScore: signal.buyScore,
        },
      });
      if (draft) this.logger.log(`[Engine2] runPositionThesis 완료: rcpNo=${rcpNo}`);
    } catch (err) {
      this.logger.error(`[Engine2] runPositionThesis 실패(graceful): rcpNo=${rcpNo}`, err);
    }
  }

  /**
   * Position Thesis 입력용 signalId·buyScore 실조회 (DAR-78).
   * rcpNo에 매핑된 TradingSignal(최고 buyScore)을 조회한다. L3는 보유종목 악재로도
   * 발동하므로 매칭 신호가 없을 수 있다 — 그 경우 graceful 폴백(합성 signalId·buyScore 0).
   */
  private async loadSignalForThesis(
    rcpNo: string,
  ): Promise<{ signalId: string; buyScore: number }> {
    try {
      const signal = await this.prisma.tradingSignal.findFirst({
        where: { rcpNo },
        orderBy: { buyScore: 'desc' },
        select: { id: true, buyScore: true },
      });
      if (signal) {
        return { signalId: signal.id, buyScore: signal.buyScore };
      }
      this.logger.warn(
        `[Engine2] Thesis용 TradingSignal 결측: rcpNo=${rcpNo} → 합성 signalId·buyScore=0 폴백`,
      );
    } catch (err) {
      this.logger.error(`[Engine2] TradingSignal 조회 실패: rcpNo=${rcpNo}`, err);
    }
    return { signalId: `rcp:${rcpNo}`, buyScore: 0 };
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
   * 보유종목 여부 실조회 (DAR-74). engine4 포지션(OPEN/PARTIAL)을 DB로 조회한다
   * (엔진 간 직접 호출 없이 DB 경유). 조회 실패/결측은 graceful 하게 false 로
   * 처리한다 — false 면 L3가 발동하지 않으므로 비용 안전(과다 LLM 호출 방지).
   */
  private async loadHoldingFlag(corpCode: string): Promise<boolean> {
    try {
      const openCount = await this.prisma.position.count({
        where: { corpCode, status: { in: ['OPEN', 'PARTIAL'] } },
      });
      return openCount > 0;
    } catch (err) {
      this.logger.error(`[Engine2] 보유종목 조회 실패: corpCode=${corpCode}`, err);
      return false;
    }
  }

  /** 유효한 Polarity 값 집합 (Rule 폴백 검증용). */
  private static readonly VALID_POLARITIES: ReadonlySet<string> = new Set([
    'POSITIVE',
    'NEGATIVE',
    'MIXED',
    'NEUTRAL',
  ]);

  /**
   * eventType → polarity Rule 폴백 (DAR-74). Engine1 분류기 polarity가
   * 결측/비정상일 때만 사용한다. 보유종목 L3 활성을 위한 악재 판정 보정용 —
   * 알 수 없는 이벤트는 NEUTRAL(L3 미발동)로 보수 처리한다. AI 미개입.
   */
  private static readonly NEGATIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
    'PAID_IN_CAPITAL_INCREASE',
    'CB_ISSUANCE',
    'BW_ISSUANCE',
    'CONTRACT_CANCELLATION',
    'LAWSUIT',
    'AUDIT_OPINION_ADVERSE',
    'TRADING_HALT',
    'DELISTING_RISK',
    'AMENDMENT_NEGATIVE',
  ]);

  private resolvePolarity(
    rawPolarity: string | undefined | null,
    eventType: string,
  ): AiGateInput['polarity'] {
    if (
      typeof rawPolarity === 'string' &&
      EventExtractedConsumer.VALID_POLARITIES.has(rawPolarity)
    ) {
      return rawPolarity as AiGateInput['polarity'];
    }
    // Rule 폴백: 악재 이벤트 화이트리스트만 NEGATIVE, 그 외 NEUTRAL.
    const fallback = EventExtractedConsumer.NEGATIVE_EVENT_TYPES.has(eventType)
      ? 'NEGATIVE'
      : 'NEUTRAL';
    this.logger.warn(
      `[Engine2] polarity 결측/비정상(raw=${String(rawPolarity)}) → eventType=${eventType} Rule 폴백=${fallback}`,
    );
    return fallback;
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
    // DAR-395: rawText 가 오프로드되면 컬럼은 null·rawTextS3Key 포인터만 남는다 → RawTextStore 로
    //   lazy fetch(미오프로드분은 컬럼 그대로). 스토어 미배선 시 기존 컬럼 직접 사용 폴백.
    try {
      const doc = await this.prisma.disclosureDocument.findUnique({
        where: { rcpNo },
        select: { rawText: true, rawTextS3Key: true },
      });
      const rawText = this.rawTextStore
        ? await this.rawTextStore.load({
            rcpNo,
            rawText: doc?.rawText,
            rawTextS3Key: doc?.rawTextS3Key,
          })
        : (doc?.rawText ?? null);
      if (rawText) {
        excerpt = buildExcerpt(rawText);
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
