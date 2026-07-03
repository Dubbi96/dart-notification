import { PreMarketPreflightScheduler } from './pre-market-preflight.scheduler';
import { PreMarketPreflightService } from './pre-market-preflight.service';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import {
  PreflightFinding,
  PreMarketPreflightReport,
} from './pre-market-preflight.types';

/**
 * DAR-487(견고화 W3·P26) — 프리플라이트 스케줄러 단위 테스트.
 * 이상 시 RISK/OPS 채널 분리 발송·멱등키 · 정상 무발송 · 휴장 SKIPPED 기록 ·
 * CronRunLog 기록 · 겹침 가드 · throw 안전을 검증.
 */
describe('PreMarketPreflightScheduler (DAR-487)', () => {
  const NOW = new Date('2026-07-02T23:30:00.000Z'); // 2026-07-03 08:30 KST

  function makeReport(over: Partial<PreMarketPreflightReport> = {}): PreMarketPreflightReport {
    return {
      generatedAt: NOW.toISOString(),
      tradingDateKst: '2026-07-03',
      isTradingDay: true,
      isHalfDay: false,
      session: { openMin: 540, closeMin: 930 },
      checks: {
        kisToken: 'OK',
        dailyPriceSanity: 'OK',
        killSwitch: 'OK',
        riskGate: 'OK',
      },
      findings: [],
      overall: 'OK',
      summary: '✅ 정상',
      ...over,
    };
  }

  const riskFinding: PreflightFinding = {
    check: 'kill-switch',
    channel: 'RISK',
    severity: 'CRITICAL',
    message: '킬스위치 발동 상태로 장을 시작합니다',
  };
  const opsFinding: PreflightFinding = {
    check: 'kis-token',
    channel: 'OPS',
    severity: 'ERROR',
    message: 'KIS 토큰 사전 워밍 실패',
  };

  function makeDeps(report: PreMarketPreflightReport, buildImpl?: () => Promise<PreMarketPreflightReport>) {
    const preflight = {
      buildReport: jest.fn().mockImplementation(buildImpl ?? (() => Promise.resolve(report))),
    } as unknown as PreMarketPreflightService;
    const enqueueRiskAlert = jest.fn().mockResolvedValue(undefined);
    const enqueueOpsAlert = jest.fn().mockResolvedValue(undefined);
    const producer = { enqueueRiskAlert, enqueueOpsAlert } as unknown as NotificationProducerService;
    const record = jest.fn().mockImplementation((_k: string, fn: () => Promise<unknown>) => fn());
    const recorder = { record } as unknown as CronRunRecorderService;
    return { preflight, producer, enqueueRiskAlert, enqueueOpsAlert, recorder, record };
  }

  it('이상(RISK+OPS)이면 두 채널로 분리 발송하고 CronRunLog 에 기록', async () => {
    const report = makeReport({
      overall: 'ANOMALY',
      findings: [riskFinding, opsFinding],
      checks: { kisToken: 'FAIL', dailyPriceSanity: 'OK', killSwitch: 'FAIL', riskGate: 'FAIL' },
    });
    const { preflight, producer, enqueueRiskAlert, enqueueOpsAlert, recorder, record } = makeDeps(report);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);

    const result = await scheduler.runPreflight(NOW);

    expect(result).toBe(report);
    expect(record).toHaveBeenCalledWith(
      CRON_JOB_KEYS.PRE_MARKET_PREFLIGHT,
      expect.any(Function),
      expect.objectContaining({ countOf: expect.any(Function), isSkipped: expect.any(Function) }),
    );
    expect(enqueueRiskAlert).toHaveBeenCalledTimes(1);
    expect(enqueueRiskAlert).toHaveBeenCalledWith(
      'CRITICAL',
      'pre-market-preflight',
      expect.stringContaining('킬스위치'),
      expect.objectContaining({ dedupeKey: 'preflight-risk:2026-07-03', deepLink: '/portfolio' }),
    );
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
    expect(enqueueOpsAlert).toHaveBeenCalledWith(
      'ERROR',
      'pre-market-preflight',
      expect.stringContaining('토큰'),
      expect.objectContaining({ dedupeKey: 'preflight-ops:2026-07-03', deepLink: '/settings' }),
    );
  });

  it('OPS 소견만 있으면 OPS 채널만 발송(RISK 미발송)', async () => {
    const report = makeReport({ overall: 'ANOMALY', findings: [opsFinding] });
    const { preflight, producer, enqueueRiskAlert, enqueueOpsAlert, recorder } = makeDeps(report);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);
    await scheduler.runPreflight(NOW);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
    expect(enqueueRiskAlert).not.toHaveBeenCalled();
  });

  it('정상(OK)이면 무발송 — 로그만(기록은 유지)', async () => {
    const report = makeReport({ overall: 'OK', findings: [] });
    const { preflight, producer, enqueueRiskAlert, enqueueOpsAlert, recorder, record } = makeDeps(report);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);
    const result = await scheduler.runPreflight(NOW);
    expect(result).toBe(report);
    expect(enqueueRiskAlert).not.toHaveBeenCalled();
    expect(enqueueOpsAlert).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1); // 정상도 실행 헬스는 남긴다
  });

  it('휴장(HOLIDAY)이면 무발송 · isSkipped 로 SKIPPED 기록', async () => {
    const report = makeReport({ overall: 'HOLIDAY', isTradingDay: false, findings: [] });
    const { preflight, producer, enqueueRiskAlert, enqueueOpsAlert, recorder, record } = makeDeps(report);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);
    await scheduler.runPreflight(NOW);
    expect(enqueueRiskAlert).not.toHaveBeenCalled();
    expect(enqueueOpsAlert).not.toHaveBeenCalled();
    // record 에 넘긴 isSkipped 가 HOLIDAY 리포트를 SKIPPED 로 판정하는지 확인.
    const opts = record.mock.calls[0][2] as { isSkipped: (r: PreMarketPreflightReport) => boolean };
    expect(opts.isSkipped(report)).toBe(true);
  });

  it('recorder 미주입 환경에서도 발송한다', async () => {
    const report = makeReport({ overall: 'ANOMALY', findings: [opsFinding] });
    const { preflight, producer, enqueueOpsAlert } = makeDeps(report);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, undefined);
    const result = await scheduler.runPreflight(NOW);
    expect(result).toBe(report);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('겹침 가드 — 진행 중이면 다음 사이클 스킵(중복 발송 방지)', async () => {
    let release!: (r: PreMarketPreflightReport) => void;
    const pending = new Promise<PreMarketPreflightReport>((res) => {
      release = res;
    });
    const report = makeReport({ overall: 'ANOMALY', findings: [opsFinding] });
    const { preflight, producer, enqueueOpsAlert, recorder } = makeDeps(report, () => pending);
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);

    const first = scheduler.runPreflight(NOW);
    const second = await scheduler.runPreflight(NOW);
    expect(second).toBeNull();

    release(report);
    await first;
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('생성 실패해도 throw 없이 null 반환·락 해제(cron 유지)', async () => {
    const report = makeReport({ overall: 'ANOMALY', findings: [opsFinding] });
    let call = 0;
    const { preflight, producer, enqueueOpsAlert, recorder } = makeDeps(report, () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve(report);
    });
    const scheduler = new PreMarketPreflightScheduler(preflight, producer, recorder);

    const failed = await scheduler.runPreflight(NOW);
    expect(failed).toBeNull();
    expect(enqueueOpsAlert).not.toHaveBeenCalled();

    const ok = await scheduler.runPreflight(NOW);
    expect(ok).toBe(report);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });
});
