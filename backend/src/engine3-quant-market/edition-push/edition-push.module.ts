import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { CronHealthModule } from '../../cron-health/cron-health.module';
import { SignalsService } from '../signals/signals.service';
import { EditionPublishPushService } from './edition-push.service';
import { EditionPublishPushScheduler } from './edition-push.scheduler';

/**
 * DAR-523(Wave B/B2·P0) — 일일 에디션 발행 푸시 모듈.
 *
 * 평일 19:05 KST(신호 생성 19:00 직후) 당일 에디션을 ★조회 API 재사용(SignalsService.findDailyEdition,
 * DAR-505/519)으로 가져와 ★빈 에디션(매수등급 0)이 아니면 NOTIFY 큐(EDITION)로 발행 푸시를 낸다.
 *
 * ★경계: 조회·알림 계층 전용 — engine5(매매·체결)·Buy Score·M10 클록 무접점(AI 0). 엔진 간 전달은
 *   BullMQ NOTIFY 큐(NotificationProducer)로만 — 발송·인박스·캡·멱등은 NotifyConsumer 단독 담당.
 *
 * SignalsService 는 (PrismaService 만 의존하는) 무상태 조회 서비스라 본 모듈이 자체 인스턴스로 provide
 * 한다(QuantMarketModule 이 export 하지 않으므로 — 두 인스턴스는 무상태라 무해).
 */
@Module({
  imports: [PrismaModule, NotificationProducerModule, CronHealthModule],
  providers: [SignalsService, EditionPublishPushService, EditionPublishPushScheduler],
  exports: [EditionPublishPushService],
})
export class EditionPushModule {}
