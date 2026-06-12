import { SearchService, MIN_QUERY_LENGTH } from './search.service';

describe('SearchService.search', () => {
  let service: SearchService;
  let companySearch: jest.Mock;
  let disclosureSearch: jest.Mock;

  beforeEach(() => {
    companySearch = jest.fn().mockResolvedValue([]);
    disclosureSearch = jest
      .fn()
      .mockResolvedValue({ items: [], meta: { total: 0 } });
    const companiesService = { search: companySearch } as any;
    const disclosuresService = { search: disclosureSearch } as any;
    service = new SearchService(companiesService, disclosuresService);
  });

  it(`q가 ${MIN_QUERY_LENGTH}글자 미만이면 DB 조회 없이 빈 카테고리 묶음을 반환한다`, async () => {
    const result = await service.search({ q: '삼' });
    expect(companySearch).not.toHaveBeenCalled();
    expect(disclosureSearch).not.toHaveBeenCalled();
    expect(result.companies.items).toEqual([]);
    expect(result.disclosures.items).toEqual([]);
    expect(result.companies.total).toBe(0);
    expect(result.disclosures.total).toBe(0);
  });

  it('공백만 있는 검색어도 가드로 빈 묶음을 반환한다', async () => {
    const result = await service.search({ q: '   ' });
    expect(companySearch).not.toHaveBeenCalled();
    expect(disclosureSearch).not.toHaveBeenCalled();
    expect(result.query).toBe('');
  });

  it('q≥2이면 기업·공시 검색을 병렬로 호출하고 카테고리별로 묶는다', async () => {
    companySearch.mockResolvedValue([
      { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
    ]);
    disclosureSearch.mockResolvedValue({
      items: [{ rcpNo: '20240101', corpName: '삼성전자', reportName: '주요사항보고서' }],
      meta: { total: 42 },
    });

    const result = await service.search({ q: '삼성' });

    expect(companySearch).toHaveBeenCalledWith('삼성', 10);
    expect(disclosureSearch).toHaveBeenCalledWith({
      q: '삼성',
      limit: 10,
      page: 1,
      sort: 'latest',
    });
    expect(result.companies.items).toHaveLength(1);
    expect(result.companies.total).toBe(1);
    expect(result.disclosures.items).toHaveLength(1);
    // 공시 total은 도메인 서비스 meta.total을 그대로 전달.
    expect(result.disclosures.total).toBe(42);
    expect(result.query).toBe('삼성');
  });

  it('카테고리 limit을 각 도메인 서비스에 전달한다', async () => {
    await service.search({ q: '카카오', companyLimit: 5, disclosureLimit: 15 });
    expect(companySearch).toHaveBeenCalledWith('카카오', 5);
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
    expect(companySearch).toHaveBeenCalledWith('네이버', 10);
  });
});
