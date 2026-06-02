import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';

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

  async search(query: string, limit?: number) {
    const take = Math.min(Number(limit) || 10, 20);
    const companies = await this.prisma.company.findMany({
      where: {
        corpName: {
          contains: query,
          mode: 'insensitive',
        },
      },
      take,
      select: {
        corpCode: true,
        corpName: true,
        stockCode: true,
        market: true,
      },
    });

    return companies;
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

  private async getOverview(corpCode: string) {
    // 캐시 확인
    const cached = await this.prisma.companyOverview.findUnique({
      where: { corpCode },
    });

    if (cached && Date.now() - cached.fetchedAt.getTime() < OVERVIEW_CACHE_TTL) {
      const { fetchedAt, ...data } = cached;
      return data;
    }

    // DART API 호출
    const dartData = await this.dartApiService.getCompanyOverview(corpCode);

    if (!dartData) {
      // API 실패 시 stale 캐시 반환
      if (cached) {
        const { fetchedAt, ...data } = cached;
        return data;
      }
      return null;
    }

    // DB 캐시 upsert
    const overview = await this.prisma.companyOverview.upsert({
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

    const { fetchedAt, ...data } = overview;
    return data;
  }
}
