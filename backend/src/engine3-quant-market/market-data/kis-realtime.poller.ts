import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KisApiService } from './kis-api.service';
import { RealtimeQuoteCache } from './realtime-quote.cache';
import { KST_TIMEZONE } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/** 1회 폴링 종목 상한(호출 제한 가드). */
const POLL_UNIVERSE_CAP = 60;

/**
 * KisRealtimePoller — 모의운용 보유/후보 종목 실시간 현재가 폴러 (DAR-140).
 *
 * 장중(평일 09~15시) 분 단위로 KIS 현재가를 받아 RealtimeQuoteCache 에 적재한다.
 * SimulationPriceSourceService 가 평가 시 신선한 실시간가를 일봉/합성보다 우선 사용한다.
 *
 * ★graceful: KIS 키 미설정(isConfigured=false)이면 즉시 no-op(실호출 0) — 키 없이도 부팅·테스트.
 * ★throw 금지: cron 스케줄 유지를 위해 예외 흡수.
 * ★정직: 적재 가격은 실제 시장 실시간가(REALTIME). 환경 시계(2026)와 실제 시각 괴리는
 *   fetchedAtMs(실 wall-clock)로 드러나며, 소비측이 신선도로 게이트한다.
 *
 * ★DAR-231: 60종목 순차 KIS 호출이 분 경계(60초)를 초과하면 다음 분 cron 이 겹쳐
 *   rate-limit 위반·중복부하를 낸다. isPolling 단일 실행 락으로 겹침을 차단한다.
 *
 * ★DAR-232: 기존에는 폴링 실패를 logger.error 로만 삼켜 '장중 시세가 조용히 멈춤'을
 *   인지할 수 없었다. CronRunRecorder 로 감싸 실패를 CronRunLog 에 FAILED 로 남기고
 *   (신선도 안전망에 노출), cron 스케줄은 throw 없이 유지한다. 키 미설정 no-op 은
 *   기록하지 않는다(미설정 환경의 분단위 로그 폭주 방지).
 *
 * AI 금지영역: 시세 수집은 순수 HTTP/캐시. 체결·주문수량·하드룰과 무관.
 */
@Injectable()
export class KisRealtimePoller {
  private readonly logger = new Logger(KisRealtimePoller.name);

  /**
   * 단일 실행 락 (DAR-231). 60종목 순차 외부호출이 분 경계(60초)를 초과하면 다음 분 cron 이
   * 겹쳐 KIS rate-limit(초당 제한) 위반·중복부하를 낸다. 진행 중이면 이번 분을 건너뛴다.
   */
  private isPolling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kis: KisApiService,
    private readonly cache: RealtimeQuoteCache,
    /**
     * @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작.
     * 미주입 시 폴링 본업은 그대로 수행하고 CronRunLog 기록만 생략(DAR-232).
     */
    @Optional()
    private readonly cronRunRecorder?: CronRunRecorderService,
  ) {}

  /** 평일 09:00~15:59 매 1분(KST) — 보유/후보 종목 실시간 현재가 폴링. */
  @Cron('*/1 9-15 * * 1-5', { timeZone: KST_TIMEZONE })
  async pollRealtime(): Promise<{ polled: number; cached: number; skipped?: boolean }> {
    if (!this.kis.isConfigured) {
      // 키 미설정 — 실시간 비활성(모의운용은 일봉/합성으로 평가). 기록 없이 no-op.
      return { polled: 0, cached: 0 };
    }

    // DAR-231: 이전 폴링이 분 경계를 넘겨 아직 진행 중이면 즉시 건너뜀(겹침·rate-limit 방지).
    if (this.isPolling) {
      this.logger.warn('[KIS] 이전 실시간 폴링 진행 중 — 이번 분 건너뜀(겹침 방지)');
      return { polled: 0, cached: 0, skipped: true };
    }

    this.isPolling = true;

    // 본업: 예외를 삼키지 않고 던진다 → recorder 가 FAILED 로 기록한 뒤 재던짐.
    const run = async (): Promise<{ polled: number; cached: number }> => {
      const universe = await this.resolveUniverse();
      let cached = 0;
      for (const { corpCode, stockCode } of universe) {
        const q = await this.kis.fetchCurrentPrice(stockCode);
        if (!q || q.price <= 0) continue;
        this.cache.set({
          corpCode,
          stockCode,
          price: q.price,
          open: q.open,
          high: q.high,
          low: q.low,
          volume: q.volume,
          fetchedAtMs: Date.now(),
        });
        cached++;
      }
      if (cached > 0) {
        this.logger.log(`[KIS] 실시간 현재가 폴링 stocks=${universe.length} cached=${cached}`);
      }
      return { polled: universe.length, cached };
    };

    try {
      if (!this.cronRunRecorder) return await run();
      // DAR-110/232: 마지막 성공시각/적재건수 기록(신선도 판정 입력 + 실패 표면화).
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.KIS_REALTIME, run, {
        countOf: (r) => r.cached,
      });
    } catch (e) {
      // recorder 가 FAILED 기록 후 재던진 예외(또는 미주입 시 본업 예외)를 흡수해
      // cron 스케줄을 유지한다(기존 거동 보존).
      this.logger.error(`[KIS] 실시간 폴링 오류: ${(e as Error).message}`);
      return { polled: 0, cached: 0 };
    } finally {
      // 정상/예외/조기반환 어느 경로든 락 해제 — 다음 분 폴링 보장.
      this.isPolling = false;
    }
  }

  /** 모의 보유 OPEN 포지션 + 진입 후보(entryReady) (corpCode,stockCode) 합집합(corpCode 중복 제거·상한). */
  private async resolveUniverse(): Promise<Array<{ corpCode: string; stockCode: string }>> {
    const open = await this.prisma.position.findMany({
      where: { status: 'OPEN' },
      select: { corpCode: true, stockCode: true },
    });
    const signals = await this.prisma.tradingSignal.findMany({
      // ★DAR-389/DAR-129(불가침): 백필 신호 종목이 라이브 실시간 폴링 유니버스(상한·점수순)를
      //   잠식하지 않도록 배제(KIS 쿼터 보호·현재 후보 우선).
      where: { entryReady: true, disclosure: { isBackfill: false } },
      orderBy: { buyScore: 'desc' },
      take: POLL_UNIVERSE_CAP,
      select: { corpCode: true, stockCode: true },
    });
    const byCorp = new Map<string, { corpCode: string; stockCode: string }>();
    for (const r of [...open, ...signals]) {
      if (!r.stockCode || !r.corpCode) continue;
      if (!byCorp.has(r.corpCode)) byCorp.set(r.corpCode, { corpCode: r.corpCode, stockCode: r.stockCode });
      if (byCorp.size >= POLL_UNIVERSE_CAP) break;
    }
    return [...byCorp.values()];
  }
}
