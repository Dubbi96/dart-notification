import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DartApiService } from '../engine1-disclosure/dart-api/dart-api.service';

const OVERVIEW_CACHE_TTL = 1000 * 60 * 60 * 24; // 24시간

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
  ) {}

  private readonly CURATED_COMPANIES = [
    '삼성전자', 'SK하이닉스', 'NAVER', '카카오', '현대자동차',
    'LG에너지솔루션', '삼성SDI', '셀트리온', '기아', 'LG화학',
    'POSCO홀딩스', '삼성바이오로직스', 'KB금융', '신한지주', '하나금융지주',
    '삼성물산', '현대모비스', 'LG전자', 'SK이노베이션', '카카오뱅크',
  ];

  private popularCache: { data: any[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1시간

  // DAR-560: 기업개황 백그라운드 갱신 in-flight 가드 — corpCode당 동시 DART 호출 1개로 제한(썬더링 허드 방지).
  private readonly refreshingOverviewCorpCodes = new Set<string>();

  async getPopularCompanies(limit = 20) {
    if (this.popularCache && Date.now() - this.popularCache.timestamp < this.CACHE_TTL) {
      return this.popularCache.data;
    }

    // watchlist 등록 수 기준 상위 기업
    const popular = await this.prisma.watchList.groupBy({
      by: ['corpCode', 'corpName'],
      _count: { corpCode: true },
      orderBy: { _count: { corpCode: 'desc' } },
      take: limit,
    });

    let result;

    if (popular.length >= limit) {
      result = popular.map((item) => ({
        corpCode: item.corpCode,
        corpName: item.corpName,
        stockCode: null,
        market: null,
      }));

      // 기업 상세 정보 보강
      const details = await this.prisma.company.findMany({
        where: { corpCode: { in: result.map((r) => r.corpCode) } },
        select: { corpCode: true, stockCode: true, market: true },
      });
      const detailMap = new Map(details.map((d) => [d.corpCode, d]));
      result = result.map((r) => ({
        ...r,
        stockCode: detailMap.get(r.corpCode)?.stockCode ?? null,
        market: detailMap.get(r.corpCode)?.market ?? null,
      }));
    } else {
      // Cold start: 대기업 목록에서 상장사만
      result = await this.prisma.company.findMany({
        where: {
          corpName: { in: this.CURATED_COMPANIES },
          stockCode: { not: null },
        },
        select: { corpCode: true, corpName: true, stockCode: true, market: true },
      });
    }

    this.popularCache = { data: result, timestamp: Date.now() };
    return result;
  }

  /** 종목명·종목코드 부분일치 검색의 공통 where 절. 종목코드 6자리 직접검색도 stockCode contains 로 처리. */
  private buildSearchWhere(term: string) {
    return {
      OR: [
        { corpName: { contains: term, mode: 'insensitive' as const } },
        { stockCode: { contains: term } },
      ],
    };
  }

  async search(query: string, limit?: number) {
    // 종목명·종목코드 부분일치 검색. 종목코드 6자리 직접검색도 stockCode contains 로 처리.
    const term = (query ?? '').trim();
    if (!term) {
      return [];
    }

    const take = Math.min(Number(limit) || 10, 20);
    const companies = await this.prisma.company.findMany({
      where: this.buildSearchWhere(term),
      take,
      orderBy: { corpName: 'asc' },
      select: {
        corpCode: true,
        corpName: true,
        stockCode: true,
        market: true,
      },
    });

    return companies;
  }

  /**
   * 통합 검색용: limit 적용 items 와 함께 매칭 전체 건수(total)를 반환한다.
   * disclosures.search 의 meta.total 과 정합을 맞추기 위함이며, 빈 검색어는 0건으로 폴백.
   */
  async searchWithCount(
    query: string,
    limit?: number,
  ): Promise<{ items: Awaited<ReturnType<CompaniesService['search']>>; total: number }> {
    const term = (query ?? '').trim();
    if (!term) {
      return { items: [], total: 0 };
    }

    const take = Math.min(Number(limit) || 10, 20);
    const where = this.buildSearchWhere(term);
    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        take,
        orderBy: { corpName: 'asc' },
        select: {
          corpCode: true,
          corpName: true,
          stockCode: true,
          market: true,
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total };
  }

  async findByCorpCode(corpCode: string) {
    const company = await this.prisma.company.findUnique({
      where: { corpCode },
      select: {
        corpCode: true,
        corpName: true,
        stockCode: true,
        market: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // 기업개황 캐시 조회
    const overview = await this.getOverview(corpCode);

    // 최근 공시 5건
    const recentDisclosures = await this.prisma.disclosure.findMany({
      where: { corpCode },
      orderBy: { rcpDt: 'desc' },
      take: 5,
      select: {
        rcpNo: true,
        corpName: true,
        corpCode: true,
        reportName: true,
        rcpDt: true,
        disclosureType: true,
      },
    });

    return { ...company, overview, recentDisclosures };
  }

  // DAR-560: 요청 경로에서 DART 동기 호출 금지(서버 30s > 클라 10s 역전 — 모바일 타임아웃 확정 발생).
  // 캐시가 있으면(만료 포함) stale 이라도 즉답, 없으면 overview:null 즉답 — 화면은 optional chaining이라 null 안전.
  // 만료/미스일 때만 백그라운드에서 fire-and-forget 갱신(응답을 기다리지 않음).
  private async getOverview(corpCode: string) {
    const cached = await this.prisma.companyOverview.findUnique({
      where: { corpCode },
    });

    const isStale = !cached || Date.now() - cached.fetchedAt.getTime() >= OVERVIEW_CACHE_TTL;
    if (isStale) {
      this.refreshOverviewInBackground(corpCode);
    }

    if (!cached) return null;
    const { fetchedAt, ...data } = cached;
    return data;
  }

  private refreshOverviewInBackground(corpCode: string): void {
    if (this.refreshingOverviewCorpCodes.has(corpCode)) return;
    this.refreshingOverviewCorpCodes.add(corpCode);

    this.dartApiService
      .getCompanyOverview(corpCode)
      .then(async (dartData) => {
        if (!dartData) return;
        await this.prisma.companyOverview.upsert({
          where: { corpCode },
          update: {
            corpName: dartData.corp_name,
            corpNameEng: dartData.corp_name_eng || null,
            stockName: dartData.stock_name || null,
            ceoName: dartData.ceo_nm || null,
            corpCls: dartData.corp_cls || null,
            address: dartData.adres || null,
            homepageUrl: dartData.hm_url || null,
            industryCode: dartData.induty_code || null,
            estDate: dartData.est_dt || null,
            accMonth: dartData.acc_mt || null,
            fetchedAt: new Date(),
          },
          create: {
            corpCode,
            corpName: dartData.corp_name,
            corpNameEng: dartData.corp_name_eng || null,
            stockName: dartData.stock_name || null,
            ceoName: dartData.ceo_nm || null,
            corpCls: dartData.corp_cls || null,
            address: dartData.adres || null,
            homepageUrl: dartData.hm_url || null,
            industryCode: dartData.induty_code || null,
            estDate: dartData.est_dt || null,
            accMonth: dartData.acc_mt || null,
          },
        });
      })
      .catch((err) => {
        this.logger.warn(
          `기업개황 백그라운드 갱신 실패: ${corpCode} — ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.refreshingOverviewCorpCodes.delete(corpCode);
      });
  }
}
