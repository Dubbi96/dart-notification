import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiAnalystService, SummaryRequest } from '../ai-analyst.service';
import { AiGateInput } from '../types/ai-analyst.types';
import { QUEUE, JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';

/**
 * Engine2 — event.extracted 컨슈머.
 * Engine1이 이벤트 추출 완료 후 큐에 발행한 잡을 소비해
 * AiAnalystService.runSummary를 비동기로 호출한다.
 *
 * 비용 게이트(AiCostGateService)는 runSummary 내부에서 적용되므로
 * 컨슈머는 단순히 페이로드를 변환해 위임한다.
 */
@Processor(QUEUE.AI_ANALYZE)
export class EventExtractedConsumer extends WorkerHost {
  private readonly logger = new Logger(EventExtractedConsumer.name);

  constructor(private readonly aiAnalyst: AiAnalystService) {
    super();
  }

  async process(job: Job<AiAnalyzeJobData>): Promise<void> {
    if (job.name !== JOB.EVENT_EXTRACTED) return;

    const { rcpNo, corpCode, eventType, polarity, confidence, isAiAssisted } = job.data;
    this.logger.log(`[Engine2] ${JOB.EVENT_EXTRACTED} 수신: rcpNo=${rcpNo}`);

    const gate: AiGateInput = {
      isManagementStock: false,
      isTargetEventType: true,
      tradingValue: 200_000_000, // M3 기본값(실제값은 M6 이후 채워짐)
      confidence,
      polarity: polarity as AiGateInput['polarity'],
    };

    const req: SummaryRequest = {
      gate,
      input: {
        rcpNo,
        eventType,
        keyMetrics: {},   // 추출 수치는 DB에서 직접 조회하는 방식으로 후속 개선 가능
        excerpt: '',      // 원문 단락은 LLM 호출 시 내부에서 조회 예정
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
}
