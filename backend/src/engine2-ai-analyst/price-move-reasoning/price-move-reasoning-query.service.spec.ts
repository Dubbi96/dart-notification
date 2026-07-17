import { NotFoundException } from '@nestjs/common';
import { PriceMoveReasoningQueryService } from './price-move-reasoning-query.service';
import { PriceMoveReasoningRecord } from './price-move-reasoning.repository';
import { AiCostLevel } from '../types/ai-analyst.types';

/**
 * DAR-526 — GET /price-move-reasonings/:refId 조회 서비스 계약 스펙.
 * FE 계약(mobile types/priceMove.types.ts) 1:1 매핑·corpName 조인·404·내부필드 제외를 단언한다.
 */

const CREATED_AT = new Date('2026-07-17T05:30:00.000Z');

function record(overrides: Partial<PriceMoveReasoningRecord> = {}): PriceMoveReasoningRecord {
  return {
    refId: '005930-20260717',
    stockCode: '005930',
    corpCode: '00126380',
    tradeDate: '20260717',
    changePct: 6.3,
    rcpNo: '20260717000123',
    status: 'ANALYZED',
    level: AiCostLevel.L1,
    resultJson: {
      status: 'ANALYZED',
      eventType: 'SUPPLY_CONTRACT',
      cause: '대형 공급계약 체결 공시가 상승을 유발한 것으로 보인다.',
      evidence: ['공급계약 공시(rcpNo=20260717000123)', '유사사례 D+1 평균 +2.1%(n=42)'],
      eventLinkage: 'STRONG',
      caveat: '상관≠인과 — 시장/수급 요인 가능성.',
    },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function build(overrides: { find?: any; company?: any } = {}) {
  const repo = {
    find: overrides.find ?? jest.fn().mockResolvedValue(record()),
    save: jest.fn(),
  };
  const prisma = {
    company: {
      findUnique:
        overrides.company ?? jest.fn().mockResolvedValue({ corpName: '삼성전자' }),
    },
  };
  const service = new PriceMoveReasoningQueryService(repo as any, prisma as any);
  return { service, repo, prisma };
}

describe('PriceMoveReasoningQueryService (DAR-526)', () => {
  it('ANALYZED — FE 계약 필드 1:1 + corpName 조인, 내부 level 제외·createdAt ISO', async () => {
    const { service, prisma } = build();

    const view = await service.getByRefId('005930-20260717');

    expect(view).toEqual({
      refId: '005930-20260717',
      stockCode: '005930',
      corpCode: '00126380',
      corpName: '삼성전자',
      tradeDate: '20260717',
      changePct: 6.3,
      rcpNo: '20260717000123',
      status: 'ANALYZED',
      resultJson: {
        status: 'ANALYZED',
        eventType: 'SUPPLY_CONTRACT',
        cause: '대형 공급계약 체결 공시가 상승을 유발한 것으로 보인다.',
        evidence: ['공급계약 공시(rcpNo=20260717000123)', '유사사례 D+1 평균 +2.1%(n=42)'],
        eventLinkage: 'STRONG',
        caveat: '상관≠인과 — 시장/수급 요인 가능성.',
      },
      createdAt: '2026-07-17T05:30:00.000Z',
    });
    // 내부 전용 필드는 노출하지 않는다.
    expect(view).not.toHaveProperty('level');
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { corpCode: '00126380' },
      select: { corpName: true },
    });
  });

  it('NO_DISCLOSURE — rcpNo=null·포맷 응답을 그대로 반환', async () => {
    const { service } = build({
      find: jest.fn().mockResolvedValue(
        record({
          status: 'NO_DISCLOSURE',
          rcpNo: null,
          level: null,
          resultJson: {
            status: 'NO_DISCLOSURE',
            label: '관련 공시 없음(48h)',
            message: '삼성전자 +6.3% — 관련 공시 없음(48h)',
          },
        }),
      ),
    });

    const view = await service.getByRefId('005930-20260717');

    expect(view.status).toBe('NO_DISCLOSURE');
    expect(view.rcpNo).toBeNull();
    expect(view.resultJson).toMatchObject({ status: 'NO_DISCLOSURE', label: '관련 공시 없음(48h)' });
  });

  it('CAP_SKIPPED — 비용 상한 스킵 포맷 응답을 그대로 반환', async () => {
    const { service } = build({
      find: jest.fn().mockResolvedValue(
        record({
          status: 'CAP_SKIPPED',
          rcpNo: null,
          level: null,
          resultJson: { status: 'CAP_SKIPPED', message: '일일 비용 상한 초과로 해석을 건너뛰었습니다.' },
        }),
      ),
    });

    const view = await service.getByRefId('005930-20260717');

    expect(view.status).toBe('CAP_SKIPPED');
    expect(view.resultJson).toMatchObject({ status: 'CAP_SKIPPED' });
  });

  it('corpName 미조회(Company 없음) → corpName=null (FE 는 stockCode 폴백)', async () => {
    const { service } = build({ company: jest.fn().mockResolvedValue(null) });

    const view = await service.getByRefId('005930-20260717');

    expect(view.corpName).toBeNull();
    expect(view.stockCode).toBe('005930');
  });

  it('미존재 refId → NotFoundException(404)·Company 조회하지 않음', async () => {
    const { service, prisma } = build({ find: jest.fn().mockResolvedValue(null) });

    await expect(service.getByRefId('999999-20260717')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
});
