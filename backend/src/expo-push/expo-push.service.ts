import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { DevicesService } from '../devices/devices.service';

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly configService: ConfigService,
    private readonly devicesService: DevicesService,
  ) {
    this.expo = new Expo({
      accessToken: this.configService.get<string>('EXPO_PUSH_ACCESS_TOKEN'),
    });
  }

  async sendPushNotifications(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error('Failed to send push notifications', error);
      }
    }

    // ticket 단계에서 즉시 감지되는 무효 토큰 처리
    await this.handleInvalidTickets(tickets, messages);

    // receipt 확인은 Expo 권장대로 15분 후 처리
    this.scheduleReceiptCheck(tickets, messages);

    return tickets;
  }

  isValidExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  private async handleInvalidTickets(tickets: ExpoPushTicket[], messages: ExpoPushMessage[]) {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const token = messages[i]?.to as string;
        if (token) {
          this.logger.warn(`무효 디바이스 토큰 삭제 (ticket): ${token}`);
          await this.devicesService.removeByDeviceToken(token);
        }
      }
    }
  }

  private scheduleReceiptCheck(tickets: ExpoPushTicket[], messages: ExpoPushMessage[]) {
    const ticketIds: { id: string; token: string }[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'ok') {
        ticketIds.push({ id: ticket.id, token: messages[i]?.to as string });
      }
    }

    if (ticketIds.length === 0) return;

    // Expo 권장: 15분 후 receipt 확인
    setTimeout(async () => {
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
    }, 15 * 60 * 1000);
  }
}
