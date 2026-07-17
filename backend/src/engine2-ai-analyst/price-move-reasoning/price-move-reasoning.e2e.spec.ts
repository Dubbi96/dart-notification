import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceMoveReasoningController } from './price-move-reasoning.controller';
import { PriceMoveReasoningQueryService } from './price-move-reasoning-query.service';
import { PriceMoveReasoningRepository } from './price-move-reasoning.repository';
import { AiCostLevel } from '../types/ai-analyst.types';

/**
 * DAR-526 — GET /api/price-move-reasonings/:refId HTTP 동작 재현(결정론적).
 * main.ts 와 동일한 와이어링(setGlobalPrefix('api') + AllExceptionsFilter)을 최소 Nest 앱에 적용,
 * 실제 서비스(→repo/prisma 목)를 태워 라우팅·`:refId` 바인딩·`{ success, data }` 봉투·404 에러
 * 계약(FE 가 '로딩실패'로 degrade)을 실 HTTP 로 검증한다. supertest 불필요(Node fetch).
 */

const REF_ID = '005930-20260717';

const record = {
  refId: REF_ID,
  stockCode: '005930',
  corpCode: '00126380',
  tradeDate: '20260717',
  changePct: 6.3,
  rcpNo: '20260717000123',
  status: 'ANALYZED' as const,
  level: AiCostLevel.L1,
  resultJson: {
    status: 'ANALYZED',
    eventType: 'SUPPLY_CONTRACT',
    cause: '공급계약 체결 공시가 상승을 유발한 것으로 보인다.',
    evidence: ['공급계약 공시'],
    eventLinkage: 'STRONG',
    caveat: '상관≠인과.',
  },
  createdAt: new Date('2026-07-17T05:30:00.000Z'),
};

describe('GET /api/price-move-reasonings/:refId (DAR-526, HTTP e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const repo = { find: jest.fn(), save: jest.fn() };
  const prisma = { company: { findUnique: jest.fn() } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PriceMoveReasoningController],
      providers: [
        PriceMoveReasoningQueryService,
        { provide: PriceMoveReasoningRepository, useValue: repo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // main.ts 와 동일
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    repo.find.mockReset();
    prisma.company.findUnique.mockReset();
  });

  it('존재 refId → 200 `{ success, data }` (corpName 조인·계약 필드)', async () => {
    repo.find.mockResolvedValueOnce(record);
    prisma.company.findUnique.mockResolvedValueOnce({ corpName: '삼성전자' });

    const res = await fetch(`${baseUrl}/api/price-move-reasonings/${REF_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      refId: REF_ID,
      stockCode: '005930',
      corpCode: '00126380',
      corpName: '삼성전자',
      tradeDate: '20260717',
      changePct: 6.3,
      rcpNo: '20260717000123',
      status: 'ANALYZED',
      resultJson: record.resultJson,
      createdAt: '2026-07-17T05:30:00.000Z',
    });
    // :refId 가 서비스로 그대로 전달됐는지(경로 바인딩) 확인.
    expect(repo.find).toHaveBeenCalledWith(REF_ID);
  });

  it('미존재 refId → 404 표준 에러 봉투(FE 로딩실패 degrade)', async () => {
    repo.find.mockResolvedValueOnce(null);

    const res = await fetch(`${baseUrl}/api/price-move-reasonings/999999-20260717`);
    expect(res.status).toBe(404);
    const body = await res.json();

    expect(body).toEqual({
      success: false,
      error: {
        code: 'PRICE_MOVE_REASONING_NOT_FOUND',
        message: expect.stringContaining('999999-20260717'),
      },
    });
    // 404 경로는 Company 조회를 하지 않는다(레코드 부재 시 즉시 종료).
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
});
