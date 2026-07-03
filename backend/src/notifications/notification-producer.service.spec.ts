import { NotificationProducerService } from './notification-producer.service';
import { NOTIFY_JOB } from '../common/queues/queue.constants';

/**
 * NotificationProducerService 단위 테스트 (DAR-85)
 *  - 엔진은 직접 발송하지 않고 producer 로 NOTIFY 큐에만 enqueue 한다.
 *  - 큐 미설정(@Optional)·enqueue 실패 시에도 절대 throw 하지 않는다(비임계 경로).
 */
describe('NotificationProducerService (DAR-85)', () => {
  const makeQueue = () => ({ add: jest.fn().mockResolvedValue(undefined) });

  it('enqueueSignal → NOTIFY_JOB.SIGNAL 잡으로 add', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueSignal({ signalId: 's1', corpCode: 'c1', grade: 'STRONG_BUY' });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, data, options] = queue.add.mock.calls[0];
    expect(jobName).toBe(NOTIFY_JOB.SIGNAL);
    expect(data).toMatchObject({ signalId: 's1', corpCode: 'c1', grade: 'STRONG_BUY' });
    // DAR-230: signalId 자연키 jobId 로 다경로 재발행 중복 적재 차단.
    expect(options.jobId).toBe('sig-s1');
  });

  it('DAR-230: 잡 유형별 자연키 jobId 부여(sig-/exit-/thesis-)', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueSignal({ signalId: 's1', corpCode: 'c1' });
    await svc.enqueueExit({ positionId: 'p1', corpCode: 'c1' });
    await svc.enqueueThesisViolated({ positionThesisId: 't1', corpCode: 'c1' });

    expect(queue.add.mock.calls[0][2].jobId).toBe('sig-s1');
    expect(queue.add.mock.calls[1][2].jobId).toBe('exit-p1');
    expect(queue.add.mock.calls[2][2].jobId).toBe('thesis-t1');
  });

  it('enqueueExit / enqueueThesisViolated → 각 잡 이름으로 add', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueExit({ positionId: 'p1', corpCode: 'c1' });
    await svc.enqueueThesisViolated({ positionThesisId: 't1', corpCode: 'c1' });

    expect(queue.add.mock.calls[0][0]).toBe(NOTIFY_JOB.EXIT);
    expect(queue.add.mock.calls[1][0]).toBe(NOTIFY_JOB.THESIS_VIOLATED);
  });

  it('DAR-424: enqueueTradeEntry/Exit → TRADE_ENTRY/TRADE_EXIT 잡·kind 강제·자연키 jobId', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    const base = {
      refId: 'trade-1',
      strategyKey: 'intraday-scalp',
      strategyLabel: '분봉 단타',
      corpCode: 'c1',
      stockCode: '005930',
      corpName: '삼성전자',
      price: 105000,
      shares: 10,
      cash: 9_500_000,
      totalValue: 10_200_000,
      deepLink: '/portfolio/strategy/intraday-scalp',
    };
    // kind 는 producer 가 강제(호출자가 잘못 넣어도 보정).
    await svc.enqueueTradeEntry({ ...base, kind: 'EXIT' } as any);
    await svc.enqueueTradeExit({ ...base, kind: 'ENTRY', pnlPct: 2.1, exitReason: 'TAKE_PROFIT' } as any);

    expect(queue.add.mock.calls[0][0]).toBe(NOTIFY_JOB.TRADE_ENTRY);
    expect(queue.add.mock.calls[0][1]).toMatchObject({ kind: 'ENTRY', refId: 'trade-1' });
    expect(queue.add.mock.calls[0][2].jobId).toBe('trade-entry-trade-1');

    expect(queue.add.mock.calls[1][0]).toBe(NOTIFY_JOB.TRADE_EXIT);
    expect(queue.add.mock.calls[1][1]).toMatchObject({ kind: 'EXIT', pnlPct: 2.1 });
    expect(queue.add.mock.calls[1][2].jobId).toBe('trade-exit-trade-1');
  });

  it('DAR-473: enqueueOpsAlert → OPS_ALERT 잡·type=OPS_ALERT·dedupeKey·자연키 jobId', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueOpsAlert('CRITICAL', 'kill-switch', '킬스위치가 발동했습니다.', {
      dedupeKey: 'kill-switch:2026-07-03',
      deepLink: '/portfolio',
      data: { reason: 'CONSEC_LOSS' },
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, data, options] = queue.add.mock.calls[0];
    expect(jobName).toBe(NOTIFY_JOB.OPS_ALERT);
    expect(data).toMatchObject({
      type: 'OPS_ALERT',
      severity: 'CRITICAL',
      source: 'kill-switch',
      message: '킬스위치가 발동했습니다.',
      dedupeKey: 'kill-switch:2026-07-03',
      deepLink: '/portfolio',
      meta: { reason: 'CONSEC_LOSS' },
    });
    // BullMQ custom jobId 는 ':' 불가 → '-' 치환. type=OPS_ALERT → 'ops-' 접두.
    expect(options.jobId).toBe('ops-kill-switch-2026-07-03');
  });

  it('DAR-473: dedupeKey 미지정이면 source+message 로 도출(멱등 자연키)', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueOpsAlert('WARNING', 'cron-freshness', '수집 지연');

    const [, data] = queue.add.mock.calls[0];
    expect(data.dedupeKey).toBe('cron-freshness:수집 지연');
    // deepLink·meta 미지정 → undefined.
    expect(data.deepLink).toBeUndefined();
    expect(data.meta).toBeUndefined();
  });

  it('DAR-476: enqueueRiskAlert → 같은 OPS_ALERT 잡·type=RISK_ALERT·자연키 risk- 접두', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueRiskAlert('CRITICAL', 'kill-switch', '킬스위치 발동(자동)', {
      dedupeKey: 'kill-switch:activate:2026-07-03T09:00',
      deepLink: '/portfolio',
      data: { reason: 'CONSECUTIVE_LOSS' },
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, data, options] = queue.add.mock.calls[0];
    // RISK_ALERT 도 OPS_ALERT 와 동일 잡을 쓰되 payload.type 으로만 구분(consumer 동일 경로).
    expect(jobName).toBe(NOTIFY_JOB.OPS_ALERT);
    expect(data).toMatchObject({
      type: 'RISK_ALERT',
      severity: 'CRITICAL',
      source: 'kill-switch',
      message: '킬스위치 발동(자동)',
      dedupeKey: 'kill-switch:activate:2026-07-03T09:00',
      deepLink: '/portfolio',
      meta: { reason: 'CONSECUTIVE_LOSS' },
    });
    // type=RISK_ALERT → 'risk-' 접두 + ':' → '-' 치환.
    expect(options.jobId).toBe('risk-kill-switch-activate-2026-07-03T09-00');
  });

  it('DAR-476: enqueueRiskAlert dedupeKey 미지정이면 source+message 로 도출', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueRiskAlert('ERROR', 'scalp-catchup', '오버나잇 청산');

    const [, data] = queue.add.mock.calls[0];
    expect(data.type).toBe('RISK_ALERT');
    expect(data.dedupeKey).toBe('scalp-catchup:오버나잇 청산');
  });

  it('큐 미설정(null)이어도 enqueue 는 throw 하지 않는다(graceful no-op)', async () => {
    const svc = new NotificationProducerService(null as any);
    await expect(svc.enqueueSignal({ signalId: 's1', corpCode: 'c1' })).resolves.toBeUndefined();
  });

  it('enqueue 실패(큐 add reject)도 삼켜 엔진 경로를 깨지 않는다', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const svc = new NotificationProducerService(queue as any);
    await expect(svc.enqueueExit({ positionId: 'p1', corpCode: 'c1' })).resolves.toBeUndefined();
  });
});
