/**
 * kill-switch-persistence.spec.ts — Kill Switch DB 영속·복원·재시작 시나리오 (DAR-350)
 *
 * 거짓 안전 교정 회귀고정: 킬스위치 발동 상태가 in-memory 전용이면 재시작 시 isActive 유실 →
 * 발동 중이었어도 재기동 후 주문이 통과하는 파국. 영속화로 이를 차단한다.
 *
 * 검증:
 *   1) activate/deactivate가 영속 레포에 전이를 append
 *   2) "프로세스 재시작"(새 매니저 + load)이 최신 상태를 복원
 *   3) 복원된 활성 상태가 OrderRiskService veto로 신규 주문을 차단(end-to-end)
 *   4) 레포 미주입(인메모리 모드) 하위호환 — 동작 불변
 *   5) PrismaKillSwitchStateRepository ↔ Prisma row 매핑(목 DB)
 *
 * AI 금지영역: 순수 Rule 안전망. AI 개입 0.
 */

import { KillSwitchManager } from './domain/kill-switch';
import {
  InMemoryKillSwitchStateRepository,
  PersistedKillSwitchState,
} from './repositories/kill-switch-state.repository';
import { PrismaKillSwitchStateRepository } from './repositories/prisma-kill-switch-state.repository';
import { OrderRiskService, OrderRiskRequest } from './services/order-risk.service';
import { InMemoryAuditLogRepository } from './repositories/in-memory-audit-log.repository';

// ─── 1. 영속화: activate/deactivate가 전이를 기록 ───────────────────────

describe('KillSwitchManager 영속화 (DAR-350)', () => {
  it('activate → 레포에 활성 전이 1행 append', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const ks = new KillSwitchManager(repo);

    await ks.activate('연속 손실 5회', 'SYSTEM');

    expect(repo.size()).toBe(1);
    const persisted = await repo.loadLatest();
    expect(persisted).toMatchObject<Partial<PersistedKillSwitchState>>({
      isActive: true,
      reason: '연속 손실 5회',
      triggeredBy: 'SYSTEM',
    });
    expect(persisted?.activatedAt).toBeInstanceOf(Date);
    expect(persisted?.deactivatedAt).toBeNull();
  });

  // ─── DAR-476(P02): 발동 통지 포트 ─────────────────────────────────────
  it('activate → 통지 포트 onActivated 1회 호출(reason·triggeredBy·activatedAt)', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const onActivated = jest.fn();
    const ks = new KillSwitchManager(repo, { onActivated });

    await ks.activate('연속 손실 5회', 'SYSTEM');

    expect(onActivated).toHaveBeenCalledTimes(1);
    const event = onActivated.mock.calls[0][0];
    expect(event).toMatchObject({ reason: '연속 손실 5회', triggeredBy: 'SYSTEM' });
    expect(event.activatedAt).toBeInstanceOf(Date);
  });

  it('autoCheck 자동 발동도 통지 포트로 흐른다(수동/자동 불문)', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const onActivated = jest.fn();
    const ks = new KillSwitchManager(repo, { onActivated });

    // 연속손실 임계 초과 → autoCheck 가 activate 를 호출.
    await ks.autoCheck({ consecutiveLossCount: 99, marketDropPct: 0, apiErrorCount: 0 });

    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(onActivated.mock.calls[0][0].triggeredBy).toBe('SYSTEM');
  });

  it('통지 포트 미주입이어도 activate 는 정상(하위호환·룰 불변)', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const ks = new KillSwitchManager(repo); // notifier 미주입

    await expect(ks.activate('이유', 'USER')).resolves.toBeUndefined();
    expect(ks.isActive()).toBe(true);
  });

  it('deactivate → 레포에 비활성 전이 append (히스토리 누적)', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const ks = new KillSwitchManager(repo);

    await ks.activate('이유', 'USER');
    await ks.deactivate();

    expect(repo.size()).toBe(2); // append-only 히스토리
    const persisted = await repo.loadLatest();
    expect(persisted?.isActive).toBe(false);
    expect(persisted?.triggeredBy).toBe('USER');
    expect(persisted?.deactivatedAt).toBeInstanceOf(Date);
  });

  it('autoCheck 자동 발동도 레포에 기록', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const ks = new KillSwitchManager(repo);

    await ks.autoCheck({
      consecutiveLossCount: 5,
      marketDropPct: 0,
      apiErrorCount: 0,
    });

    expect(ks.isActive()).toBe(true);
    expect(repo.size()).toBe(1);
    expect((await repo.loadLatest())?.isActive).toBe(true);
  });
});

// ─── 2. 재시작 복원: ★ 거짓 안전 교정의 핵심 ─────────────────────────────

describe('재시작 시 상태 복원 (거짓 안전 교정)', () => {
  it('발동 상태에서 재기동 → load 후 isActive=true 복원', async () => {
    const repo = new InMemoryKillSwitchStateRepository();

    // 부팅#1: 발동
    const before = new KillSwitchManager(repo);
    await before.onModuleInit(); // 빈 DB → 비활성
    expect(before.isActive()).toBe(false);
    await before.activate('API 오류 누적 3회', 'SYSTEM');
    expect(before.isActive()).toBe(true);

    // 프로세스 재시작: 새 매니저(인메모리 state 초기화) + 동일 레포(DB)
    const after = new KillSwitchManager(repo);
    expect(after.isActive()).toBe(false); // load 전: 기본 비활성
    await after.onModuleInit(); // 부팅 복원

    expect(after.isActive()).toBe(true); // ★ 유실 없이 복원
    expect(after.getState().reason).toBe('API 오류 누적 3회');
    expect(after.getState().triggeredBy).toBe('SYSTEM');
  });

  it('해제 상태로 재기동 → 비활성 복원 (운영자 해제 존중)', async () => {
    const repo = new InMemoryKillSwitchStateRepository();

    const before = new KillSwitchManager(repo);
    await before.activate('이유', 'SYSTEM');
    await before.deactivate(); // 운영자 확인 후 해제

    const after = new KillSwitchManager(repo);
    await after.onModuleInit();

    expect(after.isActive()).toBe(false); // 가장 최근 전이=해제
  });

  it('영속 기록 없으면 부팅 기본=비활성', async () => {
    const repo = new InMemoryKillSwitchStateRepository();
    const ks = new KillSwitchManager(repo);
    await ks.onModuleInit();
    expect(ks.isActive()).toBe(false);
  });
});

// ─── 3. End-to-end: 복원된 발동 상태가 신규 주문 차단 ──────────────────

describe('재시작 후 발동 상태 → 신규 주문 차단 (end-to-end)', () => {
  function buyRequest(): OrderRiskRequest {
    return {
      idempotencyKey: 'idem-1',
      corpCode: '00126380',
      stockCode: '005930',
      side: 'BUY',
      requestedShares: 10,
      limitPrice: 70000,
      totalCapital: 10_000_000,
      currentPositionValue: 0,
      dailyPnl: 0,
      weeklyPnl: 0,
      openOrderCount: 0,
      todayTradeCount: 0,
      buyScore: 5, // 긍정 점수여도 veto 우선
    };
  }

  it('발동 → 재기동 → evaluateOrder 거부 (재기동 후 주문 통과 파국 방지)', async () => {
    const ksRepo = new InMemoryKillSwitchStateRepository();

    // 부팅#1: 운영 중 발동
    const ks1 = new KillSwitchManager(ksRepo);
    await ks1.onModuleInit();
    await ks1.activate('연속 손실 5회', 'SYSTEM');

    // 부팅#2: 재시작 — 새 매니저/새 서비스, 동일 DB
    const ks2 = new KillSwitchManager(ksRepo);
    await ks2.onModuleInit();
    const service = new OrderRiskService(
      new InMemoryAuditLogRepository(),
      ks2,
    );

    expect(service.isKillSwitchActive()).toBe(true);
    const res = await service.evaluateOrder(buyRequest());
    expect(res.approved).toBe(false);
    expect(
      res.result.violations.some((v) => v.code === 'KILL_SWITCH_ACTIVE'),
    ).toBe(true);
  });

  it('대조군: 영속 없으면(과거 버그) 재기동 매니저는 비활성 → 주문 통과', async () => {
    // in-memory 전용(레포 미주입) 매니저는 재기동 시 상태를 잃는다 — 교정 전 동작 재현.
    const ks1 = new KillSwitchManager(); // no repo
    await ks1.activate('연속 손실 5회', 'SYSTEM');
    expect(ks1.isActive()).toBe(true);

    const ks2 = new KillSwitchManager(); // 재기동 = 새 인스턴스, 복원 불가
    const service = new OrderRiskService(new InMemoryAuditLogRepository(), ks2);
    expect(service.isKillSwitchActive()).toBe(false); // ★ 거짓 안전
    const res = await service.evaluateOrder(buyRequest());
    // 킬스위치 veto가 발동하지 않음 — 영속이 왜 필요한지 증명(다른 룰과 무관).
    expect(
      res.result.violations.some((v) => v.code === 'KILL_SWITCH_ACTIVE'),
    ).toBe(false);
  });
});

// ─── 4. 하위호환: 레포 미주입 인메모리 모드 ─────────────────────────────

describe('하위호환 (레포 미주입)', () => {
  it('load/onModuleInit no-op, 인메모리 동작 불변', async () => {
    const ks = new KillSwitchManager();
    await ks.onModuleInit(); // throw 없음
    expect(ks.isActive()).toBe(false);
    await ks.activate('x', 'USER');
    expect(ks.isActive()).toBe(true);
    await ks.deactivate();
    expect(ks.isActive()).toBe(false);
  });
});

// ─── 5. PrismaKillSwitchStateRepository ↔ Prisma row 매핑 (목 DB) ───────

describe('PrismaKillSwitchStateRepository (목 Prisma)', () => {
  function makePrismaMock() {
    const killSwitchState = {
      create: jest.fn(),
      findFirst: jest.fn(),
    };
    return { mock: { killSwitchState } as any, killSwitchState };
  }

  it('append → killSwitchState.create에 전이 데이터 전달', async () => {
    const { mock, killSwitchState } = makePrismaMock();
    killSwitchState.create.mockResolvedValue({});
    const repo = new PrismaKillSwitchStateRepository(mock);

    const activatedAt = new Date('2026-06-19T00:00:00Z');
    await repo.append({
      isActive: true,
      reason: 'API 오류 누적 3회',
      triggeredBy: 'SYSTEM',
      activatedAt,
      deactivatedAt: null,
    });

    expect(killSwitchState.create).toHaveBeenCalledWith({
      data: {
        isActive: true,
        reason: 'API 오류 누적 3회',
        triggeredBy: 'SYSTEM',
        activatedAt,
        deactivatedAt: null,
      },
    });
  });

  it('loadLatest → createdAt 내림차순 findFirst, row→도메인 매핑', async () => {
    const { mock, killSwitchState } = makePrismaMock();
    const activatedAt = new Date('2026-06-19T01:00:00Z');
    killSwitchState.findFirst.mockResolvedValue({
      id: 'ks-1',
      isActive: true,
      reason: '연속 손실 5회',
      triggeredBy: 'USER',
      activatedAt,
      deactivatedAt: null,
      createdAt: new Date('2026-06-19T01:00:00Z'),
      updatedAt: new Date('2026-06-19T01:00:00Z'),
    });
    const repo = new PrismaKillSwitchStateRepository(mock);

    const result = await repo.loadLatest();

    expect(killSwitchState.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      isActive: true,
      reason: '연속 손실 5회',
      triggeredBy: 'USER',
      activatedAt,
      deactivatedAt: null,
    });
  });

  it('loadLatest → 기록 없으면 null', async () => {
    const { mock, killSwitchState } = makePrismaMock();
    killSwitchState.findFirst.mockResolvedValue(null);
    const repo = new PrismaKillSwitchStateRepository(mock);
    expect(await repo.loadLatest()).toBeNull();
  });

  it('triggeredBy 알 수 없는 값 → 보수적으로 SYSTEM', async () => {
    const { mock, killSwitchState } = makePrismaMock();
    killSwitchState.findFirst.mockResolvedValue({
      id: 'ks-2',
      isActive: false,
      reason: null,
      triggeredBy: 'WEIRD',
      activatedAt: null,
      deactivatedAt: new Date('2026-06-19T02:00:00Z'),
      createdAt: new Date('2026-06-19T02:00:00Z'),
      updatedAt: new Date('2026-06-19T02:00:00Z'),
    });
    const repo = new PrismaKillSwitchStateRepository(mock);
    expect((await repo.loadLatest())?.triggeredBy).toBe('SYSTEM');
  });
});
