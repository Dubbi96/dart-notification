import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../common/queues/queue.constants';
import { GraduationModule } from '../engine5-trading-risk/simulation/graduation.module';
import { PipelineModule } from '../engine1-disclosure/pipeline/pipeline.module';
import { NotificationProducerModule } from '../notifications/notification-producer.module';
import { OpsHealthController } from './ops-health.controller';
import { OpsMetricsController } from './ops-metrics.controller';
import { OpsMetricsService } from './ops-metrics.service';
// W5 ③: 공시 알림 감지→푸시 지연 p50/p95 일별 집계(read-only, 기존 테이블만).
import { NotificationLatencyController } from './notification-latency.controller';
import { NotificationLatencyService } from './notification-latency.service';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';
// DAR-516(Wave A/A6): 테스터 코호트 계측 — 인증 인앱 이벤트 로깅(POST) + 오픈율·재방문 집계(GET).
import { TesterEventController } from './tester-event.controller';
import { TesterEventService } from './tester-event.service';
// DAR-513(Wave A/A3): 에디션 밀도 실측 — 최근 60거래일 신호 분포 진단(read-only, 기존 테이블만).
import { EditionDensityController } from './edition-density.controller';
import { EditionDensityService } from './edition-density.service';
import { OpsDailyReportService } from './ops-daily-report.service';
import { OpsDailyReportScheduler } from './ops-daily-report.scheduler';
import { BiweeklyTrackReviewService } from './biweekly-track-review.service';
import { BiweeklyTrackReviewScheduler } from './biweekly-track-review.scheduler';
import { BiweeklyTrackReviewController } from './biweekly-track-review.controller';
import { PersonaTradingModule } from '../engine5-trading-risk/paper-simulation/persona/persona-trading.module';
import { PreMarketPreflightService } from './pre-market-preflight.service';
import { PreMarketPreflightScheduler } from './pre-market-preflight.scheduler';
import { MarketDataModule } from '../engine3-quant-market/market-data/market-data.module';
import { TradingRiskModule } from '../engine5-trading-risk/trading-risk.module';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { ExternalKeysHealthIndicator } from './indicators/external-keys-health.indicator';

/**
 * OpsModule — 운영 헬스/메트릭 엔드포인트 (DAR-111, 패널 v5 #6, 안전/운영).
 *
 * GET /health(·/live) — terminus 기반 readiness/liveness(DB·Redis 도달성 + 외부키 경량 점검).
 * GET /ops/metrics    — 경량 JSON 핵심 카운터(AI누적·신호·모의포지션·freshness·졸업지표).
 *
 * 배선:
 *  - TerminusModule: HealthCheckService 제공.
 *  - BullModule.registerQueue(AI_ANALYZE): RedisHealthIndicator 가 큐의 Redis 클라이언트로 PING.
 *  - GraduationModule: GraduationMetricsService(G1/G2/G3/G5) 재사용.
 *  - NotificationProducerModule: enqueueOpsAlert(OPS_ALERT 채널, DAR-473) — 일일 리포트 발송.
 *  - PrismaModule(@Global)·CronHealthModule(@Global, DataFreshness·CronRunRecorder)는 import 불요.
 *
 * ★ read-only 관측 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
 *   ★실주문/Kill Switch 무직결. 외부키 readiness 는 키 존재/형식 확인 수준(쿼터 소모 0).
 *   DAR-477(P05): 일일 운영 리포트 잡(20:30 KST)도 관측·알림 계층 전용(매매 무접점).
 */
@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
    GraduationModule,
    // DAR-126: PipelineIntegrityService(단계 카운트) 재사용 — /ops/metrics.pipeline 노출.
    PipelineModule,
    // DAR-477: 일일 운영 리포트 발송(enqueueOpsAlert) — producer 전용 경량 모듈.
    NotificationProducerModule,
    // DAR-487(견고화 W3·P26): 프리플라이트가 KIS 토큰 워밍(KisApiService)·리스크 상태
    //   (AutoTradingStatusService)를 read-only 재사용. 두 모듈의 export 만 취한다(싱글턴 재사용).
    MarketDataModule,
    TradingRiskModule,
    // 격주 트랙 성과 순위 리포트 — MarketRegimeService(시장국면 태깅) read-only 재사용.
    PersonaTradingModule,
  ],
  controllers: [
    OpsHealthController,
    OpsMetricsController,
    BiweeklyTrackReviewController,
    // W5 ③: GET /ops/notification-latency — 감지→푸시 지연 p50/p95(정직한 지표 정의 동봉).
    NotificationLatencyController,
    // 갭분석 W15 ③: 온보딩 퍼널 계측(비인증 POST /ops/funnel) — 측정 전용 표면.
    FunnelController,
    // DAR-516(Wave A/A6): 테스터 코호트 계측(인증 POST /ops/tester-event · GET /ops/tester-metrics).
    TesterEventController,
    // DAR-513: GET /ops/edition-density — 최근 N거래일 에디션 신호 분포 + 밀도 판정.
    EditionDensityController,
  ],
  providers: [
    OpsMetricsService,
    // W5 ③: 공시 알림 지연 집계 서비스(기존 테이블 read-only).
    NotificationLatencyService,
    // 갭분석 W15 ③: FunnelEvent 적재(무소음 실패 흡수·meta 캡).
    FunnelService,
    // DAR-516(Wave A/A6): 테스터 코호트 이벤트 적재 + 오픈율·재방문 집계.
    TesterEventService,
    // DAR-513: 에디션 밀도 실측 서비스(trading_signals·stock_daily_prices read-only 집계).
    EditionDensityService,
    // DAR-477(견고화 W0·P05): 일일 운영 리포트 생성 서비스 + 20:30 KST 발송 스케줄러.
    OpsDailyReportService,
    OpsDailyReportScheduler,
    // 격주 트랙 성과 순위 리포트(트레일링 14일·시장국면 태깅) + 격주 일요일 10:00 KST 스케줄러.
    BiweeklyTrackReviewService,
    BiweeklyTrackReviewScheduler,
    // DAR-487(견고화 W3·P26): 장 시작 전 종합 프리플라이트 점검 서비스 + 08:30 KST 스케줄러.
    PreMarketPreflightService,
    PreMarketPreflightScheduler,
    PrismaHealthIndicator,
    RedisHealthIndicator,
    ExternalKeysHealthIndicator,
  ],
})
export class OpsModule {}
