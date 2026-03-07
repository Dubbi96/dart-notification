import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;

  constructor(private readonly configService: ConfigService) {
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

    return tickets;
  }

  isValidExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }
}
