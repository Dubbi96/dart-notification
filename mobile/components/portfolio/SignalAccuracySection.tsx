import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { InfoSheet, type InfoSheetSection } from '@components/common/InfoSheet';
import { useSignalAccuracy } from '@hooks/useSignalAccuracy';

import type { AccuracyBucket, HorizonAccuracy } from '@app-types/signal-accuracy.types';

// 신호 정밀도(사후검증) 섹션 — DAR-73.
// 과거 신호의 등급/이벤트별 D+5/D+20 실현 초과수익(시장 대비)·승률·표본을 표시한다.
// ★ read-only 리포트 — 가중치/임계값 조정은 휴먼 판단. 표본<5는 LOW_SAMPLE 투명 배지.
// TRUST-02: 1차 수치 = 중앙값(robustExcessReturn) — 평균은 소수 극단치에 오염될 수 있어
//           보조 표기로 강등한다(설명은 InfoSheet). 승률·표본 병기는 유지.
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

// info 버튼(아이콘 14px)의 유효 터치 영역을 44pt로 확장(ScoreGauge B1 패턴). 14 + 15*2 = 44.
const INFO_HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 };

// TRUST-02: 1차 수치를 평균→중앙값으로 교체한 근거 설명(InfoSheet).
const ACCURACY_INFO_SECTIONS: InfoSheetSection[] = [
  {
    icon: 'bar-chart-2',
    heading: '1차 수치는 중앙값',
    body: '표시되는 초과수익은 실현 표본의 중앙값(median)입니다. 평균은 극단치에 민감해 소수의 폭등·폭락 표본이 대표값을 왜곡할 수 있어, 전형값인 중앙값을 1차로 보여드려요. 평균은 아래 보조 표기로 함께 제공합니다.',
  },
];

const ACCURACY_INFO_FOOTNOTE =
  '사후검증 리포트는 참고 정보입니다. 가중치·임계값 조정은 사람의 판단입니다.';

/** D+N 한 지평 요약(중앙값 초과수익 1차 + 평균 보조·승률·표본·유의) */
function HorizonStat({ label, h }: { label: string; h: HorizonAccuracy }) {
  const { colors, typography: typo } = useTheme();
  const hasSample = h.sampleCount > 0;
  // TRUST-02: 1차 수치·색조 = 중앙값(robustExcessReturn). 평균은 극단치 오염 가능 → 보조 표기.
  const valColor = !hasSample
    ? colors.textTertiary
    : returnColor(h.robustExcessReturn ?? 0, colors);
  return (
    <View
      style={styles.horizon}
      accessibilityRole="text"
      accessibilityLabel={`${label} 중앙값 초과수익 ${formatReturnPct(h.robustExcessReturn)}, 평균 ${formatReturnPct(
        h.avgExcessReturn,
      )}, 승률 ${formatWinRate(h.winRate)}, 표본 ${h.sampleCount}`}
    >
      <View style={styles.horizonHead}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
        {hasSample && h.isSignificant ? (
          <Feather name="check-circle" size={11} color={colors.success} style={styles.sigIcon} />
        ) : null}
      </View>
      <Text style={[typo.captionMedium, { color: valColor, marginTop: spacing.xs }]}>
        {formatReturnPct(h.robustExcessReturn)}
      </Text>
      <Text style={[typo.small, { color: colors.textTertiary }]}>
        승률 {formatWinRate(h.winRate)} · 표본 {h.sampleCount}
      </Text>
      <Text style={[typo.small, { color: colors.textTertiary }]}>
        평균 {formatReturnPct(h.avgExcessReturn)}
      </Text>
    </View>
  );
}

function BucketRow({ bucket, dimension }: { bucket: AccuracyBucket; dimension: Dimension }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.borderLight }]}>
      <View style={styles.rowHead}>
        <Text
          style={[typo.caption, { color: colors.text, flexShrink: 1, minWidth: 0 }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {bucketLabel(dimension, bucket.key)}
        </Text>
        {bucket.lowSample ? (
          <DataLimitBadge sampleCount={bucket.sampleCount} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            표본 {bucket.sampleCount}
          </Text>
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
  const [infoVisible, setInfoVisible] = useState(false);
  const openInfo = useCallback(() => setInfoVisible(true), []);
  const closeInfo = useCallback(() => setInfoVisible(false), []);
  const query = useSignalAccuracy();
  const data = query.data;

  const buckets = data ? (dimension === 'grade' ? data.byGrade : data.byEventType) : [];
  const noRealized = !!data && data.realizedD5 === 0 && data.realizedD20 === 0;

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleGroup}>
          <Text style={[typo.captionMedium, { color: colors.text }]}>신호 정밀도 (사후검증)</Text>
          {/* TRUST-02: 중앙값 1차 표기 근거 설명 진입점(ScoreGauge B1 패턴 재사용). */}
          <TouchableOpacity
            onPress={openInfo}
            style={styles.infoBtn}
            hitSlop={INFO_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="신호 정밀도 수치 설명 보기"
          >
            <Feather name="info" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {data ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            신호 {data.totalSignals}건
          </Text>
        ) : null}
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        과거 신호의 D+5/D+20 실현 초과수익(시장 대비) 중앙값·승률을 검증합니다. 조정은 사람의
        판단입니다.
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
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                style={[
                  typo.small,
                  {
                    color: active ? colors.text : colors.textSecondary,
                    fontWeight: active ? '600' : '400',
                    minWidth: 0,
                  },
                ]}
                ellipsizeMode="tail"
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
          <TouchableOpacity
            onPress={() => query.refetch()}
            accessibilityRole="button"
            accessibilityLabel="다시 시도"
          >
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

      {/* TRUST-02: '평균은 극단치에 민감' 설명 바텀시트. */}
      <InfoSheet
        visible={infoVisible}
        onClose={closeInfo}
        title="신호 정밀도 안내"
        sections={ACCURACY_INFO_SECTIONS}
        footnote={ACCURACY_INFO_FOOTNOTE}
      />
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
  titleGroup: { flexDirection: 'row', alignItems: 'center' },
  infoBtn: { marginLeft: spacing.xs },
  tabs: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // UXR-14 C-4: typo.small(16)+padding(8×2)≈32pt로 44pt 미달 — 유효 터치영역 보장.
    minHeight: sizing.minTouchTarget,
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
