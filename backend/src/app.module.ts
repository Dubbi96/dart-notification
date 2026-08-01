import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LegalModule } from './legal/legal.module';
import { DevicesModule } from './devices/devices.module';
import { CompaniesModule } from './companies/companies.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationSettingsModule } from './notification-settings/notification-settings.module';
import { DisclosuresModule } from './engine1-disclosure/disclosures/disclosures.module';
import { SavedDisclosuresModule } from './saved-disclosures/saved-disclosures.module';
import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulerModule } from './engine1-disclosure/scheduler/scheduler.module';
import { DartApiModule } from './engine1-disclosure/dart-api/dart-api.module';
import { ExpoPushModule } from './expo-push/expo-push.module';
import { DisclosureDocumentsModule } from './engine1-disclosure/disclosure-documents/disclosure-documents.module';
import { DisclosureEventsModule } from './engine1-disclosure/disclosure-events/disclosure-events.module';
import { UpcomingEventsModule } from './engine1-disclosure/upcoming-events/upcoming-events.module';
import { PipelineModule } from './engine1-disclosure/pipeline/pipeline.module';
import { FinancialsModule } from './engine1-disclosure/financials/financials.module';
import { InsiderHoldingsModule } from './engine1-disclosure/insider-holdings/insider-holdings.module';
import { AiAnalystModule } from './engine2-ai-analyst/ai-analyst.module';
import { PhilosophyModule } from './engine2-ai-analyst/philosophy/philosophy.module';
import { PersonaPhilosophyFusionModule } from './engine2-ai-analyst/philosophy/fusion/persona-philosophy-fusion.module';
import { QuantMarketModule } from './engine3-quant-market/quant-market.module';
import { PortfolioExitModule } from './engine4-portfolio-exit/portfolio-exit.module';
import { TradingRiskModule } from './engine5-trading-risk/trading-risk.module';
import { AosOperatorModule } from './aos/operator/aos-operator.module';
import { AosAllocationModule } from './aos/allocation/aos-allocation.module';
import { PaperSimulationModule } from './engine5-trading-risk/paper-simulation/paper-simulation.module';
import { GraduationModule } from './engine5-trading-risk/simulation/graduation.module';
import { PhilosophyStyleSimulationModule } from './engine5-trading-risk/paper-simulation/philosophy-style-simulation.module';
import { PersonaTradingModule } from './engine5-trading-risk/paper-simulation/persona/persona-trading.module';
import { DualMomentumForwardModule } from './engine5-trading-risk/paper-simulation/dual-momentum-forward/dual-momentum-forward.module';
import { IntradayScalpModule } from './engine5-trading-risk/paper-simulation/intraday-scalp/intraday-scalp.module';
import { CollectionStatusModule } from './collection-status/collection-status.module';
import { CronHealthModule } from './cron-health/cron-health.module';
import { StatusModule } from './status/status.module';
import { OpsModule } from './ops/ops.module';
import { StorageOpsModule } from './storage-ops/storage-ops.module';
import { WebSurfaceModule } from './web-surface/web-surface.module';
import { envValidationSchema, envValidationOptions } from './config/env.validation';

@Module({
  imports: [
    // Global configuration
    // DAR-253: 필수 env 누락/오타를 부팅 시점에 fail-fast 로 차단(validationSchema).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,
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

    // DAR-395: 객체 스토리지(@Global) — 공시 원문 rawText S3/로컬 오프로드 추상화.
    StorageModule,

    // Feature modules
    AuthModule,
    UsersModule,
    // 갭분석 W3 — Play 컴플라이언스 공개 법적 고지(개인정보 처리방침·계정 삭제 안내)
    LegalModule,
    DevicesModule,
    CompaniesModule,
    WatchlistModule,
    NotificationSettingsModule,
    DisclosuresModule,
    SavedDisclosuresModule,
    SearchModule,
    NotificationsModule,
    SchedulerModule,
    DartApiModule,
    ExpoPushModule,
    DisclosureDocumentsModule,
    DisclosureEventsModule,
    // 공시발 예정 이벤트 캘린더 v1 — 관심기업 D-day (DAR-538, 읽기 전용)
    UpcomingEventsModule,
    // 수집→파싱→이벤트→AI 폐루프 견고화 + 누락 backfill·관측 (DAR-126)
    PipelineModule,
    FinancialsModule,
    // 내부자·대량보유 지분변동 수집 (DAR-87)
    InsiderHoldingsModule,

    // Engine 2 — AI Analyst (M3)
    AiAnalystModule,
    // Persona 철학 엔진 P-B — 철학 적합도 스코어러 (DAR-53)
    PhilosophyModule,
    // Persona 철학 엔진 P-C — AI 관점 × 철학 결합 합성 (DAR-72)
    PersonaPhilosophyFusionModule,

    // Engine 3 — Quant Market (M4 스캐폴딩)
    QuantMarketModule,

    // Engine 4 — Portfolio Exit / Position Thesis (M7)
    PortfolioExitModule,

    // Engine 5 — Trading Risk / Paper Trade (M10)
    TradingRiskModule,

    // AOS A6 — 별도 Operator Web 전용 RBAC/read model/통제 API. mutation 기본 OFF.
    AosOperatorModule,

    // AOS A8 — 확정이익 50/30/20 계획의 모바일 조회 API. 외부 자금이동 없음.
    AosAllocationModule,

    // Engine 5 — 일일 모의운용 오케스트레이터 (M10 모의운용, DAR-40)
    PaperSimulationModule,

    // Engine 5 — 분봉 단타 모의전략 (forward-only 페이퍼 트랙, DAR-411)
    IntradayScalpModule,

    // Engine 5 — 졸업 게이트 G1~G5 측정 REST 노출 (M10 졸업 측정, DAR-67)
    GraduationModule,

    // Engine 5 — 철학 스타일별(BUFFETT/LYNCH/GREENBLATT/DRUCKENMILLER) 모의운용 분기·비교 (DAR-76, P-D)
    PhilosophyStyleSimulationModule,
    PersonaTradingModule,

    // Engine 5 — 듀얼모멘텀 코어 forward 트랙(모의) 월말 리밸런싱 (견고화 W1·P13, DAR-494)
    DualMomentumForwardModule,

    // 횡단 — 수집 상태 대시보드 read-only 집계 (DAR-63)
    CollectionStatusModule,

    // 횡단 — 데이터 신선도 모니터 + 크론 헬스 기록(@Global recorder) (DAR-110)
    CronHealthModule,

    // 횡단 — 운영 헬스(/health)/메트릭(/ops/metrics) 엔드포인트 (DAR-111)
    OpsModule,
    StorageOpsModule,

    // 횡단 — 공개 웹 표면(랜딩 + 공시 공유 페이지, W3b) — DB read-only·외부 API 콜 0
    WebSurfaceModule,
    // 횡단 — 공개 시스템 무결성 /status (비인증·운영 사실만, W11/W12)
    StatusModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
