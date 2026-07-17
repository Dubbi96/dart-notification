/**
 * signals.fallback-briefing.integration-spec.ts — 실 Postgres 통합테스트 (DAR-551)
 *
 * `SignalsService.buildFallbackBriefing()` 의 `$queryRaw`(빈 에디션 폴백 브리핑)가
 *   **실제 DB 컬럼**(따옴표 camelCase)·조인·JSON 추출(`resultJson->>'summary'`)과
 *   정합하는지 실 Postgres 왕복으로 검증한다.
 *
 * 왜 통합테스트인가: 단위 스펙(`signals.daily-edition.spec.ts`)은 `$queryRaw` 를 모킹해
 *   컬럼명·조인·JSON 연산자를 전혀 검증하지 못한다. snake_case 오타·엉뚱한 테이블명이면
 *   런타임에 `column/relation does not exist` 로 throw — 이 스펙만이 그 회귀를 잡는다.
 *   (회귀 시 `$queryRaw` 가 던져 아래 assert 에 도달조차 못 한다 = 가드)
 *
 * ★ 격리: withRollback 안에서 FK 부모(Company)+Disclosure(+DisclosureEvent·DisclosureAnalysis)
 *   를 seed 하고 SignalsService 를 tx 로 구성해 **같은 트랜잭션**에서 조회 후 롤백.
 *   커밋 0·잔여 row 0. 실행: npm run test:integration.
 *
 * ★ 날짜 선택: 20150102(금, 거래일). 데모/실 DB 어떤 매수판단보다도 과거이므로 그 거래일은
 *   반드시 빈 에디션(isEmpty=true, emptyReason=COLD_START|QUIET → 브리핑 대상)이 된다.
 *   → findDailyEdition 이 buildFallbackBriefing 을 실제로 호출한다.
 */

import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import { AiCostLevel, AiTaskName } from '@prisma/client';

const prisma = new PrismaService();
const TAG = 'DAR551';
// 아주 먼 과거 거래일(금요일) — 어떤 매수판단보다도 과거 → 그 거래일은 빈 에디션 확정.
const SEED_DATE = '20150102';

describe('SignalsService.buildFallbackBriefing (실 Postgres 통합)', () => {
  let baselineDisclosures: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineDisclosures = await prisma.disclosure.count();
  });

  afterAll(async () => {
    const finalCount = await prisma.disclosure.count();
    expect(finalCount).toBe(baselineDisclosures); // 잔여 0 — 데모 DB 무변경
    await prisma.$disconnect();
  });

  it('$queryRaw 컬럼·조인·JSON 추출이 실 DB 스키마와 정합 — 이벤트성 우선 랭킹 + AI/제목 폴백', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const corpCode = `${TAG}_CORP`;
      const corpName = 'DAR551테스트사';
      const rcpEvent = `${TAG}_RCP_EVENT`; // 이벤트+요약 보유 → #1
      const rcpPlain = `${TAG}_RCP_PLAIN`; // 이벤트/요약 없음 → 제목 폴백, 후순위

      await tx.company.create({
        data: { corpCode, corpName, stockCode: '099999', market: 'KOSPI' },
      });

      // 이벤트+AI 요약 보유 공시
      await tx.disclosure.create({
        data: {
          rcpNo: rcpEvent,
          corpCode,
          corpName,
          reportName: '단일판매ㆍ공급계약 체결',
          rcpDt: `${SEED_DATE}090000`,
          flrName: corpName,
          rmk: '',
          disclosureType: '주요사항보고',
          isBackfill: false,
        },
      });
      await tx.disclosureEvent.create({
        data: { rcpNo: rcpEvent, corpCode, eventType: 'SUPPLY_CONTRACT' },
      });
      await tx.disclosureAnalysis.create({
        data: {
          rcpNo: rcpEvent,
          task: AiTaskName.summary,
          level: AiCostLevel.L2,
          resultJson: {
            summary: '1,200억 규모 공급계약을 체결했다.',
            positiveFactors: [],
            negativeFactors: [],
            polarity: 'POSITIVE',
          },
        },
      });

      // 이벤트/요약 없는 공시 → 제목 폴백, 후순위
      await tx.disclosure.create({
        data: {
          rcpNo: rcpPlain,
          corpCode,
          corpName,
          reportName: '기타 경영사항(자율공시)',
          rcpDt: `${SEED_DATE}100000`,
          flrName: corpName,
          rmk: '',
          disclosureType: '기타',
          isBackfill: false,
        },
      });

      // ★ tx 로 서비스를 구성해 seed 와 동일 트랜잭션에서 조회 → 롤백 격리 유지.
      const service = new SignalsService(tx as unknown as PrismaService);
      return service.findDailyEdition(SEED_DATE);
    });

    // 여기 도달했다는 것 자체가 $queryRaw 가 실 DB 컬럼과 정합함을 증명(회귀 시 throw).
    // 빈 에디션(판단 0) + 브리핑 분리 노출 — 정직 불변식.
    expect(result.meta.isEmpty).toBe(true);
    expect(result.items).toHaveLength(0);

    const briefing = result.meta.fallbackBriefing;
    expect(briefing).toBeDefined();
    expect(briefing).toHaveLength(2);

    // ① 이벤트성 우선 — 이벤트+요약 공시가 선두, AI 요약 재사용.
    expect(briefing?.[0]).toEqual({
      rcpNo: `${TAG}_RCP_EVENT`,
      corpName: 'DAR551테스트사',
      eventLabel: '공급계약',
      summaryLine: '1,200억 규모 공급계약을 체결했다.',
      summarySource: 'AI',
    });

    // ② 이벤트/요약 없는 공시 — 제목 폴백.
    expect(briefing?.[1]).toEqual({
      rcpNo: `${TAG}_RCP_PLAIN`,
      corpName: 'DAR551테스트사',
      eventLabel: '기타 공시',
      summaryLine: '기타 경영사항(자율공시)',
      summarySource: 'TITLE',
    });
  });
});
