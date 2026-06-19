import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, AppState, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { QuoteHeader } from '@components/common/QuoteHeader';
import { MinuteCandleChart } from '@components/company/MinuteCandleChart';
import { DailyCandleChart } from '@components/company/DailyCandleChart';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { useMinuteCandles } from '@hooks/useMinuteCandles';
import { useDailyCandles, type DailyRangePreset } from '@hooks/useDailyCandles';
import { resolveQuotePollInterval } from '@utils/marketQuoteDisplay';

// DAR-355/384: 일반 주식앱 스타일 전용 종목 차트 화면(풀스크린, 분봉+일봉).
// 소비자 화면 — QuoteHeader(DAR-353)·MinuteCandleChart/useMinuteCandles(DAR-354)·
//   DailyCandleChart/useDailyCandles(DAR-384)·useStockQuotes 를 조립한다.
// ★정직: 분봉/현재가는 실제 시장 실시간 시세, 일봉은 KRX 종가(EOD) → 화면 상단 '실시간 시장가'
//   고지 1줄(앱 환경시계와 괴리 가능). 세부 출처/갱신시각 괴리는 각 차트(asOf/source)가 내부 렌더.
// 일봉 탭(DAR-384): 백필 일봉(StockDailyPrice, source=EOD)을 실제 일봉 차트로 렌더 + 구간 선택(3M/1Y/전체).

const QUOTE_POLL_INTERVAL_MS = 15 * 1000;

type Timeframe = 'minute' | 'daily';

const DAILY_RANGE_OPTIONS: { value: DailyRangePreset; label: string }[] = [
  { value: '3M', label: '3개월' },
  { value: '1Y', label: '1년' },
  { value: 'ALL', label: '전체' },
];

export default function StockChartScreen() {
  const { stockCode } = useLocalSearchParams<{ stockCode: string }>();
  const { colors, typography: typo } = useTheme();
  const code = (stockCode ?? '').trim();

  // 포커스·앱활성 게이트(DAR-353 idiom) — 화면 보고 있고 앱 active 일 때만 시세 폴링.
  const [isFocused, setIsFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setAppActive(s === 'active');
    });
    return () => sub.remove();
  }, []);

  const quotePollInterval = resolveQuotePollInterval({
    isFocused,
    appActive,
    now: new Date(),
    intervalMs: QUOTE_POLL_INTERVAL_MS,
  });
  const { quotes, dataUpdatedAt: quoteUpdatedAt } = useStockQuotes([code], {
    refetchInterval: quotePollInterval,
  });
  const quote = code ? quotes[code] : null;

  // 당일 분봉(인트라데이) — 장중에만 1분 폴링(훅 내부 게이트).
  const {
    candles: minuteCandles,
    asOf: minuteCandlesAsOf,
    isLoading: isLoadingMinuteCandles,
    isError: isMinuteCandlesError,
    refetch: refetchMinuteCandles,
  } = useMinuteCandles(code, { pollWhileMarketOpen: true });

  // 일봉(딥히스토리, EOD) — 구간 프리셋(기본 1년). 폴링 없음(장 마감 후 확정).
  const [dailyRange, setDailyRange] = useState<DailyRangePreset>('1Y');
  const {
    candles: dailyCandles,
    source: dailySource,
    asOf: dailyCandlesAsOf,
    isLoading: isLoadingDailyCandles,
    isError: isDailyCandlesError,
    refetch: refetchDailyCandles,
  } = useDailyCandles(code, { range: dailyRange });

  const [timeframe, setTimeframe] = useState<Timeframe>('minute');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader
        title={code ? `종목 ${code}` : '종목 차트'}
        subtitle="실시간 분봉 · 현재가"
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ★정직: 실시간 시장가 고지(환경시계 괴리 가능) — 항상 노출. */}
        <Text style={[typo.small, styles.honesty, { color: colors.textTertiary }]}>
          실시간 시장가 — 분봉·현재가는 실제 장중 시세이며, 앱 내 다른 날짜 표기와 다를 수 있습니다.
        </Text>

        {/* 상단 대형 현재가 헤더(DAR-353). 가격 없으면 컴포넌트가 null 처리(미표시). */}
        <QuoteHeader quote={quote} updatedAt={quoteUpdatedAt} style={styles.quoteHeader} />

        {/* 타임프레임 토글 — 분봉 우선, 일봉은 적재 훅 부재로 '준비중'. */}
        <View style={styles.toggle}>
          <SegmentedButtons
            value={timeframe}
            onValueChange={(v) => setTimeframe(v as Timeframe)}
            buttons={[
              { value: 'minute', label: '분봉' },
              { value: 'daily', label: '일봉' },
            ]}
          />
        </View>

        {/* 일봉 구간 선택 — 일봉 탭일 때만 노출(3개월/1년/전체). */}
        {timeframe === 'daily' ? (
          <View style={styles.rangeToggle}>
            <SegmentedButtons
              value={dailyRange}
              onValueChange={(v) => setDailyRange(v as DailyRangePreset)}
              density="small"
              buttons={DAILY_RANGE_OPTIONS}
            />
          </View>
        ) : null}

        <Card style={styles.chartCard} variant="elevated">
          {timeframe === 'minute' ? (
            <MinuteCandleChart
              candles={minuteCandles}
              asOf={minuteCandlesAsOf}
              isLoading={isLoadingMinuteCandles}
              isError={isMinuteCandlesError}
              onRetry={() => {
                void refetchMinuteCandles();
              }}
            />
          ) : (
            <DailyCandleChart
              candles={dailyCandles}
              source={dailySource}
              asOf={dailyCandlesAsOf}
              isLoading={isLoadingDailyCandles}
              isError={isDailyCandlesError}
              onRetry={() => {
                void refetchDailyCandles();
              }}
            />
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  honesty: {
    lineHeight: 16,
  },
  quoteHeader: {
    marginTop: spacing.xs,
  },
  toggle: {
    marginTop: spacing.sm,
  },
  rangeToggle: {
    marginTop: spacing.xs,
  },
  chartCard: {
    padding: spacing.md,
  },
});
