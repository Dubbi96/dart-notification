import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { DevicesService } from '../devices/devices.service';
import {
  QUEUE,
  EXPO_RECEIPT_JOB,
  EXPO_RECEIPT_JOB_OPTIONS,
  EXPO_RECEIPT_CHECK_DELAY_MS,
  expoReceiptJobId,
  ExpoReceiptJobData,
} from '../common/queues/queue.constants';

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly configService: ConfigService,
    private readonly devicesService: DevicesService,
    // DAR-182: receipt 검증을 durable BullMQ delayed job 으로 위임.
    // 큐 미설정(@Optional, Redis 없는 테스트 환경 등)이면 휘발성 setTimeout 으로 폴백.
    @Optional()
    @InjectQueue(QUEUE.EXPO_RECEIPT)
    private readonly receiptQueue: Queue | null = null,
  ) {
    this.expo = new Expo({
      accessToken: this.configService.get<string>('EXPO_PUSH_ACCESS_TOKEN'),
    });
  }

  async sendPushNotifications(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const chunks = this.expo.chunkPushNotifications(messages);
    // DAR-260: ticket↔message 정합을 평탄 인덱스가 아니라 청크 단위 쌍으로 추적한다.
    // 한 청크 send 가 throw 하면 그 청크의 ticket 이 평탄 tickets[] 에서 통째로 빠져,
    // 이후 청크의 tickets[i] 가 엉뚱한 messages[i] 와 짝지어진다 → DeviceNotRegistered
    // 시 멀쩡한 토큰을 오인 삭제. 각 ticket 을 그 출처 message 와 함께 묶어
    // 청크 실패가 정합을 깨뜨리지 못하게 한다.
    const pairs: { ticket: ExpoPushTicket; message: ExpoPushMessage }[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        // Expo SDK 는 ticketChunk[j] 를 chunk[j] 와 동일 순서로 돌려준다.
        for (let j = 0; j < ticketChunk.length; j++) {
          pairs.push({ ticket: ticketChunk[j], message: chunk[j] });
        }
      } catch (error) {
        // DAR-446: 한 요청에 서로 다른 Expo 프로젝트 토큰이 섞이면 Expo 가 요청 전체를
        //   거부한다 — "All push notification messages in the same request must be for the
        //   same project". 구 Expo Go/이전 EAS 프로젝트 토큰 + 현 APK 토큰이 혼재할 때 발생하며,
        //   종전엔 이 청크의 멀쩡한 토큰까지 전부 푸시 누락됐다.
        //   → 이 충돌에 한해 메시지 단위로 폴백 발송한다(개별 요청은 항상 단일 프로젝트라
        //     충돌 회피 + 정상 토큰 전달 보존). ★기타 오류(네트워크 등)는 종전대로 로그만 —
        //     ticket↔message 정합(DAR-260)·재시도 비용 거동을 바꾸지 않는다.
        const msg = (error as Error).message ?? '';
        const isProjectConflict =
          msg.includes('same project') ||
          msg.toLowerCase().includes('conflicting tokens');
        if (!isProjectConflict) {
          this.logger.error('Failed to send push notifications', error);
          continue;
        }
        this.logger.warn(
          `혼재 프로젝트 토큰으로 청크 거부 — 메시지 단위 폴백 (${chunk.length}건)`,
        );
        for (const message of chunk) {
          try {
            const single = await this.expo.sendPushNotificationsAsync([message]);
            if (single[0]) {
              pairs.push({ ticket: single[0], message });
            }
          } catch (innerError) {
            this.logger.error(
              `개별 메시지 발송 실패(스킵): to=${String(message.to)} — ${(innerError as Error).message}`,
            );
          }
        }
      }
    }

    // ticket 단계에서 즉시 감지되는 무효 토큰 처리
    await this.handleInvalidTickets(pairs);

    // receipt 확인은 Expo 권장대로 15분 후 처리(durable BullMQ delayed job)
    await this.scheduleReceiptCheck(pairs);

    return pairs.map((p) => p.ticket);
  }

  isValidExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  private async handleInvalidTickets(
    pairs: { ticket: ExpoPushTicket; message: ExpoPushMessage }[],
  ) {
    for (const { ticket, message } of pairs) {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const token = message?.to as string;
        if (token) {
          this.logger.warn(`무효 디바이스 토큰 삭제 (ticket): ${token}`);
          await this.devicesService.removeByDeviceToken(token);
        }
      }
    }
  }

  /**
   * DAR-182: receipt 확인을 durable BullMQ delayed job 으로 예약한다.
   *
   * 기존 setTimeout 은 프로세스 메모리에만 존재해 15분 윈도우 내 배포·크래시·
   * 오토스케일 재시작 시 예약이 조용히 소멸 → 죽은 토큰 영구 잔존. 이를 Redis
   * 영속 delayed job 으로 이전해 재시작에도 receipt 처리를 보장한다.
   *
   * 큐 미설정(@Optional·Redis 없는 환경)이면 종전과 동일하게 휘발성 setTimeout 으로
   * 폴백한다(graceful degradation — durable 보장은 불가하지만 동작은 유지).
   */
  private async scheduleReceiptCheck(
    pairs: { ticket: ExpoPushTicket; message: ExpoPushMessage }[],
  ): Promise<void> {
    const ticketIds: { id: string; token: string }[] = [];
    for (const { ticket, message } of pairs) {
      if (ticket.status === 'ok') {
        ticketIds.push({ id: ticket.id, token: message?.to as string });
      }
    }

    if (ticketIds.length === 0) return;

    // 1) durable 경로: BullMQ delayed job (재시작 견딤·기존 NOTIFY 패턴 재사용)
    if (this.receiptQueue) {
      try {
        const payload: ExpoReceiptJobData = { ticketIds };
        // DAR-230: 배치 첫 ticketId 자연키(rcpt-<ticketId>)로 동일 배치 중복 적재 방지.
        await this.receiptQueue.add(EXPO_RECEIPT_JOB.CHECK, payload, {
          ...EXPO_RECEIPT_JOB_OPTIONS,
          delay: EXPO_RECEIPT_CHECK_DELAY_MS,
          jobId: expoReceiptJobId(ticketIds),
        });
        this.logger.debug(`receipt 검증 enqueue(durable): ${ticketIds.length}건`);
        return;
      } catch (error) {
        // enqueue 실패가 발송 경로를 깨지 않도록 graceful — setTimeout 으로 폴백.
        this.logger.error('receipt 검증 enqueue 실패 — setTimeout 폴백', error as Error);
      }
    }

    // 2) 폴백: 큐 미설정/enqueue 실패 시 휘발성 setTimeout(종전 동작 보존)
    setTimeout(() => {
      void this.checkReceipts(ticketIds);
    }, EXPO_RECEIPT_CHECK_DELAY_MS);
  }

  /**
   * DAR-182: ticketId 배치의 receipt 를 조회하고 DeviceNotRegistered 토큰을 정리한다.
   *
   * ExpoReceiptConsumer(durable 경로)와 setTimeout 폴백이 공유하는 receipt 처리
   * 본체. 프로세스 수명과 무관하게(재시작 후 새 consumer 인스턴스가 호출해도)
   * 동일하게 동작한다 — receipt 단계에서만 드러나는 dead-token 의 유일 안전망.
   */
  async checkReceipts(ticketIds: { id: string; token: string }[]): Promise<void> {
    if (!ticketIds || ticketIds.length === 0) return;

    try {
      const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(
        ticketIds.map((t) => t.id),
      );

      for (const chunk of receiptIdChunks) {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);

        for (const [receiptId, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
            const entry = ticketIds.find((t) => t.id === receiptId);
            if (entry?.token) {
              this.logger.warn(`무효 디바이스 토큰 삭제 (receipt): ${entry.token}`);
              await this.devicesService.removeByDeviceToken(entry.token);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Receipt 확인 실패', error);
    }
  }
}
