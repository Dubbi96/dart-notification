import { Injectable, Logger } from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service';
import { DisclosuresService } from '../engine1-disclosure/disclosures/disclosures.service';
import { UnifiedSearchDto } from './dto/unified-search.dto';

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
  ) {}

  /**
   * 기업·공시 통합 검색. 각 도메인 서비스(companies/disclosures)를 재사용하며
   * 검색 로직을 중복 구현하지 않는다. 카테고리별 묶음으로 반환한다.
   *
   * 부분실패 격리: 한쪽 도메인 조회가 reject 돼도 전체 500 이 되지 않도록
   * Promise.allSettled 로 실행하고, 실패한 카테고리만 빈 묶음(items: [], total: 0)으로
   * 폴백한다("개별 폴백" 약속 이행).
   */
  async search(dto: UnifiedSearchDto): Promise<UnifiedSearchResult> {
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

    return this.buildResult(term, companies, disclosures);
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
