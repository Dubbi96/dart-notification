import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExpoPushService } from './expo-push.service';
import {
  QUEUE,
  EXPO_RECEIPT_JOB,
  ExpoReceiptJobData,
} from '../common/queues/queue.constants';

/**
 * DAR-182 — Expo push receipt 검증 consumer (QUEUE.EXPO_RECEIPT 단독 소비자).
 *
 * 배경: 기존 receipt 확인은 setTimeout(15분)으로 프로세스 메모리에만 존재해
 * 배포·크래시·오토스케일 재시작 시 조용히 소멸 → DeviceNotRegistered 가
 * receipt 단계에서만 드러나는 dead-token 이 UserDevice 에 영구 잔존했다.
 *
 * 해결: sendPushNotifications 가 ticket 배치를 BullMQ delayed job(Redis 영속)으로
 * enqueue 하고, 이 consumer 가 지연 도래 시 receipt 조회 + 무효 토큰 정리를
 * 수행한다. 잡이 Redis 에 영속되므로 재시작 후 새 프로세스가 잡을 집어 처리한다.
 *
 * 실제 receipt 처리 본체는 ExpoPushService.checkReceipts 에 있고(폴백 경로와 공유),
 * 이 consumer 는 잡 → 서비스 호출의 얇은 어댑터다. 멱등: dead-token 삭제는
 * removeByDeviceToken 이 멱등(없으면 no-op)이라 잡 재시도에도 안전하다.
 */
@Processor(QUEUE.EXPO_RECEIPT)
export class ExpoReceiptConsumer extends WorkerHost {
  private readonly logger = new Logger(ExpoReceiptConsumer.name);

  constructor(private readonly expoPush: ExpoPushService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== EXPO_RECEIPT_JOB.CHECK) {
      this.logger.warn(`알 수 없는 EXPO_RECEIPT 잡: ${job.name}`);
      return;
    }
    const { ticketIds } = (job.data ?? {}) as ExpoReceiptJobData;
    await this.expoPush.checkReceipts(ticketIds ?? []);
    this.logger.debug(`receipt 검증 완료(durable): ${ticketIds?.length ?? 0}건`);
  }
}
