import { CompaniesService } from './companies.service';

describe('CompaniesService.search', () => {
  let service: CompaniesService;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(0);
    const prisma = {
      company: { findMany, count },
      watchList: { groupBy: jest.fn() },
    } as any;
    const dartApiService = {} as any;
    service = new CompaniesService(prisma, dartApiService);
  });

  it('빈/공백 검색어는 DB 조회 없이 빈 배열을 반환한다', async () => {
    await expect(service.search('   ')).resolves.toEqual([]);
    await expect(service.search('')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('종목명과 종목코드를 OR 부분일치로 검색한다', async () => {
    await service.search('삼성');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { corpName: { contains: '삼성', mode: 'insensitive' } },
      { stockCode: { contains: '삼성' } },
    ]);
  });

  it('종목코드 6자리로 직접 검색할 수 있다', async () => {
    findMany.mockResolvedValue([
      { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
    ]);
    const result = await service.search('005930');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.OR).toContainEqual({ stockCode: { contains: '005930' } });
    expect(result[0].stockCode).toBe('005930');
  });

  it('검색어 앞뒤 공백을 제거한다', async () => {
    await service.search('  네이버  ');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.OR[0].corpName.contains).toBe('네이버');
  });

  it('limit 기본값 10, 최대 20으로 제한한다', async () => {
    await service.search('가', 999);
    expect(findMany.mock.calls[0][0].take).toBe(20);

    findMany.mockClear();
    await service.search('가');
    expect(findMany.mock.calls[0][0].take).toBe(10);
  });
});

describe('CompaniesService.searchWithCount', () => {
  let service: CompaniesService;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(0);
    const prisma = {
      company: { findMany, count },
      watchList: { groupBy: jest.fn() },
    } as any;
    const dartApiService = {} as any;
    service = new CompaniesService(prisma, dartApiService);
  });

  it('빈/공백 검색어는 DB 조회 없이 0건 묶음을 반환한다', async () => {
    await expect(service.searchWithCount('   ')).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('limit 된 items 와 함께 매칭 전체 건수(total)를 반환한다', async () => {
    findMany.mockResolvedValue([
      { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
    ]);
    count.mockResolvedValue(137);

    const result = await service.searchWithCount('삼성', 1);

    // items 는 limit 적용(1건)이지만 total 은 매칭 전체수(137).
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(137);
    // findMany 와 count 가 동일 where 절을 공유한다.
    expect(findMany.mock.calls[0][0].where).toEqual(count.mock.calls[0][0].where);
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { corpName: { contains: '삼성', mode: 'insensitive' } },
      { stockCode: { contains: '삼성' } },
    ]);
  });
});

// DAR-560: findByCorpCode 요청 경로에서 DART 동기 호출을 제거 — 캐시 미스/만료는 stale(또는 null)
// 즉답 + 백그라운드 fire-and-forget 갱신으로 전환했다. 응답 지연(서버 30s > 클라 10s 역전) 회귀 가드.
describe('CompaniesService.findByCorpCode / getOverview', () => {
  const CORP_CODE = '00126380';
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  let service: CompaniesService;
  let companyFindUnique: jest.Mock;
  let overviewFindUnique: jest.Mock;
  let overviewUpsert: jest.Mock;
  let disclosureFindMany: jest.Mock;
  let getCompanyOverview: jest.Mock;

  beforeEach(() => {
    companyFindUnique = jest.fn().mockResolvedValue({
      corpCode: CORP_CODE,
      corpName: '삼성전자',
      stockCode: '005930',
      market: 'KOSPI',
    });
    overviewFindUnique = jest.fn().mockResolvedValue(null);
    overviewUpsert = jest.fn().mockResolvedValue({});
    disclosureFindMany = jest.fn().mockResolvedValue([]);
    getCompanyOverview = jest.fn().mockResolvedValue(null);

    const prisma = {
      company: { findUnique: companyFindUnique },
      companyOverview: { findUnique: overviewFindUnique, upsert: overviewUpsert },
      disclosure: { findMany: disclosureFindMany },
    } as any;
    const dartApiService = { getCompanyOverview } as any;
    service = new CompaniesService(prisma, dartApiService);
  });

  it('캐시 미스 시 DART 응답을 기다리지 않고 overview:null 을 즉답한다', async () => {
    // DART 를 영원히 안 끝나는 프라미스로 만들어, 요청 경로가 이를 await 했다면 타임아웃(테스트 hang)된다.
    getCompanyOverview.mockReturnValue(new Promise(() => {}));

    const result = await service.findByCorpCode(CORP_CODE);

    expect(result.overview).toBeNull();
    expect(getCompanyOverview).toHaveBeenCalledWith(CORP_CODE);
  });

  it('캐시가 신선하면(TTL 이내) DART 를 호출하지 않고 캐시값을 반환한다', async () => {
    overviewFindUnique.mockResolvedValue({
      corpCode: CORP_CODE,
      corpName: '삼성전자',
      corpNameEng: 'Samsung Electronics',
      stockName: null,
      ceoName: '한종희',
      corpCls: 'Y',
      address: null,
      homepageUrl: null,
      industryCode: null,
      estDate: null,
      accMonth: null,
      fetchedAt: new Date(), // 방금 갱신 — TTL(24h) 이내
    });

    const result = await service.findByCorpCode(CORP_CODE);

    expect(result.overview).toMatchObject({ corpName: '삼성전자', ceoName: '한종희' });
    expect(result.overview).not.toHaveProperty('fetchedAt');
    expect(getCompanyOverview).not.toHaveBeenCalled();
  });

  it('캐시가 만료됐으면 stale 캐시를 즉답하고 백그라운드에서 갱신한다', async () => {
    const staleFetchedAt = new Date(Date.now() - 1000 * 60 * 60 * 25); // 25시간 전 — TTL(24h) 초과
    overviewFindUnique.mockResolvedValue({
      corpCode: CORP_CODE,
      corpName: '삼성전자(구)',
      corpNameEng: null,
      stockName: null,
      ceoName: null,
      corpCls: null,
      address: null,
      homepageUrl: null,
      industryCode: null,
      estDate: null,
      accMonth: null,
      fetchedAt: staleFetchedAt,
    });
    getCompanyOverview.mockResolvedValue({
      corp_name: '삼성전자',
      ceo_nm: '한종희',
    });

    const result = await service.findByCorpCode(CORP_CODE);

    // 응답은 (갱신된 DART 데이터가 아니라) stale 캐시값 그대로 — 요청 경로가 DART 를 기다리지 않았다는 증거.
    expect(result.overview).toMatchObject({ corpName: '삼성전자(구)' });
    expect(getCompanyOverview).toHaveBeenCalledWith(CORP_CODE);

    await flushPromises();

    // 백그라운드 갱신은 별도로 완료되어 새 DART 데이터로 upsert 한다.
    expect(overviewUpsert).toHaveBeenCalledTimes(1);
    expect(overviewUpsert.mock.calls[0][0].update.corpName).toBe('삼성전자');
  });

  it('동일 corpCode 동시 요청은 DART 를 1회만 호출한다(in-flight 가드)', async () => {
    let resolveDart: (v: any) => void = () => {};
    getCompanyOverview.mockReturnValue(
      new Promise((resolve) => {
        resolveDart = resolve;
      }),
    );

    await Promise.all([service.findByCorpCode(CORP_CODE), service.findByCorpCode(CORP_CODE)]);

    expect(getCompanyOverview).toHaveBeenCalledTimes(1);

    resolveDart(null);
    await flushPromises();
  });

  it('백그라운드 DART 호출이 실패해도 findByCorpCode 응답에는 영향이 없다(예외 삼킴)', async () => {
    getCompanyOverview.mockRejectedValue(new Error('DART timeout'));

    const result = await service.findByCorpCode(CORP_CODE);

    expect(result.overview).toBeNull();
    await expect(flushPromises()).resolves.toBeUndefined(); // unhandled rejection 없이 조용히 로깅만
  });
});
