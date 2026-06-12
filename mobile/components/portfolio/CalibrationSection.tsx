import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { useCalibration } from '@hooks/useCalibration';

import type {
  EventScoreCalibration,
  GradeConfidenceCalibration,
  CalibrationHorizon,
  CalibrationStatus,
} from '@app-types/calibration.types';

// 신호 보정 루프 리포트 섹션 — DAR-92.
// 백테스트 실현 초과수익과 EVENT_BASE_SCORES 의 괴리·권장 delta(이벤트별),
// 등급별 실현 승률 대비 confidence 보정계수(등급별)를 표시한다.
// ★★ 자동 반영 버튼 절대 없음 — 읽기 전용 권고만. 상수 변경은 사람의 PR 로만.
// ★ lowSample/HOLD 항목은 투명하게 표기(과신 방지)·테마토큰만(하드코딩 색상 0)·접근성.

type Dimension = 'event' | 'grade';

// 백엔드 SignalGrade enum → 한국어 라벨(raw enum 비노출) — SignalAccuracySection 규약 재사용
const GRADE_LABEL: Record<string, string> = {
  STRONG_BUY_CANDIDATE: '적극 매수',
  BUY_CANDIDATE: '매수',
  WATCH: '관찰',
  NEUTRAL: '중립',
  AVOID: '회피',
  BLOCKED: '차단',
};

const STATUS_LABEL: Record<CalibrationStatus, string> = {
  CALIBRATE: '조정 권장',
  ALIGNED: '정렬됨',
  HOLD: '보류',
};

function formatScore(v: number | null): string {
  if (v === null) return '미등재';
  return `${v}`;
}

function formatSignedInt(v: number | null): string {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v}`;
}

function StatusBadge({ status }: { status: CalibrationStatus }) {
  const { colors, typography: typo } = useTheme();
  const color =
    status === 'CALIBRATE'
      ? colors.warning
      : status === 'ALIGNED'
        ? colors.success
        : colors.textTertiary;
  return (
    <View
      style={[styles.statusBadge, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityLabel={`상태 ${STATUS_LABEL[status]}`}
    >
      <Text style={[typo.small, { color, fontWeight: '600' }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

/** 작은 라벨/값 1쌍 */
function Field({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.field} accessibilityRole="text" accessibilityLabel={`${label} ${value}`}>
      <Text style={[typo.small, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: valueColor ?? colors.text, marginTop: spacing.xs }]}>
        {value}
      </Text>
    </View>
  );
}

function EventRow({ item }: { item: EventScoreCalibration }) {
  const { colors, typography: typo } = useTheme();
  const arColor =
    item.avgExcessReturn === null
      ? colors.textTertiary
      : returnColor(item.avgExcessReturn, colors);
  const showDelta = item.status === 'CALIBRATE';

  return (
    <View style={[styles.row, { borderTopColor: colors.borderLight }]}>
      <View style={styles.rowHead}>
        <Text style={[typo.caption, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
          {getEventTypeLabel(item.eventType)}
        </Text>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.fieldGrid}>
        <Field label="현재 BASE" value={formatScore(item.currentBaseScore)} />
        <Field label="실현 초과수익" value={formatReturnPct(item.avgExcessReturn)} valueColor={arColor} />
        <Field label="괴리(gap)" value={formatSignedInt(item.gap)} />
      </View>

      {/* 권장 조정(diff) — CALIBRATE 일 때만 노출. ★ 표시만, 자동반영 없음 */}
      {showDelta ? (
        <View
          style={[styles.deltaBox, { backgroundColor: colors.surfaceSecondary }]}
          accessibilityRole="text"
          accessibilityLabel={`권장 조정 ${formatSignedInt(item.suggestedDelta)}, 현재 ${formatScore(
            item.currentBaseScore,
          )} 에서 권장 ${formatScore(item.suggestedNewScore)} 로 (사람 검토용 권고)`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>권장 Δ</Text>
          <View style={styles.deltaDiff}>
            <Text style={[typo.captionMedium, { color: colors.textTertiary }]}>
              {formatScore(item.currentBaseScore)}
            </Text>
            <Feather name="arrow-right" size={13} color={colors.textTertiary} style={styles.arrow} />
            <Text style={[typo.captionMedium, { color: colors.text }]}>
              {formatScore(item.suggestedNewScore)}
            </Text>
            <Text style={[typo.small, { color: colors.warning, marginLeft: spacing.sm, fontWeight: '600' }]}>
              ({formatSignedInt(item.suggestedDelta)})
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.holdRow}>
          {item.lowSample ? (
            <DataLimitBadge sampleCount={item.sampleCount} />
          ) : (
            <Text style={[typo.small, { color: colors.textTertiary }]}>
              {item.reason}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function GradeRow({ item }: { item: GradeConfidenceCalibration }) {
  const { colors, typography: typo } = useTheme();
  const isDiscount = item.coefficient < 1;
  const coeffColor = isDiscount ? colors.warning : colors.textSecondary;

  return (
    <View style={[styles.row, { borderTopColor: colors.borderLight }]}>
      <View style={styles.rowHead}>
        <Text style={[typo.caption, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
          {GRADE_LABEL[item.grade] ?? item.grade}
        </Text>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.fieldGrid}>
        <Field label="실현 승률" value={formatWinRate(item.winRate)} />
        <Field label="기대 승률" value={formatWinRate(item.expectedWinRate)} />
        <Field
          label="보정계수"
          value={item.coefficient.toFixed(3)}
          valueColor={coeffColor}
        />
      </View>

      <View style={styles.holdRow}>
        {item.lowSample ? (
          <DataLimitBadge sampleCount={item.sampleCount} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={2}>
            {isDiscount ? `confidence ${item.coefficient.toFixed(3)} 디스카운트 (점수 한정·실주문 무관)` : item.reason}
          </Text>
        )}
      </View>
    </View>
  );
}

export function CalibrationSection() {
  const { colors, typography: typo } = useTheme();
  const [dimension, setDimension] = useState<Dimension>('event');
  const [horizon, setHorizon] = useState<CalibrationHorizon>('d20');
  const query = useCalibration();
  const data = query.data;

  const eventRows = data
    ? horizon === 'd20'
      ? data.eventScoreCalibrationsD20
      : data.eventScoreCalibrationsD5
    : [];
  const gradeRows = data?.gradeConfidenceCalibrationsD20 ?? [];
  const noRealized = !!data && data.source.realizedD5 === 0 && data.source.realizedD20 === 0;
  const rowsEmpty = dimension === 'event' ? eventRows.length === 0 : gradeRows.length === 0;

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[typo.captionMedium, { color: colors.text }]}>신호 보정 권고 (자기교정)</Text>
        {data ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            신호 {data.source.totalSignals}건
          </Text>
        ) : null}
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        실현 초과수익과 현재 기준점수의 괴리를 권장 조정량으로 제시합니다. 읽기 전용 권고이며,
        실제 상수 반영은 사람의 검토(PR)로만 이뤄집니다.
      </Text>

      {/* 자동반영 금지 고지 — 항상 명시(휴먼 승인 게이트) */}
      <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
        <Feather name="lock" size={12} color={colors.info} />
        <Text style={[typo.small, { color: colors.info, flexShrink: 1, marginLeft: spacing.sm }]}>
          자동 반영 없음 — 권고 표시만. 상수 변경은 사람의 PR 검토 후에만 적용됩니다.
        </Text>
      </View>

      {/* 차원 탭: 이벤트별 / 등급별 */}
      <View style={[styles.tabs, { backgroundColor: colors.surfaceSecondary }]}>
        {(['event', 'grade'] as Dimension[]).map((d) => {
          const active = dimension === d;
          return (
            <TouchableOpacity
              key={d}
              onPress={() => setDimension(d)}
              style={[styles.tab, active ? { backgroundColor: colors.surface } : null]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={d === 'event' ? '이벤트별 기준점수 보정 보기' : '등급별 confidence 보정 보기'}
            >
              <Text
                style={[typo.small, { color: active ? colors.text : colors.textSecondary, fontWeight: active ? '600' : '400' }]}
              >
                {d === 'event' ? '이벤트별' : '등급별'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 지평 토글(이벤트 차원만) — 등급 보정계수는 D+20 단일축 */}
      {dimension === 'event' ? (
        <View style={styles.horizonToggle}>
          {(['d20', 'd5'] as CalibrationHorizon[]).map((h) => {
            const active = horizon === h;
            return (
              <TouchableOpacity
                key={h}
                onPress={() => setHorizon(h)}
                style={styles.horizonChipTouch}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={h === 'd20' ? 'D+20 지평' : 'D+5 지평'}
              >
                <Text
                  style={[
                    typo.small,
                    {
                      color: active ? colors.info : colors.textTertiary,
                      fontWeight: active ? '700' : '400',
                    },
                  ]}
                >
                  {h === 'd20' ? 'D+20' : 'D+5'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {query.isLoading ? (
        <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.md }]}>
          보정 리포트를 불러오는 중...
        </Text>
      ) : query.isError ? (
        <View style={styles.inlineState}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            보정 리포트를 불러오지 못했습니다.
          </Text>
          <TouchableOpacity onPress={() => query.refetch()} accessibilityRole="button" accessibilityLabel="다시 시도">
            <Text style={[typo.small, { color: colors.info, fontWeight: '600' }]}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : noRealized || rowsEmpty ? (
        <View style={styles.inlineState}>
          <Feather name="clock" size={14} color={colors.textTertiary} />
          <Text style={[typo.small, { color: colors.textSecondary, flexShrink: 1 }]}>
            아직 보정에 쓸 실현 표본이 없습니다. 신호는 D+20 경과 후 집계됩니다.
          </Text>
        </View>
      ) : dimension === 'event' ? (
        <View>
          {eventRows.map((b) => (
            <EventRow key={`${b.eventType}-${b.horizon}`} item={b} />
          ))}
        </View>
      ) : (
        <View>
          {gradeRows.map((b) => (
            <GradeRow key={`${b.grade}-${b.horizon}`} item={b} />
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
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
  horizonToggle: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    paddingVertical: spacing.xs,
  },
  horizonChipTouch: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
  fieldGrid: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  field: { width: '33.33%' },
  deltaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  deltaDiff: { flexDirection: 'row', alignItems: 'center' },
  arrow: { marginHorizontal: spacing.sm },
  holdRow: { marginTop: spacing.sm },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  inlineState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});
