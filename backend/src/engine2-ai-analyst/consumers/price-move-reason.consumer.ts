import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE, PRICE_MOVE_REASON_JOB, PriceMoveReasonJobData } from '../../common/queues/queue.constants';
import { PriceMoveReasoningService } from '../price-move-reasoning/price-move-reasoning.service';

/**
 * DAR-522 (Wave C1·P0) — engine3 PRICE_MOVE(±5%) 발화 → 역방향 리즈닝 컨슈머.
 *
 * price-move-alert 가 발행한 등락 이벤트 잡을 소비해 PriceMoveReasoningService 에 위임한다.
 * 서비스가 48h 공시 유무 판정·무공시 포맷 응답·비용게이트·AIUsageLog·refId 멱등을 단독 담당.
 * 임계 실패는 throw 로 전파해 BullMQ 재시도(attempts:3)를 유발한다(refId 멱등이 중복 비용 방지).
 */
@Processor(QUEUE.PRICE_MOVE_REASON)
export class PriceMoveReasonConsumer extends WorkerHost {
  private readonly logger = new Logger(PriceMoveReasonConsumer.name);

  constructor(private readonly service: PriceMoveReasoningService) {
    super();
  }

  async process(job: Job<PriceMoveReasonJobData>): Promise<void> {
    if (job.name !== PRICE_MOVE_REASON_JOB.REASON) return;
    const { refId } = job.data;
    this.logger.log(`[Engine2] ${PRICE_MOVE_REASON_JOB.REASON} 수신: refId=${refId}`);
    const record = await this.service.reason(job.data);
    this.logger.log(`[Engine2] 역방향 리즈닝 처리: refId=${refId} status=${record.status}`);
  }
}
