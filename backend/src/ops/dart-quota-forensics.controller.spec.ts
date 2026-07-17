import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { DartQuotaForensicsController } from './dart-quota-forensics.controller';
import { DartQuotaForensicsService } from './dart-quota-forensics.service';

/**
 * DAR-536 HTTP 동작 재현(결정론적) — main-bootstrap.smoke 패턴.
 * 실제 컨트롤러 + 실제 서비스(프리즈마만 모킹)를 main.ts 와 동일 와이어링
 * (setGlobalPrefix('api') + AllExceptionsFilter)으로 띄워 실 HTTP 로 검증한다:
 *  - GET /api/ops/dart-quota-forensics → 200 {success:true, data} 봉투 + 리포트 골격
 *  - date 형식 위반 → 400 {success:false, error:{code:'INVALID_DATE_PARAM'}}
 */
describe('GET /api/ops/dart-quota-forensics (실 HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const emptyPrisma = {
    dartQuotaState: { findUnique: jest.fn().mockResolvedValue(null) },
    disclosureCollectionLog: { findMany: jest.fn().mockResolvedValue([]) },
    cronRunLog: { findMany: jest.fn().mockResolvedValue([]) },
    financialCollectionLog: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DartQuotaForensicsController],
      providers: [
        DartQuotaForensicsService,
        { provide: PrismaService, useValue: emptyPrisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts 와 동일 와이어링 — 라우트 경로(/api 하위)와 에러 봉투 매핑을 실 HTTP 로 검증.
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 — {success:true, data} 봉투 + 리포트 골격(24시간·경로 7종·판정 필드)', async () => {
    const res = await fetch(`${baseUrl}/api/ops/dart-quota-forensics?date=20260715`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        metric: string;
        date: string;
        hourly: unknown[];
        night: { paths: unknown[] };
        hypothesis: { verdict: string };
        quotaState: { found: boolean };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.metric).toBe('dart-quota-forensics');
    expect(body.data.date).toBe('20260715');
    expect(body.data.hourly).toHaveLength(24);
    expect(body.data.night.paths).toHaveLength(7);
    expect(body.data.quotaState.found).toBe(false);
    expect(body.data.hypothesis.verdict).toBe('INCONCLUSIVE'); // 소비 흔적 0건
  });

  it('400 — date 형식 위반 시 {success:false, error:{code:INVALID_DATE_PARAM}}', async () => {
    const res = await fetch(`${baseUrl}/api/ops/dart-quota-forensics?date=2026-07-15`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_DATE_PARAM');
  });
});
