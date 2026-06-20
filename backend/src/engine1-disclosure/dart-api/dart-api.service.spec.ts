// backend/src/engine1-disclosure/dart-api/dart-api.service.spec.ts
// DAR-396: getAllDisclosuresWithMeta — 쿼터(020/021) 인지 종료, 정상 완주, 데이터없음, 비정상 status.

import { ConfigService } from '@nestjs/config';
import { DartApiService, DartListResponse } from './dart-api.service';

function listResponse(over: Partial<DartListResponse>): DartListResponse {
  return {
    status: '000',
    message: '정상',
    page_no: 1,
    page_count: 100,
    total_count: 0,
    total_page: 1,
    list: [],
    ...over,
  };
}

function disclosure(rcptNo: string, rcptDt: string) {
  return {
    corp_code: '00126380',
    corp_name: '삼성전자',
    stock_code: '005930',
    corp_cls: 'Y',
    report_nm: '주요사항보고서',
    rcept_no: rcptNo,
    flr_nm: '삼성전자',
    rcept_dt: rcptDt,
    rm: '',
  };
}

describe('DartApiService.getAllDisclosuresWithMeta (DAR-396)', () => {
  let service: DartApiService;

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') } as unknown as ConfigService;
    service = new DartApiService(config);
  });

  it('정상 완주: 전 페이지 누적, quotaExceeded=false, abnormalStatus=null, sort=date/desc 고정', async () => {
    const spy = jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 2,
          page_no: 1,
          list: [disclosure('A', '20250610')],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 2,
          page_no: 2,
          list: [disclosure('B', '20250605')],
        }),
      );

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');

    expect(result.items.map((i) => i.rcept_no)).toEqual(['A', 'B']);
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBeNull();
    // 정렬 방향 고정 검증(쿼터 절단 시 '최신 구간 우선' 전제 보장)
    expect(spy.mock.calls[0][0]).toMatchObject({ sort: 'date', sort_mth: 'desc' });
  });

  it('쿼터 소진(020): 그때까지 누적분 반환 + quotaExceeded=true, 추가 페이지 미요청', async () => {
    const spy = jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(
        listResponse({
          status: '000',
          total_page: 5,
          page_no: 1,
          list: [disclosure('A', '20250610')],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({ status: '020', message: '사용한도를 초과하였습니다.', total_page: 5 }),
      );

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');

    expect(result.quotaExceeded).toBe(true);
    expect(result.abnormalStatus).toBeNull();
    expect(result.items.map((i) => i.rcept_no)).toEqual(['A']); // 1페이지만
    expect(spy).toHaveBeenCalledTimes(2); // 020 본 뒤 중단(3페이지 미요청)
  });

  it('조회회사수 초과(021)도 quotaExceeded=true', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '021', message: '조회 가능한 회사 개수 초과' }));

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');
    expect(result.quotaExceeded).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('데이터 없음(013): 정상 종료, quotaExceeded=false', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '013', message: '데이터 없음' }));

    const result = await service.getAllDisclosuresWithMeta('19990101', '19990130');
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBeNull();
    expect(result.items).toEqual([]);
  });

  it('쿼터 외 비정상(예: 800): abnormalStatus 로 노출(throw 없음)', async () => {
    jest
      .spyOn(service, 'getDisclosureList')
      .mockResolvedValueOnce(listResponse({ status: '800', message: '시스템 점검' }));

    const result = await service.getAllDisclosuresWithMeta('20250520', '20250618');
    expect(result.quotaExceeded).toBe(false);
    expect(result.abnormalStatus).toBe('800');
    expect(result.items).toEqual([]);
  });
});
