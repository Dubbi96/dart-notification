import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DartQuotaForensicsService } from './dart-quota-forensics.service';
import { DartQuotaForensicsReport } from './dart-quota-forensics.types';

/**
 * DART 야간 쿼터 소진 포렌식 엔드포인트 (DAR-536 · read-only 집계).
 *
 * GET /ops/dart-quota-forensics?date=YYYYMMDD — 해당 KST 일자의 DART 쿼터 소비를
 *   경로별(벌크 list forward/백필 확장·문서 fetch 라이브/백필·재무·지분·tables)로 정량 분해.
 *   야간 창(00:00~08:29 KST) 요약 + 24시간 컨텍스트 + 재기동 마커 + DAR-532
 *   '다중 재기동 예산 재개방' 가설 판정 필드를 동봉한다. 배포 후 PM 이 prod 에서 조회해 판정.
 *
 * ★ read-only — SELECT/COUNT 만. 신규 테이블·수집·외부호출·체결·AI 개입·마이그레이션 0.
 *   prod DB 에 읽기 전용으로 안전 실행 가능(edition-density 동일 정책).
 * ★인증 미적용 — 비밀값 미노출(수집 메타 카운트·잡 타임라인만). 운영/내부용
 *   (/ops/metrics·edition-density 동일 정책).
 */
@ApiTags('Ops')
@Controller('ops')
export class DartQuotaForensicsController {
  constructor(private readonly forensicsService: DartQuotaForensicsService) {}

  @Get('dart-quota-forensics')
  @ApiOperation({
    summary: 'DART 야간 쿼터 소진 포렌식 — 소비 경로 정량 분해 + 가설 판정(운영/내부용)',
    description:
      '해당 KST 일자(기본 오늘)의 DART API 소비를 경로별로 정량 분해한다: 벌크 list(forward/' +
      '백필 확장, disclosure_collection_logs) · 문서 fetch(라이브/백필, disclosure_documents.fetchedAt) · ' +
      '재무 재수화(company_financials) · 지분/내부자(insider_holding_changes) · tables lazy fetch(S3 — 구조적 0). ' +
      '야간 창(00:00~08:29 KST) 상위 경로 3건 + 24시간 분포 + 크론 타임라인 + 재기동 마커(RUNNING 고착) + ' +
      "DAR-532 '다중 재기동 예산 재개방' 가설 판정(SUPPORTED/REFUTED/INCONCLUSIVE)을 동봉한다. " +
      '모든 수치는 저장 흔적 기준 하한이며 산출 규칙(evidence)·한계(caveats)를 응답에 정직 고지. ' +
      '기존 테이블 집계만 수행하는 read-only.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: '감사 대상 KST 일자(YYYYMMDD, 기본 오늘). 사건 발생 일자를 지정해야 판정이 유의미.',
    example: '20260715',
  })
  async getDartQuotaForensics(
    @Query('date') date?: string,
  ): Promise<{ success: true; data: DartQuotaForensicsReport }> {
    const data = await this.forensicsService.getForensics(date);
    return { success: true, data };
  }
}
