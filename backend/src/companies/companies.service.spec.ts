import { CompaniesService } from './companies.service';

describe('CompaniesService.search', () => {
  let service: CompaniesService;
  let findMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      company: { findMany },
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
