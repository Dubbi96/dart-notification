/**
 * companies.controller.spec.ts — 라우트 위임 계약 (DAR-190)
 *
 * 종목 상세 "통계" 탭이 호출하던 GET /companies/:corpCode/event-study 라우트 부재로
 * 전종목 404 가 나던 버그의 회귀 가드. 컨트롤러가 EventStudyQueryService 로 위임하고
 * { success, data } 래핑을 유지하는지 검증한다.
 */
import { RequestMethod } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

describe('CompaniesController GET :corpCode/event-study 라우트 등록 (404 회귀 가드)', () => {
  it('handler 가 GET :corpCode/event-study 경로로 등록되어야 한다', () => {
    const path = Reflect.getMetadata('path', CompaniesController.prototype.getEventStudy);
    const method = Reflect.getMetadata('method', CompaniesController.prototype.getEventStudy);
    expect(path).toBe(':corpCode/event-study');
    expect(method).toBe(RequestMethod.GET);
  });

  it('게스트 열람 허용 — OptionalJwtAuthGuard (JwtAuthGuard 로 회귀 금지)', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      CompaniesController.prototype.getEventStudy,
    ) as unknown[];
    expect(guards).toBeDefined();
    expect(guards).toContain(OptionalJwtAuthGuard);
  });
});

describe('CompaniesController.getEventStudy()', () => {
  function setup(data: any[]) {
    const findResultsByCorpCode = jest.fn().mockResolvedValue(data);
    const companiesService = {} as any;
    const eventStudyQueryService = { findResultsByCorpCode } as any;
    const controller = new CompaniesController(companiesService, eventStudyQueryService);
    return { controller, findResultsByCorpCode };
  }

  it('delegates to findResultsByCorpCode and wraps in { success, data }', async () => {
    const rows = [{ id: 'r1', eventType: 'SUPPLY_CONTRACT' }];
    const { controller, findResultsByCorpCode } = setup(rows);

    const res = await controller.getEventStudy('00126380', 'SUPPLY_CONTRACT', 'KOSPI');

    expect(findResultsByCorpCode).toHaveBeenCalledWith({
      corpCode: '00126380',
      eventType: 'SUPPLY_CONTRACT',
      marketType: 'KOSPI',
    });
    expect(res).toEqual({ success: true, data: rows });
  });

  it('passes through an empty result as success (빈상태, 에러 아님)', async () => {
    const { controller } = setup([]);

    const res = await controller.getEventStudy('NEW_CORP');

    expect(res).toEqual({ success: true, data: [] });
  });
});
