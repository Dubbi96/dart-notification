import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { useSignalAccuracy } from '@hooks/useSignalAccuracy';

import type { AccuracyBucket, HorizonAccuracy } from '@app-types/signal-accuracy.types';

// 신호 정밀도(사후검증) 섹션 — DAR-73.
// 과거 신호의 등급/이벤트별 D+5/D+20 실현 초과수익(시장 대비)·승률·표본을 표시한다.
// ★ read-only 리포트 — 가중치/임계값 조정은 휴먼 판단. 표본<5는 LOW_SAMPLE 투명 배지.
// 테마토큰만(하드코딩 색상 0)·접근성·로딩/에러/빈 처리.

type Dimension = 'grade' | 'eventType';

// 백엔드 SignalGrade enum → 한국어 라벨(raw enum 비노출)
const GRADE_LABEL: Record<string, string> = {
  STRONG_BUY_CANDIDATE: '적극 매수',
  BUY_CANDIDATE: '매수',
  WATCH: '관찰',
  NEUTRAL: '중립',
  AVOID: '회피',
  BLOCKED: '차단',
};

function bucketLabel(dimension: Dimension, key: string): string {
  if (dimension === 'grade') return GRADE_LABEL[key] ?? key;
  return getEventTypeLabel(key);
}

/** D+N 한 지평 요약(평균 초과수익·승률·표본·유의) */
function HorizonStat({ label, h }: { label: string; h: HorizonAccuracy }) {
  const { colors, typography: typo } = useTheme();
  const hasSample = h.sampleCount > 0;
  const valColor = !hasSample
    ? colors.textTertiary
    : returnColor(h.avgExcessReturn ?? 0, colors);
  return (
    <View
      style={styles.horizon}
      accessibilityRole="text"
      accessibilityLabel={`${label} 평균 초과수익 ${formatReturnPct(h.avgExcessReturn)}, 승률 ${formatWinRate(
        h.winRate,
      )}, 표본 ${h.sampleCount}`}
    >
      <View style={styles.horizonHead}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
        {hasSample && h.isSignificant ? (
          <Feather name="check-circle" size={11} color={colors.success} style={styles.sigIcon} />
        ) : null}
      </View>
      <Text style={[typo.captionMedium, { color: valColor, marginTop: spacing.xs }]}>
        {formatReturnPct(h.avgExcessReturn)}
      </Text>
      <Text style={[typo.small, { color: colors.textTertiary }]}>
        승률 {formatWinRate(h.winRate)} · 표본 {h.sampleCount}
      </Text>
    </View>
  );
}

function BucketRow({ bucket, dimension }: { bucket: AccuracyBucket; dimension: Dimension }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.borderLight }]}>
      <View style={styles.rowHead}>
        <Text style={[typo.caption, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
          {bucketLabel(dimension, bucket.key)}
        </Text>
        {bucket.lowSample ? (
          <DataLimitBadge sampleCount={bucket.sampleCount} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]}>표본 {bucket.sampleCount}</Text>
        )}
      </View>
      <View style={styles.horizonRow}>
        <HorizonStat label="D+5" h={bucket.d5} />
        <HorizonStat label="D+20" h={bucket.d20} />
      </View>
    </View>
  );
}

export function SignalAccuracySection() {
  const { colors, typography: typo } = useTheme();
  const [dimension, setDimension] = useState<Dimension>('grade');
  const query = useSignalAccuracy();
  const data = query.data;

  const buckets = data
    ? dimension === 'grade'
      ? data.byGrade
      : data.byEventType
    : [];
  const noRealized = !!data && data.realizedD5 === 0 && data.realizedD20 === 0;

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[typo.captionMedium, { color: colors.text }]}>신호 정밀도 (사후검증)</Text>
        {data ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>신호 {data.totalSignals}건</Text>
        ) : null}
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        과거 신호의 D+5/D+20 실현 초과수익(시장 대비)·승률을 검증합니다. 조정은 사람의 판단입니다.
      </Text>

      {/* 차원 탭: 등급별 / 이벤트별 */}
      <View style={[styles.tabs, { backgroundColor: colors.surfaceSecondary }]}>
        {(['grade', 'eventType'] as Dimension[]).map((d) => {
          const active = dimension === d;
          return (
            <TouchableOpacity
              key={d}
              onPress={() => setDimension(d)}
              style={[styles.tab, active ? { backgroundColor: colors.surface } : null]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={d === 'grade' ? '등급별 보기' : '이벤트별 보기'}
            >
              <Text
                style={[typo.small, { color: active ? colors.text : colors.textSecondary, fontWeight: active ? '600' : '400' }]}
              >
                {d === 'grade' ? '등급별' : '이벤트별'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {query.isLoading ? (
        <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.md }]}>
          정밀도 리포트를 불러오는 중...
        </Text>
      ) : query.isError ? (
        <View style={styles.inlineState}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            정밀도 리포트를 불러오지 못했습니다.
          </Text>
          <TouchableOpacity onPress={() => query.refetch()} accessibilityRole="button" accessibilityLabel="다시 시도">
            <Text style={[typo.small, { color: colors.info, fontWeight: '600' }]}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : noRealized || buckets.length === 0 ? (
        <View style={styles.inlineState}>
          <Feather name="clock" size={14} color={colors.textTertiary} />
          <Text style={[typo.small, { color: colors.textSecondary, flexShrink: 1 }]}>
            아직 실현 검증 표본이 없습니다. 최근 신호는 D+20 경과 후 집계됩니다.
          </Text>
        </View>
      ) : (
        <View>
          {buckets.map((b) => (
            <BucketRow key={b.key} bucket={b} dimension={dimension} />
          ))}
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  row: {
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  horizonRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  horizon: { width: '50%' },
  horizonHead: { flexDirection: 'row', alignItems: 'center' },
  sigIcon: { marginLeft: spacing.xs },
  inlineState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});
