/**
 * asset-class.spec.ts — 다자산 추상화 회귀 가드 (DAR-77)
 *
 * 증명 대상:
 *  1) AssetClass enum / 기본값 KR_STOCK / 헬퍼·구현여부
 *  2) 미구현 자산군 스텁 가드(AssetClassNotImplementedError)
 *  3) KR 거래캘린더 어댑터(IMarketCalendarPort) 동작 + 비-KR 스텁
 *  4) 가격 포트 시그니처 확장이 기존 KR 호출(자산군 미지정)을 무회귀로 보존
 *  5) assetClass 가산 인자 동작 + 비-KR 호출 스텁
 */
import {
  AssetClass,
  DEFAULT_ASSET_CLASS,
  AssetClassNotImplementedError,
  assertSupportedAssetClass,
  isAssetClassImplemented,
  krStock,
} from './asset-class';
import { KrMarketCalendarAdapter } from './kr-market-calendar.adapter';
import { InMemoryStockPriceAdapter } from '../../engine3-quant-market/event-study/adapters/in-memory-stock-price.adapter';
import { IStockDailyPrice } from '../../engine3-quant-market/event-study/ports/stock-price.port';
import { InMemoryPriceDataAdapter } from '../../engine3-quant-market/backtest/ports/in-memory-price-data.adapter';
import { DailyPrice } from '../../engine3-quant-market/backtest/ports/backtest.types';

describe('AssetClass 도메인 추상화 (DAR-77)', () => {
  describe('enum / 기본값 / 헬퍼', () => {
    it('3개 자산군을 노출한다', () => {
      expect(AssetClass.KR_STOCK).toBe('KR_STOCK');
      expect(AssetClass.US_STOCK).toBe('US_STOCK');
      expect(AssetClass.CRYPTO).toBe('CRYPTO');
      expect(Object.values(AssetClass)).toHaveLength(3);
    });

    it('기본 자산군은 KR_STOCK 으로 현행 호출을 보존한다', () => {
      expect(DEFAULT_ASSET_CLASS).toBe(AssetClass.KR_STOCK);
    });

    it('현재 KR_STOCK 만 구현됨, 나머지는 미구현', () => {
      expect(isAssetClassImplemented(AssetClass.KR_STOCK)).toBe(true);
      expect(isAssetClassImplemented(AssetClass.US_STOCK)).toBe(false);
      expect(isAssetClassImplemented(AssetClass.CRYPTO)).toBe(false);
    });

    it('krStock 헬퍼는 KRW 기준 AssetIdentifier 를 만든다', () => {
      expect(krStock('00126380', '005930')).toEqual({
        assetClass: AssetClass.KR_STOCK,
        primaryId: '00126380',
        displayTicker: '005930',
        currency: 'KRW',
      });
      // displayTicker 생략 시 primaryId 로 폴백
      expect(krStock('00126380').displayTicker).toBe('00126380');
    });
  });

  describe('미구현 자산군 스텁 가드', () => {
    it('KR 은 통과, US/CRYPTO 는 AssetClassNotImplementedError', () => {
      expect(() => assertSupportedAssetClass(AssetClass.KR_STOCK)).not.toThrow();
      expect(() => assertSupportedAssetClass(AssetClass.US_STOCK)).toThrow(
        AssetClassNotImplementedError,
      );
      expect(() => assertSupportedAssetClass(AssetClass.CRYPTO)).toThrow(
        AssetClassNotImplementedError,
      );
    });
  });

  describe('KrMarketCalendarAdapter (IMarketCalendarPort)', () => {
    const cal = new KrMarketCalendarAdapter([
      '2026-01-05',
      '2026-01-06',
      '2026-01-02',
      '2026-01-05', // 중복 — 정렬·중복제거 검증
    ]);

    it('KR 거래일 판정', () => {
      expect(cal.isTradingDay(AssetClass.KR_STOCK, '2026-01-05')).toBe(true);
      expect(cal.isTradingDay(AssetClass.KR_STOCK, '2026-01-03')).toBe(false);
    });

    it('KR 다음 거래일', () => {
      expect(cal.getNextTradingDay(AssetClass.KR_STOCK, '2026-01-02')).toBe(
        '2026-01-05',
      );
      expect(cal.getNextTradingDay(AssetClass.KR_STOCK, '2026-01-06')).toBeNull();
    });

    it('비-KR 자산군은 미구현 스텁으로 throw', () => {
      expect(() => cal.isTradingDay(AssetClass.US_STOCK, '2026-01-05')).toThrow(
        AssetClassNotImplementedError,
      );
      expect(() =>
        cal.getNextTradingDay(AssetClass.CRYPTO, '2026-01-05'),
      ).toThrow(AssetClassNotImplementedError);
    });
  });

  describe('가격 포트 시그니처 확장 무회귀 (event-study IStockPricePort)', () => {
    const data: IStockDailyPrice[] = [
      { stockCode: '005930', tradeDate: '20260102', closePrice: 100, volume: 10 },
      { stockCode: '005930', tradeDate: '20260105', closePrice: 110, volume: 20 },
    ];
    const adapter = new InMemoryStockPriceAdapter(data);

    it('현행 KR 호출(자산군 미지정)은 그대로 동작', async () => {
      const res = await adapter.getPriceWindow('005930', '20260101', '20260106');
      expect(res).toHaveLength(2);
      expect(res[0].tradeDate).toBe('20260102');
    });

    it('assetClass=KR_STOCK 명시도 동일 결과', async () => {
      const res = await adapter.getPriceWindow(
        '005930',
        '20260101',
        '20260106',
        AssetClass.KR_STOCK,
      );
      expect(res).toHaveLength(2);
    });

    it('비-KR 자산군은 미구현 스텁으로 reject', async () => {
      await expect(
        adapter.getPriceWindow('AAPL', '20260101', '20260106', AssetClass.US_STOCK),
      ).rejects.toBeInstanceOf(AssetClassNotImplementedError);
    });
  });

  describe('가격 포트 시그니처 확장 무회귀 (backtest PriceDataPort)', () => {
    const prices: Record<string, DailyPrice[]> = {
      '005930': [
        { date: '2026-01-02', open: 100, high: 105, low: 99, close: 102, volume: 10 },
        { date: '2026-01-05', open: 103, high: 108, low: 102, close: 107, volume: 20 },
      ],
    };
    const adapter = new InMemoryPriceDataAdapter(prices, [
      '2026-01-02',
      '2026-01-05',
    ]);

    it('현행 KR 호출(자산군 미지정) 무회귀', async () => {
      expect(await adapter.getDailyPrices('005930', '2026-01-01', '2026-01-06')).toHaveLength(2);
      expect(await adapter.getOpenPrice('005930', '2026-01-02')).toBe(100);
      expect(await adapter.getTradingDays('2026-01-01', '2026-01-06')).toEqual([
        '2026-01-02',
        '2026-01-05',
      ]);
    });

    it('assetClass=KR_STOCK 명시도 동일 결과', async () => {
      expect(
        await adapter.getDailyPrices('005930', '2026-01-01', '2026-01-06', AssetClass.KR_STOCK),
      ).toHaveLength(2);
      expect(
        await adapter.getOpenPrice('005930', '2026-01-02', AssetClass.KR_STOCK),
      ).toBe(100);
      expect(
        await adapter.getTradingDays('2026-01-01', '2026-01-06', AssetClass.KR_STOCK),
      ).toHaveLength(2);
    });

    it('비-KR 자산군은 모든 메서드에서 미구현 스텁으로 reject', async () => {
      await expect(
        adapter.getDailyPrices('AAPL', '2026-01-01', '2026-01-06', AssetClass.US_STOCK),
      ).rejects.toBeInstanceOf(AssetClassNotImplementedError);
      await expect(
        adapter.getOpenPrice('AAPL', '2026-01-02', AssetClass.CRYPTO),
      ).rejects.toBeInstanceOf(AssetClassNotImplementedError);
      await expect(
        adapter.getTradingDays('2026-01-01', '2026-01-06', AssetClass.US_STOCK),
      ).rejects.toBeInstanceOf(AssetClassNotImplementedError);
    });
  });
});
