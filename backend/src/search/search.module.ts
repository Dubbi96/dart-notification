import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { CompaniesModule } from '../companies/companies.module';
import { DisclosuresModule } from '../engine1-disclosure/disclosures/disclosures.module';

/**
 * 통합 검색(횡단) — 기업·공시 도메인 서비스를 모듈 주입으로 재사용한다.
 * 엔진 간 직접 결합을 피하기 위해 Engine1 disclosure는 DisclosuresModule export 경유로만 접근.
 */
@Module({
  imports: [CompaniesModule, DisclosuresModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
