import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DevicesModule } from './devices/devices.module';
import { CompaniesModule } from './companies/companies.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationSettingsModule } from './notification-settings/notification-settings.module';
import { DisclosuresModule } from './engine1-disclosure/disclosures/disclosures.module';
import { SavedDisclosuresModule } from './saved-disclosures/saved-disclosures.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulerModule } from './engine1-disclosure/scheduler/scheduler.module';
import { DartApiModule } from './engine1-disclosure/dart-api/dart-api.module';
import { ExpoPushModule } from './expo-push/expo-push.module';
import { DisclosureDocumentsModule } from './engine1-disclosure/disclosure-documents/disclosure-documents.module';
import { DisclosureEventsModule } from './engine1-disclosure/disclosure-events/disclosure-events.module';
import { AiAnalystModule } from './engine2-ai-analyst/ai-analyst.module';
import { QuantMarketModule } from './engine3-quant-market/quant-market.module';
import { SignalsModule } from './signals/signals.module';
import { PortfolioExitModule } from './engine4-portfolio-exit/portfolio-exit.module';
import { TradingRiskModule } from './engine5-trading-risk/trading-risk.module';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // BullMQ — Redis 연결 전역 설정 (Engine 간 이벤트 큐)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),

    // Scheduler
    ScheduleModule.forRoot(),

    // Rate limiting - 60 requests per minute
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),

    // Database
    PrismaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    DevicesModule,
    CompaniesModule,
    WatchlistModule,
    SignalsModule,
    NotificationSettingsModule,
    DisclosuresModule,
    SavedDisclosuresModule,
    NotificationsModule,
    SchedulerModule,
    DartApiModule,
    ExpoPushModule,
    DisclosureDocumentsModule,
    DisclosureEventsModule,

    // Engine 2 — AI Analyst (M3)
    AiAnalystModule,

    // Engine 3 — Quant Market (M4 스캐폴딩)
    QuantMarketModule,

    // Engine 4 — Portfolio Exit / Position Thesis (M7)
    PortfolioExitModule,

    // Engine 5 — Trading Risk / Paper Trade (M10)
    TradingRiskModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
