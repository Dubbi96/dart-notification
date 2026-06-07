// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.controller.spec.ts
// DAR-112: 게스트 정량 fact 조회 컨트롤러 단위 테스트 (read-only 매핑·빈 배열 분기)

import { DartFiledFact } from '@prisma/client';
import { DartFiledFactController } from './dart-filed-fact.controller';
import { DartFiledFactService } from './dart-filed-fact.service';

describe('DartFiledFactController', () => {
  let controller: DartFiledFactController;
  let service: { findByRcpNo: jest.Mock };

  beforeEach(() => {
    service = { findByRcpNo: jest.fn() };
    controller = new DartFiledFactController(
      service as unknown as DartFiledFactService,
    );
  });

  it('rcpNo로 조회한 fact를 응답 DTO 형태로 매핑한다', async () => {
    const row: DartFiledFact = {
      id: 'c1',
      rcpNo: '20240101000001',
      corpCode: '00126380',
      factKey: 'CONTRACT_AMOUNT',
      value: '1500000000',
      numericValue: 1500000000,
      unit: '원',
      period: '2024-12-31',
      sectionPath: 'parsedJson.contractAmount',
      docType: 'SUPPLY_CONTRACT',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };
    service.findByRcpNo.mockResolvedValue([row]);

    const result = await controller.getFacts('20240101000001');

    expect(service.findByRcpNo).toHaveBeenCalledWith('20240101000001');
    expect(result).toEqual([
      {
        rcpNo: '20240101000001',
        corpCode: '00126380',
        factKey: 'CONTRACT_AMOUNT',
        value: '1500000000',
        numericValue: 1500000000,
        unit: '원',
        period: '2024-12-31',
        sectionPath: 'parsedJson.contractAmount',
        docType: 'SUPPLY_CONTRACT',
      },
    ]);
    // 내부 필드(id·createdAt·updatedAt)는 노출하지 않는다.
    expect(result[0]).not.toHaveProperty('id');
    expect(result[0]).not.toHaveProperty('createdAt');
  });

  it('적재된 fact가 없으면 빈 배열을 반환한다(빈 상태 분기)', async () => {
    service.findByRcpNo.mockResolvedValue([]);

    const result = await controller.getFacts('99999999999999');

    expect(result).toEqual([]);
  });
});
