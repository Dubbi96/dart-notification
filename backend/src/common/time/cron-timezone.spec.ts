import 'reflect-metadata';

import { KisRealtimePoller } from '../../engine3-quant-market/market-data/kis-realtime.poller';
import { KrxMarketDataScheduler } from '../../engine3-quant-market/market-data/krx-market-data.scheduler';
import { SignalGenerationScheduler } from '../../engine3-quant-market/signal-generation/signal-generation.scheduler';
import { EventStudyCalculationScheduler } from '../../engine3-quant-market/event-study/event-study-calculation.scheduler';
import { SchedulerService } from '../../engine1-disclosure/scheduler/scheduler.service';
import { FinancialCollectionScheduler } from '../../engine1-disclosure/financials/financial-collection.scheduler';
import { InsiderHoldingsScheduler } from '../../engine1-disclosure/insider-holdings/insider-holdings.scheduler';
import { ParseRetryScheduler } from '../../engine1-disclosure/disclosure-documents/parse-retry.scheduler';
import { PipelineDrainScheduler } from '../../engine1-disclosure/pipeline/pipeline-drain.scheduler';
import { AiCostMonitorScheduler } from '../../engine2-ai-analyst/cost-metrics/ai-cost-monitor.scheduler';
import { PaperSimulationScheduler } from '../../engine5-trading-risk/paper-simulation/paper-simulation.scheduler';

/**
 * DAR-199 회귀 가드 — 모든 @Cron이 KST(Asia/Seoul)로 발화하는지 정적 검증.
 *
 * 근본 버그: @nestjs/schedule `@Cron`은 `timeZone` 옵션이 없으면 시스템 TZ(컨테이너
 * 기본 UTC)로 cron식을 해석한다. 전 스케줄이 KST 벽시계를 가정하므로 UTC 서버에서
 * 9시간 어긋나 발화했다(예: 장중 09~15시 폴러가 18~00시 KST에 동작).
 *
 * 데코레이터는 옵션을 `SCHEDULE_CRON_OPTIONS` 메타데이터로 메서드 함수에 박는다.
 * 이를 직접 읽어 `timeZone === 'Asia/Seoul'`을 단정한다 → 런타임/시스템 TZ 무관.
 */
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

// eslint-disable-next-line @typescript-eslint/ban-types
type Ctor = Function;

function cronOptions(
  cls: Ctor,
  method: string,
): { timeZone?: unknown; cronTime?: unknown } | undefined {
  const proto = cls.prototype as Record<string, unknown>;
  const fn = proto[method];
  return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn as object) as
    | { timeZone?: unknown; cronTime?: unknown }
    | undefined;
}

// [클래스, 메서드, 사람이 읽는 레이블] — 코드의 17개 @Cron 1:1 대응.
const CRONS: Array<[Ctor, string, string]> = [
  [KisRealtimePoller, 'pollRealtime', '실시간 폴러 09~15시'],
  [KrxMarketDataScheduler, 'collectDailyPrices', 'KRX 일봉 18:30'],
  [KrxMarketDataScheduler, 'collectMarketIndices', 'KRX 지수 18:45'],
  [KrxMarketDataScheduler, 'collectStockStatuses', 'KRX 종목상태 08:50'],
  [SignalGenerationScheduler, 'generateDaily', '신호생성 19:00'],
  [PaperSimulationScheduler, 'runDaily', '모의운용 19:30'],
  [SchedulerService, 'collectDisclosures', 'DART 수집 08~17시'],
  [SchedulerService, 'collectDisclosuresOffHours', 'DART 장외 06~22시'],
  [SchedulerService, 'cleanupExpiredTokens', '정리 자정'],
  [FinancialCollectionScheduler, 'weeklyBulkCollect', '재무 주간 월 04:00'],
  [FinancialCollectionScheduler, 'earningsSeasonCollect', '재무 실적시즌 05:00'],
  [FinancialCollectionScheduler, 'periodicReportEvent', '재무 EVENT 6시간'],
  [InsiderHoldingsScheduler, 'dailyCollect', '내부자 03:30'],
  [ParseRetryScheduler, 'retryFailedDocuments', '파싱 재처리 30분'],
  [PipelineDrainScheduler, 'drainPipeline', '파이프라인 드레인 15분'],
  [AiCostMonitorScheduler, 'runDaily', 'AI 비용 09:00'],
  [EventStudyCalculationScheduler, 'calculateWeekly', 'Event Study 토 04:00'],
];

describe('모든 @Cron의 timeZone=Asia/Seoul (DAR-199)', () => {
  it('대상 cron은 17개 — 누락 시 목록 갱신 강제', () => {
    expect(CRONS).toHaveLength(17);
  });

  it.each(CRONS)('%s.%s (%s) 는 KST로 발화', (cls, method, _label) => {
    const opts = cronOptions(cls, method);
    expect(opts).toBeDefined();
    expect(opts?.timeZone).toBe('Asia/Seoul');
    // cronTime 메타데이터도 보존되는지(데코레이터 정상 적용) 확인.
    expect(opts?.cronTime).toBeDefined();
  });
});
