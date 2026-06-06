// backend/src/engine1-disclosure/insider-holdings/insider-holding.mapper.spec.ts
// 정형 엔드포인트 파싱·모델 매핑·EventType polarity·결측 graceful 스펙 (DAR-87).

import { EventType } from '@prisma/client';
import {
  parseDartNumber,
  parseDartBigInt,
  parseDartDate,
  deriveTradeType,
  mapMajorStockItem,
  mapExecutiveStockItem,
  mapHoldingChangeToEvent,
} from './insider-holding.mapper';
import {
  DartMajorStockItem,
  DartExecutiveStockItem,
} from '../dart-api/dart-api.service';

describe('insider-holding.mapper', () => {
  describe('parseDartNumber', () => {
    it('콤마/퍼센트 제거 후 숫자 파싱', () => {
      expect(parseDartNumber('1,234')).toBe(1234);
      expect(parseDartNumber('12.34%')).toBe(12.34);
    });
    it('괄호·음수 부호 → 음수', () => {
      expect(parseDartNumber('(1,234)')).toBe(-1234);
      expect(parseDartNumber('-5.5')).toBe(-5.5);
    });
    it('결측·비수치 → null (graceful)', () => {
      expect(parseDartNumber('')).toBeNull();
      expect(parseDartNumber('-')).toBeNull();
      expect(parseDartNumber(undefined)).toBeNull();
      expect(parseDartNumber(null)).toBeNull();
      expect(parseDartNumber('해당없음')).toBeNull();
    });
  });

  describe('parseDartBigInt', () => {
    it('정수 수량 → BigInt', () => {
      expect(parseDartBigInt('1,000,000')).toBe(1000000n);
      expect(parseDartBigInt('(2,000)')).toBe(-2000n);
    });
    it('소수는 버림, 결측은 null', () => {
      expect(parseDartBigInt('123.9')).toBe(123n);
      expect(parseDartBigInt('-')).toBeNull();
    });
  });

  describe('parseDartDate', () => {
    it('YYYYMMDD / 구분자 포함 모두 파싱(UTC 자정)', () => {
      const d = parseDartDate('20260607');
      expect(d?.toISOString()).toBe('2026-06-07T00:00:00.000Z');
      expect(parseDartDate('2026.06.07')?.toISOString()).toBe('2026-06-07T00:00:00.000Z');
    });
    it('형식 불량·결측 → null', () => {
      expect(parseDartDate('2026')).toBeNull();
      expect(parseDartDate('20261307')).toBeNull(); // 13월
      expect(parseDartDate(undefined)).toBeNull();
    });
  });

  describe('deriveTradeType', () => {
    it('수량 증감 부호 우선', () => {
      expect(deriveTradeType(100n, null)).toBe('BUY');
      expect(deriveTradeType(-100n, null)).toBe('SELL');
    });
    it('수량 결측 시 비율 증감 폴백', () => {
      expect(deriveTradeType(null, 0.5)).toBe('BUY');
      expect(deriveTradeType(null, -0.5)).toBe('SELL');
    });
    it('증감 0 명시 → MIXED, 전부 결측 → UNKNOWN', () => {
      expect(deriveTradeType(0n, null)).toBe('MIXED');
      expect(deriveTradeType(null, null)).toBe('UNKNOWN');
    });
  });

  describe('mapMajorStockItem (majorstock.json — 5%룰)', () => {
    const base: DartMajorStockItem = {
      rcept_no: '20260607000001',
      rcept_dt: '20260607',
      corp_code: '00126380',
      corp_name: '삼성전자',
      report_tp: '변동',
      repror: '국민연금공단',
      stkqy: '60,000,000',
      stkqy_irds: '1,500,000',
      stkrt: '9.85',
      stkrt_irds: '0.25',
      report_resn: '단순 취득',
    };

    it('정형 행 → 정규화 입력(수량/비율 증감·취득방향)', () => {
      const r = mapMajorStockItem(base)!;
      expect(r.source).toBe('MAJOR_STOCK');
      expect(r.rcptNo).toBe('20260607000001');
      expect(r.corpCode).toBe('00126380');
      expect(r.reporter).toBe('국민연금공단');
      expect(r.sharesAfter).toBe(60000000n);
      expect(r.sharesChange).toBe(1500000n);
      expect(r.ratioAfter).toBeCloseTo(9.85);
      expect(r.ratioChange).toBeCloseTo(0.25);
      expect(r.tradeType).toBe('BUY');
      expect(r.reportReason).toBe('단순 취득');
      expect(r.reportedAt?.toISOString()).toBe('2026-06-07T00:00:00.000Z');
      expect(r.isExecutive).toBeNull();
    });

    it('지분 처분(증감 음수) → SELL', () => {
      const r = mapMajorStockItem({ ...base, stkqy_irds: '(500,000)', stkrt_irds: '-0.1' })!;
      expect(r.tradeType).toBe('SELL');
      expect(r.sharesChange).toBe(-500000n);
    });

    it('자연키(rcept_no/corp_code) 결측 → null (graceful skip)', () => {
      expect(mapMajorStockItem({ ...base, rcept_no: '' })).toBeNull();
      expect(mapMajorStockItem({ ...base, corp_code: '   ' })).toBeNull();
    });

    it('수치 전부 결측이어도 행은 생성, 수치는 null·tradeType UNKNOWN', () => {
      const r = mapMajorStockItem({
        rcept_no: 'R1',
        corp_code: 'C1',
        repror: '',
      })!;
      expect(r.sharesAfter).toBeNull();
      expect(r.ratioChange).toBeNull();
      expect(r.tradeType).toBe('UNKNOWN');
      expect(r.reporter).toBe('(미상)');
    });
  });

  describe('mapExecutiveStockItem (elestock.json — 내부자)', () => {
    const base: DartExecutiveStockItem = {
      rcept_no: '20260607000002',
      rcept_dt: '20260607',
      corp_code: '00164779',
      corp_name: 'SK하이닉스',
      repror: '홍길동',
      isu_exctv_rgist_at: '등기임원',
      isu_exctv_ofcps: '대표이사',
      isu_main_shrholdr: '10%이상주주',
      sp_stock_lmp_cnt: '500,000',
      sp_stock_lmp_irds_cnt: '10,000',
      sp_stock_lmp_rate: '1.20',
      sp_stock_lmp_irds_rate: '0.02',
    };

    it('정형 행 → 정규화 입력(임원 플래그·소유 증감)', () => {
      const r = mapExecutiveStockItem(base)!;
      expect(r.source).toBe('EXECUTIVE');
      expect(r.reporter).toBe('홍길동');
      expect(r.relation).toBe('대표이사');
      expect(r.isExecutive).toBe(true);
      expect(r.isRegistered).toBe(true);
      expect(r.isMajorShareholder).toBe(true);
      expect(r.sharesAfter).toBe(500000n);
      expect(r.sharesChange).toBe(10000n);
      expect(r.tradeType).toBe('BUY');
    });

    it('비등기·주요주주 아님 플래그 반영', () => {
      const r = mapExecutiveStockItem({
        ...base,
        isu_exctv_rgist_at: '비등기임원',
        isu_main_shrholdr: '해당없음',
        sp_stock_lmp_irds_cnt: '(3,000)',
      })!;
      expect(r.isRegistered).toBe(false);
      expect(r.isMajorShareholder).toBe(false);
      expect(r.tradeType).toBe('SELL');
      expect(r.sharesChange).toBe(-3000n);
    });

    it('자연키 결측 → null', () => {
      expect(mapExecutiveStockItem({ ...base, rcept_no: '' })).toBeNull();
    });
  });

  describe('mapHoldingChangeToEvent (EventType polarity 매핑)', () => {
    it('내부자 순매수 → INSIDER_BUY/POSITIVE', () => {
      expect(mapHoldingChangeToEvent({ source: 'EXECUTIVE', tradeType: 'BUY' })).toEqual({
        eventType: EventType.INSIDER_BUY,
        polarity: 'POSITIVE',
      });
    });
    it('내부자 순매도 → INSIDER_SELL/NEGATIVE', () => {
      expect(mapHoldingChangeToEvent({ source: 'EXECUTIVE', tradeType: 'SELL' })).toEqual({
        eventType: EventType.INSIDER_SELL,
        polarity: 'NEGATIVE',
      });
    });
    it('내부자 변동없음 → INSIDER_BUY/UNKNOWN(방향 불명)', () => {
      expect(mapHoldingChangeToEvent({ source: 'EXECUTIVE', tradeType: 'MIXED' }).polarity).toBe(
        'UNKNOWN',
      );
    });
    it('5% 대량보유 증가/감소/변동없음 → MAJOR_HOLDER_5PCT polarity 분기', () => {
      expect(mapHoldingChangeToEvent({ source: 'MAJOR_STOCK', tradeType: 'BUY' })).toEqual({
        eventType: EventType.MAJOR_HOLDER_5PCT,
        polarity: 'POSITIVE',
      });
      expect(mapHoldingChangeToEvent({ source: 'MAJOR_STOCK', tradeType: 'SELL' })).toEqual({
        eventType: EventType.MAJOR_HOLDER_5PCT,
        polarity: 'NEGATIVE',
      });
      expect(mapHoldingChangeToEvent({ source: 'MAJOR_STOCK', tradeType: 'UNKNOWN' }).polarity).toBe(
        'UNKNOWN',
      );
    });
  });
});
