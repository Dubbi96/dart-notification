import { SearchService, MIN_QUERY_LENGTH } from './search.service';

describe('SearchService.search', () => {
  let service: SearchService;
  let companySearchWithCount: jest.Mock;
  let disclosureSearch: jest.Mock;

  beforeEach(() => {
    companySearchWithCount = jest
      .fn()
      .mockResolvedValue({ items: [], total: 0 });
    disclosureSearch = jest
      .fn()
      .mockResolvedValue({ items: [], meta: { total: 0 } });
    const companiesService = { searchWithCount: companySearchWithCount } as any;
    const disclosuresService = { search: disclosureSearch } as any;
    service = new SearchService(companiesService, disclosuresService);
  });

  it(`q가 ${MIN_QUERY_LENGTH}글자 미만이면 DB 조회 없이 빈 카테고리 묶음을 반환한다`, async () => {
    const result = await service.search({ q: '삼' });
    expect(companySearchWithCount).not.toHaveBeenCalled();
    expect(disclosureSearch).not.toHaveBeenCalled();
    expect(result.companies.items).toEqual([]);
    expect(result.disclosures.items).toEqual([]);
    expect(result.companies.total).toBe(0);
    expect(result.disclosures.total).toBe(0);
  });

  it('공백만 있는 검색어도 가드로 빈 묶음을 반환한다', async () => {
    const result = await service.search({ q: '   ' });
    expect(companySearchWithCount).not.toHaveBeenCalled();
    expect(disclosureSearch).not.toHaveBeenCalled();
    expect(result.query).toBe('');
  });

  it('q≥2이면 기업·공시 검색을 병렬로 호출하고 카테고리별로 묶는다', async () => {
    companySearchWithCount.mockResolvedValue({
      items: [
        { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
      ],
      total: 137,
    });
    disclosureSearch.mockResolvedValue({
      items: [{ rcpNo: '20240101', corpName: '삼성전자', reportName: '주요사항보고서' }],
      meta: { total: 42 },
    });

    const result = await service.search({ q: '삼성' });

    expect(companySearchWithCount).toHaveBeenCalledWith('삼성', 10);
    expect(disclosureSearch).toHaveBeenCalledWith({
      q: '삼성',
      limit: 10,
      page: 1,
      sort: 'latest',
    });
    expect(result.companies.items).toHaveLength(1);
    // companies.total 은 limit 된 length 가 아니라 도메인 서비스가 보고한 실제 전체수.
    expect(result.companies.total).toBe(137);
    expect(result.disclosures.items).toHaveLength(1);
    // 공시 total 은 도메인 서비스 meta.total 을 그대로 전달.
    expect(result.disclosures.total).toBe(42);
    expect(result.query).toBe('삼성');
  });

  it('카테고리 limit을 각 도메인 서비스에 전달한다', async () => {
    await service.search({ q: '카카오', companyLimit: 5, disclosureLimit: 15 });
    expect(companySearchWithCount).toHaveBeenCalledWith('카카오', 5);
    expect(disclosureSearch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 15 }),
    );
    // 응답 묶음에도 적용된 limit이 노출된다.
    const result = await service.search({ q: '카카오', companyLimit: 5, disclosureLimit: 15 });
    expect(result.companies.limit).toBe(5);
    expect(result.disclosures.limit).toBe(15);
  });

  it('검색어 앞뒤 공백을 제거해 도메인 서비스에 전달한다', async () => {
    await service.search({ q: '  네이버  ' });
    expect(companySearchWithCount).toHaveBeenCalledWith('네이버', 10);
  });

  // --- 부분실패 격리 (DAR-169) ---

  it('기업 검색이 reject 돼도 전체 500 이 아니라 공시 결과를 정상 반환한다', async () => {
    companySearchWithCount.mockRejectedValue(new Error('company DB down'));
    disclosureSearch.mockResolvedValue({
      items: [{ rcpNo: '20240101', corpName: '네이버', reportName: '분기보고서' }],
      meta: { total: 9 },
    });

    const result = await service.search({ q: '네이버' });

    // 실패한 기업 카테고리만 빈 묶음으로 격리.
    expect(result.companies.items).toEqual([]);
    expect(result.companies.total).toBe(0);
    expect(result.companies.limit).toBe(10);
    // 공시는 정상.
    expect(result.disclosures.items).toHaveLength(1);
    expect(result.disclosures.total).toBe(9);
  });

  it('공시 검색이 reject 돼도 전체 500 이 아니라 기업 결과를 정상 반환한다', async () => {
    companySearchWithCount.mockResolvedValue({
      items: [
        { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
      ],
      total: 1,
    });
    disclosureSearch.mockRejectedValue(new Error('disclosure index timeout'));

    const result = await service.search({ q: '삼성' });

    // 기업은 정상.
    expect(result.companies.items).toHaveLength(1);
    expect(result.companies.total).toBe(1);
    // 실패한 공시 카테고리만 빈 묶음으로 격리.
    expect(result.disclosures.items).toEqual([]);
    expect(result.disclosures.total).toBe(0);
    expect(result.disclosures.limit).toBe(10);
  });

  it('양쪽 모두 reject 돼도 throw 하지 않고 빈 카테고리 묶음을 반환한다', async () => {
    companySearchWithCount.mockRejectedValue(new Error('company down'));
    disclosureSearch.mockRejectedValue(new Error('disclosure down'));

    const result = await service.search({ q: '한화' });

    expect(result.query).toBe('한화');
    expect(result.companies.items).toEqual([]);
    expect(result.companies.total).toBe(0);
    expect(result.disclosures.items).toEqual([]);
    expect(result.disclosures.total).toBe(0);
  });

  it('도메인 reject 가 non-Error(문자열) 여도 안전하게 격리한다', async () => {
    companySearchWithCount.mockRejectedValue('string failure');
    disclosureSearch.mockResolvedValue({ items: [], meta: { total: 0 } });

    await expect(service.search({ q: '엘지' })).resolves.toMatchObject({
      companies: { items: [], total: 0 },
    });
  });
});
