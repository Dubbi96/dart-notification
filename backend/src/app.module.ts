import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
