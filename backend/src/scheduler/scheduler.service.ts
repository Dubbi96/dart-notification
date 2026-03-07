import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { ExpoPushService } from '../expo-push/expo-push.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  /**
   * 공시 수집 - 10분마다 실행
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async collectDisclosures() {
    this.logger.log('Starting disclosure collection...');
    // TODO: Implement disclosure collection logic
    // 1. DART API 호출하여 최근 공시 조회
    // 2. 중복 체크 (rcpNo 기준)
    // 3. 신규 공시 DB 저장
    // 4. 알림 매칭 및 발송
    this.logger.log('Disclosure collection completed.');
  }

  /**
   * 만료 토큰 정리 - 매일 자정 실행
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredTokens() {
    this.logger.log('Starting expired token cleanup...');
    // TODO: Implement expired token cleanup logic
    // 1. 오래된 푸시 토큰 삭제
    // 2. 읽은 지 90일 이상 된 알림 삭제
    this.logger.log('Expired token cleanup completed.');
  }
}
