/**
 * signals.daily-editions.integration-spec.ts — 실 Postgres 통합테스트 (DAR-519)
 *
 * `SignalsService.findDailyEditions()` 의 단일 `$queryRaw` 가 **실제 DB 컬럼**과
 * 정합하는지 실 Postgres 왕복으로 검증한다.
 *
 * 왜 통합테스트인가: 단위 스펙(`signals.daily-edition.spec.ts`)은 `$queryRaw` 를 모킹해
 *   컬럼명을 전혀 검증하지 못한다. DAR-519 회귀(snake_case `ts.created_at`·`c.corp_code`·
 *   `d.is_backfill` … 로 조회 → Prisma 스키마 컬럼은 따옴표 camelCase 이므로 런타임
 *   `column does not exist`)를 잡을 수 있는 것은 실 DB 를 때리는 이 스펙뿐이다.
 *   회귀 시 `$queryRaw` 가 던져 아래 assert 에 도달조차 못 한다(= 가드).
 *
 * ★ 격리: withRollback 안에서 FK 부모(Company·Disclosure)+매수등급 TradingSignal 을 seed 하고
 *   SignalsService 를 tx 로 구성해 **같은 트랜잭션**에서 조회한 뒤 롤백. 커밋 0·잔여 row 0
 *   (afterAll 에서 trading_signals baseline 불변 확인). 실행: npm run test:integration.
 */

import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import { SignalGrade } from '@prisma/client';

const prisma = new PrismaService();
const TAG = 'DAR519';

// 원거리 미래 시각으로 seed → 어떤 데모/실 데이터보다도 최신이라 items[0](최신순 LIMIT)에 확정 랭크.
// 시한부 테스트 아님: '가장 최신 에디션' 이라는 성질만 필요하고 절대 윈도우 집계가 아니다.
// UTC 2099-06-15 03:00 == KST 2099-06-15 12:00 → kst_date 2099-06-15 → 'YYYYMMDD' = '20990615'.
const SEED_CREATED_AT = new Date('2099-06-15T03:00:00.000Z');
const SEED_KST_DATE = '20990615';

describe('SignalsService.findDailyEditions (실 Postgres 통합)', () => {
  let baselineCount: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCount = await prisma.tradingSignal.count();
  });

  afterAll(async () => {
    const finalCount = await prisma.tradingSignal.count();
    expect(finalCount).toBe(baselineCount); // 잔여 0 — 데모 DB 무변경
    await prisma.$disconnect();
  });

  it('$queryRaw 컬럼이 실 DB 스키마(따옴표 camelCase)와 정합 — seed 한 매수판단 에디션을 집계 반환', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const corpCode = `${TAG}_CORP`;
      const rcpNo = `${TAG}_RCP`;
      const corpName = 'DAR519테스트사';

      await tx.company.create({
        data: { corpCode, corpName, stockCode: '451900', market: 'KOSPI' },
      });
      await tx.disclosure.create({
        data: {
          rcpNo,
          corpCode,
          corpName,
          reportName: 'DAR519 유상증자 결정',
          rcpDt: '20990615',
          flrName: corpName,
          rmk: '',
          disclosureType: '주요사항보고',
          isBackfill: false, // 백필 제외 필터(d."isBackfill" = false) 통과 대상
        },
      });
      await tx.tradingSignal.create({
        data: {
          rcpNo,
          corpCode,
          stockCode: '451900',
          eventType: 'PAID_IN_CAPITAL_INCREASE',
          persona: 'GROWTH',
          buyScore: 88,
          signal: SignalGrade.STRONG_BUY_CANDIDATE,
          scoreBreakdown: {},
          riskPenalty: 0,
          createdAt: SEED_CREATED_AT,
        },
      });

      // ★ tx 로 서비스를 구성해 seed 와 동일 트랜잭션에서 조회 → 롤백 격리 유지.
      const service = new SignalsService(tx as unknown as PrismaService);
      return service.findDailyEditions();
    });

    // 여기 도달했다는 것 자체가 $queryRaw 가 실 DB 컬럼과 정합함을 증명(회귀 시 throw).
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.meta).toBeDefined();

    // 미래 seed 이므로 최신순 목록의 선두. 조인·그룹·bigint→number 파싱까지 end-to-end 검증.
    const top = result.items[0];
    expect(top.date).toBe(SEED_KST_DATE);
    expect(top.count).toBe(1);
    expect(typeof top.count).toBe('number'); // bigint COUNT → number 파싱 확인
    expect(top.strongBuyCount).toBe(1);
    expect(top.headlineCorpName).toBe('DAR519테스트사'); // c."corpName" JOIN 결과
    expect(top.topGrade).toBe('STRONG_BUY'); // signal → 모바일 등급 매핑
  });
});
