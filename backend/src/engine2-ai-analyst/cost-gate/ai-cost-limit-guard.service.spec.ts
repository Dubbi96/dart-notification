import { ConfigService } from '@nestjs/config';
import { AiCostLimitGuardService } from './ai-cost-limit-guard.service';
import { AiCostLevel } from '../types/ai-analyst.types';
import { PrismaService } from '../../prisma/prisma.service';

/** ENV 스텁 — 지정 키만 반환하는 ConfigService 대역. */
function makeConfig(env: Record<string, string> = {}) {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('AiCostLimitGuardService', () => {
  function makeService(dailyCost: number, monthlyCost: number, env?: Record<string, string>) {
    const mockPrisma = {
      aIUsageLog: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { costUsd: dailyCost } })
          .mockResolvedValueOnce({ _sum: { costUsd: monthlyCost } }),
      },
    } as unknown as PrismaService;
    return new AiCostLimitGuardService(mockPrisma, makeConfig(env));
  }

  it('한도 미달 시 forcedLevel=null', async () => {
    const svc = makeService(0.5, 10.0);
    const status = await svc.getLimitStatus();
    expect(status.forcedLevel).toBeNull();
    expect(status.dailyExceeded).toBe(false);
    expect(status.monthlyExceeded).toBe(false);
  });

  it('일 한도 초과 시 forcedLevel=L0, dailyExceeded=true', async () => {
    const svc = makeService(1.0, 5.0);
    const status = await svc.getLimitStatus();
    expect(status.dailyExceeded).toBe(true);
    expect(status.forcedLevel).toBe(AiCostLevel.L0);
  });

  it('월 한도 초과 시 forcedLevel=L0, monthlyExceeded=true', async () => {
    const svc = makeService(0.1, 31.0);
    const status = await svc.getLimitStatus();
    expect(status.monthlyExceeded).toBe(true);
    expect(status.forcedLevel).toBe(AiCostLevel.L0);
  });

  // ── W10: 하드캡 ENV 주입(AI_DAILY_LIMIT_USD/AI_MONTHLY_LIMIT_USD) ─────────────
  describe('ENV 주입 한도 (W10)', () => {
    it('ENV 미설정 시 기본값 폴백 — 일 $1 / 월 $31(일캡×31일 정합)', async () => {
      const svc = makeService(0, 0);
      expect(svc.dailyLimitUsd).toBe(1.0);
      expect(svc.monthlyLimitUsd).toBe(31.0);
      expect(AiCostLimitGuardService.DEFAULT_DAILY_LIMIT_USD).toBe(1.0);
      expect(AiCostLimitGuardService.DEFAULT_MONTHLY_LIMIT_USD).toBe(31.0);
    });

    it('ENV 설정 시 해당 값으로 한도 판정 — 기존 기본값이면 초과였을 비용도 통과', async () => {
      const svc = makeService(1.5, 25.0, {
        AI_DAILY_LIMIT_USD: '2.0',
        AI_MONTHLY_LIMIT_USD: '62',
      });
      expect(svc.dailyLimitUsd).toBe(2.0);
      expect(svc.monthlyLimitUsd).toBe(62);
      const status = await svc.getLimitStatus();
      expect(status.dailyLimitUsd).toBe(2.0);
      expect(status.monthlyLimitUsd).toBe(62);
      expect(status.dailyExceeded).toBe(false);
      expect(status.monthlyExceeded).toBe(false);
      expect(status.forcedLevel).toBeNull();
    });

    it('ENV 설정 시 초과 판정도 ENV 한도 기준 — 기본값 미달 비용이라도 차단', async () => {
      const svc = makeService(0.5, 5.0, { AI_DAILY_LIMIT_USD: '0.5' });
      const status = await svc.getLimitStatus();
      expect(status.dailyExceeded).toBe(true);
      expect(status.forcedLevel).toBe(AiCostLevel.L0);
    });

    it('비정상 ENV(비수치·0·음수·빈 문자열)는 기본값 폴백 — 백스톱 무력화 방지', () => {
      expect(makeService(0, 0, { AI_DAILY_LIMIT_USD: 'abc' }).dailyLimitUsd).toBe(1.0);
      expect(makeService(0, 0, { AI_DAILY_LIMIT_USD: '0' }).dailyLimitUsd).toBe(1.0);
      expect(makeService(0, 0, { AI_MONTHLY_LIMIT_USD: '-5' }).monthlyLimitUsd).toBe(31.0);
      expect(makeService(0, 0, { AI_MONTHLY_LIMIT_USD: ' ' }).monthlyLimitUsd).toBe(31.0);
    });
  });

  it('enforceLimit: 한도 초과 시 L2 → L0 강등', async () => {
    const svc = makeService(1.5, 5.0);
    const { level } = await svc.enforceLimit(AiCostLevel.L2);
    expect(level).toBe(AiCostLevel.L0);
  });

  it('enforceLimit: 한도 미달 시 원래 레벨 유지', async () => {
    const svc = makeService(0.1, 5.0);
    const { level } = await svc.enforceLimit(AiCostLevel.L3);
    expect(level).toBe(AiCostLevel.L3);
  });

  /**
   * DAR-243 — 한도 윈도 경계가 KST 자정/월초(UTC 절대 시각)로 전달되는지 검증.
   * createdAt은 Prisma 기본 UTC 저장이므로 경계도 그 KST 벽시계 자정의 UTC 시각
   * 이어야 한다(로컬 setHours로 만든 UTC 자정이면 9시간 어긋난다).
   */
  describe('한도 윈도 경계 TZ (DAR-243)', () => {
    function makeSpyService() {
      const aggregate = jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } });
      const mockPrisma = {
        aIUsageLog: { aggregate },
      } as unknown as PrismaService;
      return { svc: new AiCostLimitGuardService(mockPrisma, makeConfig()), aggregate };
    }

    it('createdAt gte 경계는 KST 자정/월초의 UTC 절대 시각', async () => {
      const { svc, aggregate } = makeSpyService();
      // 시스템 시계를 UTC 새벽(KST 06-15 03:00)으로 고정 — 옛 버그가 드러나는 구간.
      jest.useFakeTimers().setSystemTime(new Date('2026-06-14T18:00:00Z'));
      try {
        await svc.getLimitStatus();
      } finally {
        jest.useRealTimers();
      }

      const [dailyCall, monthlyCall] = aggregate.mock.calls;
      const dayStart: Date = dailyCall[0].where.createdAt.gte;
      const monthStart: Date = monthlyCall[0].where.createdAt.gte;

      // KST 06-15 00:00 = UTC 06-14 15:00 / KST 06-01 00:00 = UTC 05-31 15:00
      expect(dayStart.toISOString()).toBe('2026-06-14T15:00:00.000Z');
      expect(monthStart.toISOString()).toBe('2026-05-31T15:00:00.000Z');
      // 옛 로컬 setHours가 만들던 UTC 자정(00:00Z)이 아님을 못박는다.
      expect(dayStart.toISOString()).not.toBe('2026-06-15T00:00:00.000Z');
    });
  });

  it('enforceLimit: 제안 L0이면 DB 조회 없이 즉시 L0(예약 미발생)', async () => {
    const aggregate = jest.fn();
    const svc = new AiCostLimitGuardService(
      { aIUsageLog: { aggregate } } as unknown as PrismaService,
      makeConfig(),
    );
    const { level, settle } = await svc.enforceLimit(AiCostLevel.L0);
    expect(level).toBe(AiCostLevel.L0);
    expect(aggregate).not.toHaveBeenCalled(); // 유료 경로 아님 → DB·예약 불필요
    expect(() => settle()).not.toThrow(); // no-op settle 안전
  });
});

// ── DAR-242: read-then-act 동시성 보호 ───────────────────────────────────────
//
// 재현 시나리오: BullMQ 병렬 잡 N개가 한도 직전에 동시에 enforceLimit을 호출한다.
// 실비용(costUsd)은 호출 후 logUsage(=committed)로 기록되므로, 보호가 없으면 모두
// "미달"을 읽고 통과해 한도를 N배로 돌파한다(이슈 근거). 예약+뮤텍스로 통과한 슬롯의
// 인플라이트 비용이 즉시 판정에 반영되어 한도를 넘지 않아야 한다.
describe('AiCostLimitGuardService — 동시성 한도 보호(DAR-242)', () => {
  /**
   * costUsd를 settle 전에는 committed에 반영하지 않는 상태형 가짜 Prisma.
   * aggregate는 매 호출 현재 committed 합계를 반환한다(일·월 동일값 — 일 한도만 바인딩).
   */
  function makeStatefulService() {
    const state = { committed: 0 };
    const prisma = {
      aIUsageLog: {
        aggregate: jest.fn(async () => ({ _sum: { costUsd: state.committed } })),
      },
    } as unknown as PrismaService;
    return { svc: new AiCostLimitGuardService(prisma, makeConfig()), state };
  }

  it('한도 직전 동시 N잡: committed 누적이 일 한도를 넘지 않는다', async () => {
    const { svc, state } = makeStatefulService();
    const N = 50;
    const COST_PER_CALL = AiCostLimitGuardService.RESERVATION_USD; // 보수적 추정과 동일(상한)

    let proceeded = 0;
    // enforceLimit → (통과 시) 비동기 호출 모사 → committed 반영 → settle.
    // 생산 흐름(call → logUsage(commit) → settle)을 동일 순서로 재현한다.
    const job = async () => {
      const reservation = await svc.enforceLimit(AiCostLevel.L2);
      if (reservation.level === AiCostLevel.L0) {
        reservation.settle();
        return;
      }
      await Promise.resolve(); // 호출 지연(인플라이트) 모사
      state.committed += COST_PER_CALL; // logUsage = committed 반영
      proceeded += 1;
      reservation.settle();
    };

    await Promise.all(Array.from({ length: N }, () => job()));

    // 핵심 단언: 동시성에도 누적 비용이 일 한도를 초과하지 않는다.
    // (정확히 20×$0.05=$1.00에서 차단 — 부동소수 누적 오차 ~1e-9만 허용.)
    const FP_EPSILON = 1e-9;
    expect(state.committed).toBeLessThanOrEqual(svc.dailyLimitUsd + FP_EPSILON);
    // 정상 처리량: 한도 내 가능한 만큼은 통과(전부 차단되지 않음).
    expect(proceeded).toBeGreaterThan(0);
    // 보호가 없었다면 50 × 0.05 = $2.5로 돌파했을 것 — 한도 $1 내로 묶였음을 확인.
    expect(proceeded).toBeLessThanOrEqual(svc.dailyLimitUsd / COST_PER_CALL);
  });

  it('통과 슬롯 settle 후 예약이 해제되어 후속 호출이 다시 통과한다', async () => {
    const { svc, state } = makeStatefulService();
    // 첫 통과 → 아직 commit 전이라도 예약이 점유된다.
    const r1 = await svc.enforceLimit(AiCostLevel.L2);
    expect(r1.level).toBe(AiCostLevel.L2);
    // 호출 완료 → commit + settle.
    state.committed += AiCostLimitGuardService.RESERVATION_USD;
    r1.settle();
    // 한도 여유가 남아 있으므로 후속 호출도 통과해야 한다.
    const r2 = await svc.enforceLimit(AiCostLevel.L2);
    expect(r2.level).toBe(AiCostLevel.L2);
    r2.settle();
  });
});
