/**
 * AuditLogQueryController / AuditLogQueryService 스펙 (DAR-351)
 *
 * 회귀 가드:
 *  1) 컨트롤러가 parsePaginationInt 정본으로 page/limit 를 정규화해 서비스에 전달
 *     (비숫자/음수 → 기본값/하한, 거대값 → 상한 200). 무한 쿼리 차단.
 *  2) 컨트롤러가 from/to/actorKind/action/orderRequestId 필터를 그대로 위임하고
 *     { success, data } 로 감싼다.
 *  3) 서비스 buildWhere: action/actorKind/orderRequestId 정확 일치 + from/to → createdAt 범위.
 *  4) 서비스가 최신순(createdAt desc) + skip/take 페이지네이션 + count 로 total 산출.
 *  5) 미지원 action / 파싱 불가 날짜 → BadRequestException (조용한 빈 결과 금지).
 *  6) 모듈 배선: AuditLogQueryController + AuditLogQueryService 등록.
 *  7) read-only: 서비스는 prisma 쓰기(create/update/delete)를 호출하지 않는다.
 */
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditLogQueryController } from './audit-log-query.controller';
import {
  AuditLogQueryService,
  AuditLogQuery,
} from './audit-log-query.service';
import { TradingRiskModule } from '../trading-risk.module';
import { PrismaService } from '../../prisma/prisma.service';

function sampleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log-1',
    action: AuditAction.RISK_REJECTED,
    actorKind: 'RISK_ENGINE',
    summary: 'Risk veto: DAILY_LOSS',
    orderRequestId: 'ord-1',
    executionId: null,
    meta: { vetoed: true },
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AuditLogQueryController', () => {
  const service = {
    findMany: jest.fn(),
  } as unknown as jest.Mocked<AuditLogQueryService>;

  let controller: AuditLogQueryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuditLogQueryController(service);
    (service.findMany as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 0,
    });
  });

  it('필터를 위임하고 { success, data } 로 감싼다', async () => {
    const res = await controller.findMany(
      '2026-06-01T00:00:00.000Z',
      '2026-06-30T00:00:00.000Z',
      'RISK_ENGINE',
      'RISK_REJECTED',
      'ord-1',
      '2',
      '10',
    );
    expect(res.success).toBe(true);
    const arg = (service.findMany as jest.Mock).mock.calls[0][0] as AuditLogQuery;
    expect(arg.from).toBe('2026-06-01T00:00:00.000Z');
    expect(arg.to).toBe('2026-06-30T00:00:00.000Z');
    expect(arg.actorKind).toBe('RISK_ENGINE');
    expect(arg.action).toBe('RISK_REJECTED');
    expect(arg.orderRequestId).toBe('ord-1');
    expect(arg.page).toBe(2);
    expect(arg.limit).toBe(10);
  });

  it('page/limit 미지정 → 기본값(1/50)', async () => {
    await controller.findMany();
    const arg = (service.findMany as jest.Mock).mock.calls[0][0] as AuditLogQuery;
    expect(arg.page).toBe(1);
    expect(arg.limit).toBe(50);
  });

  it('비숫자/음수 page·limit → 기본값/하한(parsePaginationInt 정본)', async () => {
    await controller.findMany(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'abc',
      '-5',
    );
    const arg = (service.findMany as jest.Mock).mock.calls[0][0] as AuditLogQuery;
    expect(arg.page).toBe(1); // 'abc' → default 1
    expect(arg.limit).toBe(1); // -5 → min 1
  });

  it('거대 limit → 상한 200 으로 클램프(무한 쿼리 차단)', async () => {
    await controller.findMany(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '1',
      '99999',
    );
    const arg = (service.findMany as jest.Mock).mock.calls[0][0] as AuditLogQuery;
    expect(arg.limit).toBe(200);
  });
});

describe('AuditLogQueryService', () => {
  function makePrisma(rows: unknown[], total: number) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(total);
    const create = jest.fn();
    const update = jest.fn();
    const del = jest.fn();
    const prisma = {
      tradingAuditLog: { findMany, count, create, update, delete: del },
    } as unknown as PrismaService;
    return { prisma, findMany, count, create, update, del };
  }

  it('필터 → where 매핑(action·actorKind·orderRequestId·from/to) + 최신순·skip/take', async () => {
    const { prisma, findMany, count } = makePrisma([sampleRow()], 1);
    const svc = new AuditLogQueryService(prisma);

    const res = await svc.findMany({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
      actorKind: 'RISK_ENGINE',
      action: 'RISK_REJECTED',
      orderRequestId: 'ord-1',
      page: 2,
      limit: 10,
    });

    const callArg = findMany.mock.calls[0][0];
    expect(callArg.where).toEqual({
      action: AuditAction.RISK_REJECTED,
      actorKind: 'RISK_ENGINE',
      orderRequestId: 'ord-1',
      createdAt: {
        gte: new Date('2026-06-01T00:00:00.000Z'),
        lte: new Date('2026-06-30T00:00:00.000Z'),
      },
    });
    expect(callArg.orderBy).toEqual({ createdAt: 'desc' });
    expect(callArg.skip).toBe(10); // (page2-1)*limit10
    expect(callArg.take).toBe(10);
    expect(count.mock.calls[0][0].where).toEqual(callArg.where);

    expect(res.total).toBe(1);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
    expect(res.totalPages).toBe(1);
    expect(res.items[0]).toMatchObject({
      id: 'log-1',
      action: AuditAction.RISK_REJECTED,
      createdAt: '2026-06-10T00:00:00.000Z',
      meta: { vetoed: true },
    });
  });

  it('필터 없으면 where 가 빈 객체(전체 조회)', async () => {
    const { prisma, findMany } = makePrisma([], 0);
    const svc = new AuditLogQueryService(prisma);
    await svc.findMany({ page: 1, limit: 50 });
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('from 만 주면 createdAt.gte 만 설정', async () => {
    const { prisma, findMany } = makePrisma([], 0);
    const svc = new AuditLogQueryService(prisma);
    await svc.findMany({ from: '2026-06-01T00:00:00.000Z', page: 1, limit: 50 });
    expect(findMany.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date('2026-06-01T00:00:00.000Z') },
    });
  });

  it('totalPages = ceil(total/limit)', async () => {
    const { prisma } = makePrisma([], 23);
    const svc = new AuditLogQueryService(prisma);
    const res = await svc.findMany({ page: 1, limit: 10 });
    expect(res.totalPages).toBe(3);
  });

  it('미지원 action → BadRequestException', async () => {
    const { prisma } = makePrisma([], 0);
    const svc = new AuditLogQueryService(prisma);
    await expect(
      svc.findMany({ action: 'NOPE', page: 1, limit: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('파싱 불가 from 날짜 → BadRequestException', async () => {
    const { prisma } = makePrisma([], 0);
    const svc = new AuditLogQueryService(prisma);
    await expect(
      svc.findMany({ from: 'not-a-date', page: 1, limit: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('read-only: prisma 쓰기(create/update/delete) 미호출', async () => {
    const { prisma, create, update, del } = makePrisma([sampleRow()], 1);
    const svc = new AuditLogQueryService(prisma);
    await svc.findMany({ page: 1, limit: 50 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('TradingRiskModule 배선', () => {
  it('AuditLogQueryController + AuditLogQueryService 를 등록한다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TradingRiskModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(AuditLogQueryService)).toBeInstanceOf(
      AuditLogQueryService,
    );
    expect(moduleRef.get(AuditLogQueryController)).toBeInstanceOf(
      AuditLogQueryController,
    );
    await moduleRef.close();
  });
});
