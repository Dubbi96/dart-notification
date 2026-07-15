import { Injectable, Logger } from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service';
import { DisclosuresService } from '../engine1-disclosure/disclosures/disclosures.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnifiedSearchDto } from './dto/unified-search.dto';
import { classifySearchMiss, SEARCH_MISS_TAG } from './search-miss.classifier';

/** 통합 검색 최소 질의 길이 — 종목코드 부분일치 등 과도한 DB 스캔을 막는 가드. */
export const MIN_QUERY_LENGTH = 2;

export interface SearchCategory<T> {
  items: T[];
  total: number;
  limit: number;
}

export interface UnifiedSearchResult {
  query: string;
  companies: SearchCategory<unknown>;
  disclosures: SearchCategory<unknown>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly companiesService: CompaniesService,
    private readonly disclosuresService: DisclosuresService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 기업·공시 통합 검색. 각 도메인 서비스(companies/disclosures)를 재사용하며
   * 검색 로직을 중복 구현하지 않는다. 카테고리별 묶음으로 반환한다.
   *
   * 부분실패 격리: 한쪽 도메인 조회가 reject 돼도 전체 500 이 되지 않도록
   * Promise.allSettled 로 실행하고, 실패한 카테고리만 빈 묶음(items: [], total: 0)으로
   * 폴백한다("개별 폴백" 약속 이행).
   *
   * 갭분석 W8: 결과 0건이면 SearchMissLog 에 비동기(fire-and-forget) 적재해
   * '검색 실패 중 미국종목 비율'을 상시 계측한다. 검색 응답 지연 0 원칙.
   */
  async search(dto: UnifiedSearchDto, userId?: string): Promise<UnifiedSearchResult> {
    const term = (dto.q ?? '').trim();
    const companyLimit = dto.companyLimit ?? 10;
    const disclosureLimit = dto.disclosureLimit ?? 10;

    // q<2 가드: DB 조회 없이 빈 카테고리 묶음 반환.
    if (term.length < MIN_QUERY_LENGTH) {
      return this.buildResult(
        term,
        { items: [], total: 0, limit: companyLimit },
        { items: [], total: 0, limit: disclosureLimit },
      );
    }

    // 두 도메인 검색을 병렬 실행하되, 한쪽 reject 가 다른 쪽까지 막지 않도록 allSettled.
    const [companyOutcome, disclosureOutcome] = await Promise.allSettled([
      this.companiesService.searchWithCount(term, companyLimit),
      this.disclosuresService.search({
        q: term,
        limit: disclosureLimit,
        page: 1,
        sort: 'latest',
      }),
    ]);

    const companies = this.resolveCategory(
      companyOutcome,
      companyLimit,
      'companies',
      term,
      (value) => ({ items: value.items, total: value.total }),
    );

    const disclosures = this.resolveCategory(
      disclosureOutcome,
      disclosureLimit,
      'disclosures',
      term,
      (value) => ({ items: value.items, total: value.meta.total }),
    );

    // 갭분석 W8: 양 카테고리 모두 '정상 조회 후 0건'일 때만 제로결과로 계측한다.
    // 부분실패 폴백(총계 0으로 격리된 경우)은 진짜 수요 신호가 아니므로 오염 방지 차원에서 제외.
    if (
      companyOutcome.status === 'fulfilled' &&
      disclosureOutcome.status === 'fulfilled' &&
      companies.total === 0 &&
      disclosures.total === 0
    ) {
      this.logSearchMiss(term, userId);
    }

    return this.buildResult(term, companies, disclosures);
  }

  /**
   * 갭분석 W8: 제로결과 검색어 적재 — 비동기 fire-and-forget.
   * await 하지 않아 검색 응답 지연이 0이며, 적재 실패는 경고 로그로만 남긴다(검색 기능 무영향).
   */
  private logSearchMiss(term: string, userId?: string): void {
    const tag = classifySearchMiss(term);
    void this.prisma.searchMissLog
      .create({ data: { query: term, tag, userId: userId ?? null } })
      .catch((error: unknown) => {
        this.logger.warn(
          `제로결과 검색 로깅 실패 (q="${term}", tag=${tag}): ${
            error instanceof Error ? error.message : error
          }`,
        );
      });
  }

  /**
   * 갭분석 W8: '미국 주식 알림, 필요하신가요?' 원탭 수요 버튼 기록.
   * 기능 약속이 아니라 수요 계측 전용 — SearchMissLog 에 tag=US_DEMAND_TAP 으로 적재한다.
   */
  async recordUsDemandTap(q: string | undefined, userId?: string): Promise<void> {
    await this.prisma.searchMissLog.create({
      data: {
        query: (q ?? '').trim(),
        tag: SEARCH_MISS_TAG.US_DEMAND_TAP,
        userId: userId ?? null,
      },
    });
  }

  /**
   * allSettled 결과를 카테고리 묶음으로 변환. fulfilled 면 매핑하고,
   * rejected 면 빈 묶음(items: [], total: 0)으로 격리하며 경고 로그를 남긴다.
   */
  private resolveCategory<T>(
    outcome: PromiseSettledResult<T>,
    limit: number,
    label: string,
    term: string,
    map: (value: T) => { items: unknown[]; total: number },
  ): SearchCategory<unknown> {
    if (outcome.status === 'fulfilled') {
      const { items, total } = map(outcome.value);
      return { items, total, limit };
    }

    this.logger.warn(
      `통합 검색 '${label}' 카테고리 실패 — 빈 묶음으로 격리 (q="${term}"): ${
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
      }`,
    );
    return { items: [], total: 0, limit };
  }

  private buildResult(
    query: string,
    companies: SearchCategory<unknown>,
    disclosures: SearchCategory<unknown>,
  ): UnifiedSearchResult {
    return { query, companies, disclosures };
  }
}
