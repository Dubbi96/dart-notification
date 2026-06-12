import type { Company } from '@app-types/user.types';
import type { Disclosure } from '@app-types/disclosure.types';

/** 통합 검색 카테고리 묶음 (백엔드 SearchCategory 1:1). */
export interface SearchCategory<T> {
  items: T[];
  total: number;
  limit: number;
}

/** GET /search?q= 응답 (백엔드 UnifiedSearchResult 1:1). */
export interface UnifiedSearchResult {
  query: string;
  companies: SearchCategory<Company>;
  disclosures: SearchCategory<Disclosure>;
}
