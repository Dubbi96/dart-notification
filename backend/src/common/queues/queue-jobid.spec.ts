import {
  NOTIFY_JOB,
  aiAnalyzeJobId,
  notifyJobId,
  expoReceiptJobId,
  NotifySignalJobData,
  NotifyExitJobData,
  NotifyThesisViolatedJobData,
} from './queue.constants';

/**
 * DAR-230 / DAR-327 — 자연키 기반 dedup jobId 단위 테스트.
 *
 * BullMQ 는 동일 jobId 잡이 이미 존재하면 add 를 무시(중복 미적재)한다. 따라서
 * "동일 자연키 → 동일 jobId(결정론)"가 큐 1건 보장의 핵심 불변식이다. 여기서는
 * 그 불변식(결정성·자연키 종속·접두사 격리)을 순수 함수 수준에서 검증한다.
 *
 * DAR-327: BullMQ 4+/Redis 는 custom jobId 에 ':' 를 허용하지 않는다
 * (`Error: Custom Id cannot contain :`). 따라서 모든 빌더 반환값에 ':' 가 절대
 * 포함되지 않아야 한다(파이프라인 전면 장애 회귀 방지). 구분자는 '-' 를 쓴다.
 */
describe('queue jobId helpers (DAR-230 / DAR-327)', () => {
  describe('aiAnalyzeJobId', () => {
    it('동일 rcpNo → 동일 jobId(결정론)', () => {
      expect(aiAnalyzeJobId('20260614000123')).toBe('ai-20260614000123');
      expect(aiAnalyzeJobId('20260614000123')).toBe(
        aiAnalyzeJobId('20260614000123'),
      );
    });

    it('다른 rcpNo → 다른 jobId', () => {
      expect(aiAnalyzeJobId('A')).not.toBe(aiAnalyzeJobId('B'));
    });
  });

  describe('notifyJobId', () => {
    it('SIGNAL → sig-<signalId>', () => {
      const data: NotifySignalJobData = { signalId: 's1', corpCode: 'c1' };
      expect(notifyJobId(NOTIFY_JOB.SIGNAL, data)).toBe('sig-s1');
    });

    it('EXIT → exit-<positionId>', () => {
      const data: NotifyExitJobData = { positionId: 'p1', corpCode: 'c1' };
      expect(notifyJobId(NOTIFY_JOB.EXIT, data)).toBe('exit-p1');
    });

    it('THESIS_VIOLATED → thesis-<positionThesisId>', () => {
      const data: NotifyThesisViolatedJobData = {
        positionThesisId: 't1',
        corpCode: 'c1',
      };
      expect(notifyJobId(NOTIFY_JOB.THESIS_VIOLATED, data)).toBe('thesis-t1');
    });

    it('동일 자연키 → 동일 jobId(결정론)', () => {
      const a = notifyJobId(NOTIFY_JOB.SIGNAL, {
        signalId: 's1',
        corpCode: 'c1',
      });
      const b = notifyJobId(NOTIFY_JOB.SIGNAL, {
        signalId: 's1',
        corpCode: 'c2', // corpCode 가 달라도 자연키(signalId) 동일 → 동일 jobId
      });
      expect(a).toBe(b);
    });

    it('잡 유형별 접두사 격리(동일 id 라도 jobId 충돌 없음)', () => {
      const sig = notifyJobId(NOTIFY_JOB.SIGNAL, {
        signalId: 'x',
        corpCode: 'c1',
      });
      const exit = notifyJobId(NOTIFY_JOB.EXIT, {
        positionId: 'x',
        corpCode: 'c1',
      });
      expect(sig).toBe('sig-x');
      expect(exit).toBe('exit-x');
      expect(sig).not.toBe(exit);
    });

    it('알 수 없는 잡 이름 → undefined(jobId 미부여, 종전 동작)', () => {
      expect(
        notifyJobId('notify.unknown', { signalId: 's1', corpCode: 'c1' }),
      ).toBeUndefined();
    });
  });

  describe('expoReceiptJobId', () => {
    it('첫 ticketId 기반 rcpt-<ticketId>', () => {
      expect(
        expoReceiptJobId([
          { id: 'tk-1' },
          { id: 'tk-2' },
        ]),
      ).toBe('rcpt-tk-1');
    });

    it('동일 배치(동일 첫 ticketId) → 동일 jobId', () => {
      const batch = [{ id: 'tk-1' }, { id: 'tk-9' }];
      expect(expoReceiptJobId(batch)).toBe(expoReceiptJobId(batch));
    });

    it('빈 배열도 안전(rcpt-empty)', () => {
      expect(expoReceiptJobId([])).toBe('rcpt-empty');
    });
  });

  // DAR-327 회귀: BullMQ 가 custom jobId 의 ':' 를 거부해 파이프라인이 전면
  // 실패한 근본원인. 모든 빌더 반환값에 ':' 가 절대 포함되지 않아야 한다.
  describe('콜론(:) 미포함 불변식 (DAR-327)', () => {
    it('aiAnalyzeJobId 반환값에 ":" 없음', () => {
      expect(aiAnalyzeJobId('20260614000123')).not.toContain(':');
    });

    it('notifyJobId 전 유형 반환값에 ":" 없음', () => {
      const sig = notifyJobId(NOTIFY_JOB.SIGNAL, {
        signalId: 's1',
        corpCode: 'c1',
      });
      const exit = notifyJobId(NOTIFY_JOB.EXIT, {
        positionId: 'p1',
        corpCode: 'c1',
      });
      const thesis = notifyJobId(NOTIFY_JOB.THESIS_VIOLATED, {
        positionThesisId: 't1',
        corpCode: 'c1',
      });
      for (const id of [sig, exit, thesis]) {
        expect(id).toBeDefined();
        expect(id).not.toContain(':');
      }
    });

    it('expoReceiptJobId 반환값(빈 배열 포함)에 ":" 없음', () => {
      expect(expoReceiptJobId([{ id: 'tk-1' }])).not.toContain(':');
      expect(expoReceiptJobId([])).not.toContain(':');
    });
  });
});
