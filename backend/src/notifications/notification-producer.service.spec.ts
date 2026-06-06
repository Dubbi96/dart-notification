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
    const [jobName, data] = queue.add.mock.calls[0];
    expect(jobName).toBe(NOTIFY_JOB.SIGNAL);
    expect(data).toMatchObject({ signalId: 's1', corpCode: 'c1', grade: 'STRONG_BUY' });
  });

  it('enqueueExit / enqueueThesisViolated → 각 잡 이름으로 add', async () => {
    const queue = makeQueue();
    const svc = new NotificationProducerService(queue as any);
    await svc.enqueueExit({ positionId: 'p1', corpCode: 'c1' });
    await svc.enqueueThesisViolated({ positionThesisId: 't1', corpCode: 'c1' });

    expect(queue.add.mock.calls[0][0]).toBe(NOTIFY_JOB.EXIT);
    expect(queue.add.mock.calls[1][0]).toBe(NOTIFY_JOB.THESIS_VIOLATED);
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
