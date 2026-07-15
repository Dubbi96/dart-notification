import { DisclosuresService } from './disclosures.service';
import { PrismaService } from '../../prisma/prisma.service';

type FindManyArgs = { where?: any; take?: number; skip?: number; include?: any };

function makeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    rcpNo: '1',
    corpCode: 'c1',
    corpName: '삼성전자',
    reportName: '단일판매·공급계약 체결',
    rcpDt: '20240101',
    flrName: '삼성전자',
    rmk: '',
    disclosureType: 'MATERIAL',
    createdAt: new Date('2024-01-01'),
    ...over,
  };
}

describe('DisclosuresService.search (DAR-45)', () => {
  let service: DisclosuresService;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn();
    count = jest.fn();
    const prisma = { disclosure: { findMany, count } } as unknown as PrismaService;
    service = new DisclosuresService(prisma);
  });

  it('공백 검색어를 토큰으로 분해해 토큰 간 AND로 매칭한다 ("삼성 유상증자")', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.search({ q: '삼성 유상증자' });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.where.AND).toHaveLength(2);
    // 각 토큰은 4개 필드에 대한 OR
    expect(args.where.AND[0].OR).toHaveLength(4);
    const fields = args.where.AND[0].OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
    expect(fields).toEqual(['reportName', 'corpName', 'flrName', 'company']);
    // 토큰 값이 각 필드 contains에 적용된다
    expect(args.where.AND[0].OR[0].reportName.contains).toBe('삼성');
    expect(args.where.AND[1].OR[0].reportName.contains).toBe('유상증자');
  });

  it('종목코드 필드는 Company 관계를 통해 매칭한다', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.search({ q: '005930' });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.where.AND[0].OR[3].company.stockCode.contains).toBe('005930');
  });

  it('기간(from/to)·공시유형 필터를 where에 반영한다', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.search({ q: '삼성', from: '20240101', to: '20241231', disclosureType: 'MATERIAL' });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.where.disclosureType).toBe('MATERIAL');
    expect(args.where.rcpDt).toEqual({ gte: '20240101', lte: '20241231999999' });
  });

  it('기본 정렬은 latest — skip/take 페이지네이션을 사용한다', async () => {
    findMany.mockResolvedValue([makeRow()]);
    count.mockResolvedValue(1);

    const res = await service.search({ q: '삼성', page: 2, limit: 10 });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(res.meta.sort).toBe('latest');
  });

  it('sort=relevance면 관련도순으로 재정렬한다 (기업명 정확 일치 우선)', async () => {
    // DB는 최신순으로 돌려주지만(관련 없는 게 먼저), 점수순 재정렬 후 정확일치가 1위여야 한다.
    findMany.mockResolvedValue([
      makeRow({ rcpNo: 'A', corpName: '대신증권', reportName: '삼성 관련 단순언급', rcpDt: '20240301', company: { stockCode: '111111' } }),
      makeRow({ rcpNo: 'B', corpName: '삼성전자', reportName: '분기보고서', rcpDt: '20240101', company: { stockCode: '005930' } }),
    ]);
    count.mockResolvedValue(2);

    const res = await service.search({ q: '삼성전자', sort: 'relevance' });

    expect(res.meta.sort).toBe('relevance');
    expect((res.items[0] as { rcpNo: string }).rcpNo).toBe('B'); // 정확 일치가 1위
    // include로 끌어온 company는 응답에서 제거된다
    expect((res.items[0] as Record<string, unknown>).company).toBeUndefined();
    // relevance 모드는 include + take(스캔)로 조회
    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.include).toEqual({ company: { select: { stockCode: true } } });
  });

  it('빈 검색어는 토큰 없는 where로 처리한다 (AND 없음)', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.search({ q: '   ' });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.where.AND).toBeUndefined();
  });
});

describe('DisclosuresService.findAll (DAR-45 기간 필터)', () => {
  it('from/to를 rcpDt 범위로 반영한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { disclosure: { findMany, count }, watchList: { findMany: jest.fn() } } as unknown as PrismaService;
    const service = new DisclosuresService(prisma);

    await service.findAll({ from: '20240101', to: '20240131' });

    const args: FindManyArgs = findMany.mock.calls[0][0];
    expect(args.where.rcpDt).toEqual({ gte: '20240101', lte: '20240131999999' });
  });
});

describe('DisclosuresService 광역 count 캐시 (공시 피드 콜드 COUNT 타임아웃 해소)', () => {
  let findMany: jest.Mock;
  let count: jest.Mock;
  let service: DisclosuresService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(1000);
    const prisma = {
      disclosure: { findMany, count },
      watchList: { findMany: jest.fn() },
    } as unknown as PrismaService;
    service = new DisclosuresService(prisma);
  });

  it('무필터 목록은 두 번째 호출부터 캐시된 total을 쓴다 (COUNT 1회)', async () => {
    const r1 = await service.findAll({});
    const r2 = await service.findAll({});

    expect(count).toHaveBeenCalledTimes(1);
    expect(r1.meta.total).toBe(1000);
    expect(r2.meta.total).toBe(1000);
  });

  it('유형만 필터한 광역 목록도 캐시하되 유형별 키를 분리한다', async () => {
    await service.findAll({});
    await service.findAll({ disclosureType: 'MATERIAL' });
    await service.findAll({ disclosureType: 'MATERIAL' });

    // '*' 1회 + 'MATERIAL' 1회 — 서로 다른 키라 각 1회씩만 COUNT.
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('좁은 필터(corpCode·기간)는 캐시 없이 항상 정확 count를 실행한다', async () => {
    await service.findAll({ corpCode: 'c1' });
    await service.findAll({ corpCode: 'c1' });
    await service.findAll({ from: '20240101', to: '20240131' });

    expect(count).toHaveBeenCalledTimes(3);
  });

  it('TTL 만료 후엔 stale 값을 즉시 반환하고 백그라운드로 갱신한다', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      await service.findAll({}); // total=1000 캐시
      count.mockResolvedValue(2000);
      nowSpy.mockReturnValue(11 * 60 * 1000); // TTL(10분) 경과

      const stale = await service.findAll({});
      expect(stale.meta.total).toBe(1000); // 요청은 COUNT를 기다리지 않는다

      await new Promise((resolve) => setImmediate(resolve)); // 백그라운드 갱신 flush
      const fresh = await service.findAll({});
      expect(fresh.meta.total).toBe(2000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('빈 검색어 search(latest)도 findAll과 같은 광역 캐시를 공유한다', async () => {
    await service.findAll({});
    await service.search({ q: '   ' });

    expect(count).toHaveBeenCalledTimes(1);
  });

  it('토큰 있는 search는 캐시를 쓰지 않는다', async () => {
    await service.search({ q: '삼성' });
    await service.search({ q: '삼성' });

    expect(count).toHaveBeenCalledTimes(2);
  });
});

describe("DisclosuresService.getTodayCount '오늘의 공시' (DAR-420)", () => {
  function makeService(findFirst: jest.Mock, count: jest.Mock) {
    const prisma = { disclosure: { findFirst, count } } as unknown as PrismaService;
    return new DisclosuresService(prisma);
  }

  it('최신 가용일(max rcpDt) 날짜 prefix로 동일일 건수를 센다 — 전체 누적이 아님', async () => {
    const findFirst = jest.fn().mockResolvedValue({ rcpDt: '20260619151230' });
    const count = jest.fn().mockResolvedValue(151);
    const service = makeService(findFirst, count);

    const res = await service.getTodayCount();

    // 최신 행은 rcpDt desc 정렬 첫 행으로 resolve.
    expect(findFirst.mock.calls[0][0].orderBy).toEqual([{ rcpDt: 'desc' }]);
    // 카운트 where는 날짜 prefix(앞 8자리) startsWith — 시각 파트는 무시.
    expect(count.mock.calls[0][0].where).toEqual({ rcpDt: { startsWith: '20260619' } });
    expect(res).toEqual({ date: '20260619', count: 151 });
  });

  it('YYYYMMDD 형식(시각 없음)도 그대로 날짜 prefix로 처리한다', async () => {
    const findFirst = jest.fn().mockResolvedValue({ rcpDt: '20260619' });
    const count = jest.fn().mockResolvedValue(7);
    const service = makeService(findFirst, count);

    const res = await service.getTodayCount();

    expect(count.mock.calls[0][0].where).toEqual({ rcpDt: { startsWith: '20260619' } });
    expect(res).toEqual({ date: '20260619', count: 7 });
  });

  it('공시가 하나도 없으면 date=null·count=0 (count 미호출)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const count = jest.fn();
    const service = makeService(findFirst, count);

    const res = await service.getTodayCount();

    expect(res).toEqual({ date: null, count: 0 });
    expect(count).not.toHaveBeenCalled();
  });
});

describe('DisclosuresService.findOne 종목코드 평탄화 (DAR-188)', () => {
  function makeService(findUnique: jest.Mock) {
    const prisma = { disclosure: { findUnique } } as unknown as PrismaService;
    return new DisclosuresService(prisma);
  }

  it('Company.stockCode(6자리)를 평탄화해 반환하고 corpCode와 구분한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(
      makeRow({
        rcpNo: '20240101000001',
        corpCode: '00126380', // 삼성전자 8자리 고유번호
        company: { stockCode: '005930' }, // HTS용 6자리 종목코드
        disclosureEvent: null,
      }),
    );
    const service = makeService(findUnique);

    const res = (await service.findOne('20240101000001')) as Record<string, unknown>;

    // 종목코드는 corpCode(8자리)가 아니라 stockCode(6자리)여야 한다.
    expect(res.stockCode).toBe('005930');
    expect(res.corpCode).toBe('00126380');
    // include로 끌어온 company 객체는 응답에서 제거된다.
    expect(res.company).toBeUndefined();
    // 상세 조회는 company.stockCode를 include 한다.
    const args = findUnique.mock.calls[0][0];
    expect(args.include.company).toEqual({ select: { stockCode: true } });
  });

  it('stockCode 미보유(비상장) 공시는 stockCode=null로 정직하게 노출한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(
      makeRow({ corpCode: '00999999', company: { stockCode: null }, disclosureEvent: null }),
    );
    const service = makeService(findUnique);

    const res = (await service.findOne('1')) as Record<string, unknown>;

    expect(res.stockCode).toBeNull();
  });
});
