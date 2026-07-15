/**
 * investor-flow.query.spec.ts — 수급·공매도 조회 서비스 (갭분석 W16).
 *
 * 검증(실 DB 없음): 외국인·기관 5/20일 누적 집계(부분 축적 정직 고지 포함), days 정규화 상한,
 * BigInt→number 변환, 공매도 거래비중(일봉 volume 조인) 산출·결측 null, 형식 위반 graceful.
 */

import {
  InvestorFlowQueryService,
  InvestorFlowRowDto,
} from './investor-flow.query.service';
import { PrismaService } from '../../prisma/prisma.service';

const flowRow = (tradeDate: string, foreignAmt: number, instAmt: number) => ({
  stockCode: '005930',
  tradeDate,
  foreignNetBuyQty: BigInt(100),
  foreignNetBuyAmount: BigInt(foreignAmt),
  institutionNetBuyQty: BigInt(-50),
  institutionNetBuyAmount: BigInt(instAmt),
  individualNetBuyQty: BigInt(-50),
  individualNetBuyAmount: BigInt(-(foreignAmt + instAmt)),
  source: 'KIS',
  createdAt: new Date(),
});

function makePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    investorFlowDaily: { findMany: jest.fn().mockResolvedValue([]) },
    shortSellingDaily: { findMany: jest.fn().mockResolvedValue([]) },
    stockDailyPrice: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as unknown as PrismaService;
}

describe('InvestorFlowQueryService (W16)', () => {
  describe('summarize — 5/20일 누적 집계(순수 함수)', () => {
    // 최신순(내림차순) 25행 — i번째(0=최신) 외국인 +1억, 기관 -0.5억.
    const rowsDesc: InvestorFlowRowDto[] = Array.from({ length: 25 }, (_, i) => ({
      tradeDate: String(20260600 + (25 - i)), // 내림차순 흉내(값 자체는 미사용)
      foreignNetBuyQty: 0,
      foreignNetBuyAmount: 100_000_000,
      institutionNetBuyQty: 0,
      institutionNetBuyAmount: -50_000_000,
      individualNetBuyQty: 0,
      individualNetBuyAmount: -50_000_000,
      source: 'KIS',
    }));

    it('최근 5일/20일 창을 정확히 잘라 합산한다', () => {
      const s = InvestorFlowQueryService.summarize(rowsDesc);
      expect(s.foreignNet5dAmount).toBe(500_000_000);
      expect(s.foreignNet20dAmount).toBe(2_000_000_000);
      expect(s.institutionNet5dAmount).toBe(-250_000_000);
      expect(s.institutionNet20dAmount).toBe(-1_000_000_000);
      expect(s.window5dDays).toBe(5);
      expect(s.window20dDays).toBe(20);
    });

    it('축적이 창보다 짧으면 있는 만큼만 합산하고 실제 일수를 정직 고지한다', () => {
      const s = InvestorFlowQueryService.summarize(rowsDesc.slice(0, 3));
      expect(s.foreignNet5dAmount).toBe(300_000_000);
      expect(s.foreignNet20dAmount).toBe(300_000_000);
      expect(s.window5dDays).toBe(3);
      expect(s.window20dDays).toBe(3);
    });

    it('음수(순매도) 우세 구간은 음수 누적을 그대로 보존한다', () => {
      const s = InvestorFlowQueryService.summarize(rowsDesc);
      expect(s.institutionNet20dAmount).toBeLessThan(0);
    });
  });

  describe('normalizeDays — 파라미터 정규화', () => {
    it('기본 20 · 상한 120 · 비정상 입력은 기본값', () => {
      expect(InvestorFlowQueryService.normalizeDays(undefined)).toBe(20);
      expect(InvestorFlowQueryService.normalizeDays('5')).toBe(5);
      expect(InvestorFlowQueryService.normalizeDays('999')).toBe(120);
      expect(InvestorFlowQueryService.normalizeDays('-3')).toBe(20);
      expect(InvestorFlowQueryService.normalizeDays('abc')).toBe(20);
    });
  });

  describe('getInvestorFlow', () => {
    it('BigInt→number 변환 + 오름차순 반환 + asOfDate=최신 거래일', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          flowRow('20260714', 200_000_000, -80_000_000),
          flowRow('20260713', 100_000_000, -50_000_000),
        ]);
      const svc = new InvestorFlowQueryService(
        makePrisma({ investorFlowDaily: { findMany } }),
      );

      const r = await svc.getInvestorFlow('005930', 20);

      expect(r.asOfDate).toBe('20260714');
      expect(r.rows.map((x) => x.tradeDate)).toEqual(['20260713', '20260714']); // 오름차순
      expect(typeof r.rows[0].foreignNetBuyAmount).toBe('number');
      expect(r.summary?.foreignNet5dAmount).toBe(300_000_000);
      expect(r.summary?.window5dDays).toBe(2);
    });

    it('형식 위반 코드·데이터 없음 — asOfDate=null 빈 결과 graceful', async () => {
      const svc = new InvestorFlowQueryService(makePrisma());
      expect((await svc.getInvestorFlow('ABC', 20)).asOfDate).toBeNull();
      expect((await svc.getInvestorFlow('005930', 20)).rows).toEqual([]);
    });
  });

  describe('getShortSelling — 거래비중(일봉 volume 조인)', () => {
    const shortRow = (tradeDate: string, vol: number) => ({
      stockCode: '005930',
      tradeDate,
      shortSellingVolume: BigInt(vol),
      shortSellingAmount: BigInt(vol * 280_000),
      shortBalanceQty: null,
      shortBalanceRatio: null,
      publishedDate: '20260716',
      source: 'KIS',
      createdAt: new Date(),
    });

    it('volume 존재 시 비중(%) 소수 2자리 산출, 결측 시 null(합성 금지)', async () => {
      const svc = new InvestorFlowQueryService(
        makePrisma({
          shortSellingDaily: {
            findMany: jest
              .fn()
              .mockResolvedValue([shortRow('20260714', 907_025), shortRow('20260713', 500_000)]),
          },
          stockDailyPrice: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ tradeDate: '20260714', volume: BigInt(24_873_414) }]),
          },
        }),
      );

      const r = await svc.getShortSelling('005930', 20);

      expect(r.asOfDate).toBe('20260714');
      const byDate = new Map(r.rows.map((x) => [x.tradeDate, x]));
      expect(byDate.get('20260714')?.shortVolumeRatio).toBeCloseTo(3.65, 2); // 907,025/24,873,414
      expect(byDate.get('20260713')?.shortVolumeRatio).toBeNull(); // 일봉 결측 — null
      expect(byDate.get('20260714')?.shortBalanceRatio).toBeNull(); // 잔고 미가용 정직 null
    });
  });
});
