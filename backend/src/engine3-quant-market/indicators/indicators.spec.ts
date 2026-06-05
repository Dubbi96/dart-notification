import {
  calcMA,
  calcRSI,
  calcMACD,
  calcBollinger,
  calcATR,
  calcVWAP,
  calcVolumeRatio,
  calc52WHighLow,
  calcPreDisclosureReturn,
  calcAllIndicators,
  Candle,
} from './indicators';

describe('calcMA', () => {
  it('calculates SMA correctly', () => {
    // (10+20+30+40+50)/5 = 30
    expect(calcMA([10, 20, 30, 40, 50], 5)).toBeCloseTo(30);
  });

  it('uses last N elements', () => {
    // last 3 of [10,20,30,40,50] = (30+40+50)/3 ≈ 40
    expect(calcMA([10, 20, 30, 40, 50], 3)).toBeCloseTo(40);
  });

  it('returns null when insufficient data', () => {
    expect(calcMA([10, 20], 5)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(calcMA([], 5)).toBeNull();
  });
});

describe('calcRSI', () => {
  it('returns 100 when all gains (no losses)', () => {
    // period=14, 15 consecutive up-closes: no losses → RSI=100
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    expect(calcRSI(closes, 14)).toBeCloseTo(100);
  });

  it('returns 0 when all losses (no gains)', () => {
    const closes = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(calcRSI(closes, 14)).toBeCloseTo(0);
  });

  it('returns null with insufficient data', () => {
    expect(calcRSI([10, 11, 12], 14)).toBeNull();
  });

  it('returns value in [0,100] range', () => {
    const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    const rsi = calcRSI(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });

  it('calculates RSI with period=3 manually', () => {
    // closes = [10, 12, 11, 13, 12]  period=3
    // diffs: +2, -1, +2, -1
    // initial: avgGain=(2+0+2)/3=4/3, avgLoss=(0+1+0)/3=1/3
    // i=4: diff=-1, gain=0, loss=1
    //   avgGain=(4/3*2+0)/3=8/9, avgLoss=(1/3*2+1)/3=(2/3+1)/3=5/9
    // RS = (8/9)/(5/9) = 8/5 = 1.6
    // RSI = 100 - 100/(1+1.6) = 100 - 100/2.6 ≈ 61.54
    const closes = [10, 12, 11, 13, 12];
    const rsi = calcRSI(closes, 3);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeCloseTo(61.54, 1);
  });
});

describe('calcMACD', () => {
  it('returns nulls when insufficient data', () => {
    const result = calcMACD([1, 2, 3], 12, 26, 9);
    expect(result.macdLine).toBeNull();
    expect(result.signalLine).toBeNull();
    expect(result.histogram).toBeNull();
  });

  it('histogram = macdLine - signalLine', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const { macdLine, signalLine, histogram } = calcMACD(closes);
    if (macdLine !== null && signalLine !== null && histogram !== null) {
      expect(histogram).toBeCloseTo(macdLine - signalLine, 8);
    }
  });

  it('returns non-null for sufficient data (34+ prices)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const { macdLine } = calcMACD(closes);
    expect(macdLine).not.toBeNull();
  });
});

describe('calcBollinger', () => {
  it('calculates Bollinger Bands correctly (period=4)', () => {
    // closes = [2, 4, 6, 8]
    // mid = 5, variance = (9+1+1+9)/4 = 5, std = sqrt(5)
    // upper = 5 + 2*sqrt(5), lower = 5 - 2*sqrt(5)
    const closes = [2, 4, 6, 8];
    const { upper, mid, lower } = calcBollinger(closes, 4, 2);
    const std = Math.sqrt(5);
    expect(mid).toBeCloseTo(5);
    expect(upper).toBeCloseTo(5 + 2 * std);
    expect(lower).toBeCloseTo(5 - 2 * std);
  });

  it('returns nulls when insufficient data', () => {
    const { upper, mid, lower } = calcBollinger([10, 20], 20);
    expect(upper).toBeNull();
    expect(mid).toBeNull();
    expect(lower).toBeNull();
  });

  it('upper > mid > lower', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const { upper, mid, lower } = calcBollinger(closes);
    expect(upper!).toBeGreaterThan(mid!);
    expect(mid!).toBeGreaterThan(lower!);
  });
});

describe('calcATR', () => {
  it('calculates ATR correctly (period=3)', () => {
    // candles[0]={h:10,l:8,c:9}
    // TR[1]: max(12-9, |12-9|, |9-9|) = max(3,3,0) = 3
    // TR[2]: max(11-9, |11-11|, |9-11|) = max(2,0,2) = 2
    // TR[3]: max(13-10, |13-10|, |10-10|) = max(3,3,0) = 3
    // initial ATR = (3+2+3)/3 = 8/3 ≈ 2.667
    const candles = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
      { high: 11, low: 9, close: 10 },
      { high: 13, low: 10, close: 12 },
    ];
    const atr = calcATR(candles, 3);
    expect(atr).not.toBeNull();
    expect(atr!).toBeCloseTo(8 / 3, 4);
  });

  it('returns null when insufficient data', () => {
    const candles = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
    ];
    expect(calcATR(candles, 14)).toBeNull();
  });

  it('returns positive value', () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
      high: 100 + i + 2,
      low: 100 + i - 2,
      close: 100 + i,
    }));
    const atr = calcATR(candles, 14);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0);
  });
});

describe('calcVWAP', () => {
  it('calculates VWAP correctly', () => {
    // candle1: tp=(12+10+11)/3=11, vol=100 → PV=1100
    // candle2: tp=(14+12+13)/3=13, vol=200 → PV=2600
    // VWAP = 3700/300 ≈ 12.333
    const candles = [
      { high: 12, low: 10, close: 11, volume: 100 },
      { high: 14, low: 12, close: 13, volume: 200 },
    ];
    expect(calcVWAP(candles)).toBeCloseTo(3700 / 300, 4);
  });

  it('returns null for empty candles', () => {
    expect(calcVWAP([])).toBeNull();
  });

  it('returns null when all volumes are 0', () => {
    const candles = [{ high: 10, low: 8, close: 9, volume: 0 }];
    expect(calcVWAP(candles)).toBeNull();
  });
});

describe('calcVolumeRatio', () => {
  it('calculates ratio correctly', () => {
    // past 3 volumes: [100,100,100] → avg=100, current=200
    // ratio = 200/100 = 2.0
    const volumes = [100, 100, 100, 200];
    expect(calcVolumeRatio(volumes, 3)).toBeCloseTo(2.0);
  });

  it('returns null with insufficient data', () => {
    expect(calcVolumeRatio([100, 200], 20)).toBeNull();
  });

  it('returns null when average volume is 0', () => {
    const volumes = [0, 0, 0, 100];
    expect(calcVolumeRatio(volumes, 3)).toBeNull();
  });
});

describe('calc52WHighLow', () => {
  it('finds 52-week high and low', () => {
    const candles = [
      { high: 120, low: 90 },
      { high: 130, low: 95 },
      { high: 110, low: 80 },
    ];
    const { high52w, low52w } = calc52WHighLow(candles);
    expect(high52w).toBe(130);
    expect(low52w).toBe(80);
  });

  it('returns nulls for empty array', () => {
    const { high52w, low52w } = calc52WHighLow([]);
    expect(high52w).toBeNull();
    expect(low52w).toBeNull();
  });

  it('uses at most 252 candles', () => {
    const candles = Array.from({ length: 300 }, (_, i) => ({
      high: i === 0 ? 9999 : 100 + i,
      low: i === 0 ? 1 : 50 + i,
    }));
    const { high52w, low52w } = calc52WHighLow(candles);
    // Index 0 is outside 252-day window, so 9999 should NOT be the high
    expect(high52w).not.toBe(9999);
    expect(low52w).not.toBe(1);
  });
});

describe('calcPreDisclosureReturn', () => {
  it('calculates return D-5 to D-1 correctly', () => {
    // closes[0]=100(D-5), closes[4]=108(D-1), disclosure at idx=5
    // return = (108-100)/100 * 100 = 8%
    const closes = [100, 102, 104, 106, 108, 110];
    expect(calcPreDisclosureReturn(closes, 5)).toBeCloseTo(8.0);
  });

  it('returns null when disclosureIdx < 5', () => {
    const closes = [100, 102, 104, 106];
    expect(calcPreDisclosureReturn(closes, 3)).toBeNull();
  });

  it('handles negative return (price declined before disclosure)', () => {
    // closes[0]=110(D-5), closes[4]=100(D-1), disclosure at idx=5
    // return = (100-110)/110 * 100 ≈ -9.09%
    const closes = [110, 108, 106, 104, 100, 98];
    const ret = calcPreDisclosureReturn(closes, 5);
    expect(ret).not.toBeNull();
    expect(ret!).toBeCloseTo(-9.09, 1);
  });
});

describe('calcAllIndicators', () => {
  it('returns all null when candles are insufficient', () => {
    const candles: Candle[] = [
      { date: '20260101', open: 100, high: 105, low: 98, close: 103, volume: 1000 },
    ];
    const result = calcAllIndicators(candles);
    expect(result.ma5).toBeNull();
    expect(result.rsi14).toBeNull();
    expect(result.macdLine).toBeNull();
    expect(result.bollingerUpper).toBeNull();
    expect(result.atr14).toBeNull();
  });

  it('returns non-null indicators with sufficient data (130 candles)', () => {
    const candles: Candle[] = Array.from({ length: 130 }, (_, i) => ({
      date: `2026${String(Math.floor(i / 30) + 1).padStart(2, '0')}${String((i % 30) + 1).padStart(2, '0')}`,
      open: 100 + i,
      high: 102 + i,
      low: 98 + i,
      close: 100 + i,
      volume: 100000 + i * 1000,
    }));
    const result = calcAllIndicators(candles);
    expect(result.ma5).not.toBeNull();
    expect(result.ma20).not.toBeNull();
    expect(result.ma60).not.toBeNull();
    expect(result.ma120).not.toBeNull();
    expect(result.rsi14).not.toBeNull();
    expect(result.bollingerUpper).not.toBeNull();
    expect(result.atr14).not.toBeNull();
    expect(result.vwap).not.toBeNull();
    expect(result.volumeRatio20).not.toBeNull();
    expect(result.high52w).not.toBeNull();
    expect(result.low52w).not.toBeNull();
  });
});
