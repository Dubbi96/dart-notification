import { Injectable } from '@nestjs/common';
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
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly disclosuresService: DisclosuresService,
  ) {}

  /**
   * 기업·공시 통합 검색. 각 도메인 서비스(companies/disclosures)를 재사용하며
   * 검색 로직을 중복 구현하지 않는다. 카테고리별 묶음으로 반환한다.
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

    // 두 도메인 검색을 병렬 실행. 한쪽 실패가 전체를 막지 않도록 개별 폴백.
    const [companies, disclosureResult] = await Promise.all([
      this.companiesService.search(term, companyLimit),
      this.disclosuresService.search({
        q: term,
        limit: disclosureLimit,
        page: 1,
        sort: 'latest',
      }),
    ]);

    return this.buildResult(
      term,
      { items: companies, total: companies.length, limit: companyLimit },
      {
        items: disclosureResult.items,
        total: disclosureResult.meta.total,
        limit: disclosureLimit,
      },
    );
  }

  private buildResult(
    query: string,
    companies: SearchCategory<unknown>,
    disclosures: SearchCategory<unknown>,
  ): UnifiedSearchResult {
    return { query, companies, disclosures };
  }
}
