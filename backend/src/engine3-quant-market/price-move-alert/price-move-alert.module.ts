import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { CronHealthModule } from '../../cron-health/cron-health.module';
import { PriceMoveAlertService } from './price-move-alert.service';
import { PriceMoveAlertScheduler } from './price-move-alert.scheduler';

/**
 * 갭분석 W7·W6 — 관심종목 급변동 알림 + 무공시 변동 브리핑 모듈.
 *
 * 장중 5분 틱으로 WatchList 종목 현재가(KIS)를 전일 종가와 비교해 ±5% 이상이면
 * NOTIFY 큐(PRICE_MOVE)로 발행한다. 본문에 당일 공시 유무를 병기하고, 무공시(48h)면
 * 시장조치·업종 z-score·조회공시 팩트체크를 병기한다(전부 기보유 데이터 — 신규 수집 0).
 *
 * ★경계: 조회·계측·알림 계층 전용 — engine5(매매·체결)·Buy Score 경로 무접점(M10 무오염).
 *   엔진 간 전달은 BullMQ NOTIFY 큐(NotificationProducer)로만 — consumer 가 발송 단독 담당.
 */
@Module({
  imports: [PrismaModule, MarketDataModule, NotificationProducerModule, CronHealthModule],
  providers: [PriceMoveAlertService, PriceMoveAlertScheduler],
  exports: [PriceMoveAlertService],
})
export class PriceMoveAlertModule {}
