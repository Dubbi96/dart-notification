import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { thesisStatusColor, positionSystemAction, formatPnlPercent } from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

// 포지션 카드(기획 §3 SCR-PORTFOLIO). 손익률 색상 + 시스템 자동 동작 배지.
// VIOLATED/EXPIRED 정렬 우선순위는 화면(리스트)에서 처리한다.
//
// DAR-357 스캔성 재설계: 가로 분리(이름·상태 / 손익) → 세로 스택([이름+상태칩]/[손익칩]/[메타]).
//  ① 좌측 엣지 솔리드 컬러바(코드에디터 에러마커식) — 다종목 세로 스캔 시 '빨간 막대 있나?'만 보면
//     위험 종목을 즉시 식별. 자동 매도 예정(하드룰 손절)·비정상 상태=경고색, 정상(ACTIVE)=중립.
//  ② 상태칩이 행동 지시를 흡수 → 별도 경고 행 제거(간결).
//
// DAR-368: 모의투자는 **시스템 트레이딩 현황**이다 — 상태칩을 자동 동작 언어로 표기한다.
//  · 하드룰 손절·청산(EXIT) = '자동 매도 예정'(솔리드 강조 + 자동 실행 아이콘 zap). 시스템이 다음
//    평가 시 자동 체결하므로 사용자 수동 매도가 불필요하다. 수동 점검을 암시하는 문구는 금지.
//  · 논거 훼손 등 소프트(VIOLATED) = '시스템 모니터링'(보조 표면 + activity). 자동 매도 전,
//    시스템이 자동 판단 중이며 역시 사용자 조치가 불필요하다 → 하드손절과 시각 구분.
// DAR-370: ①(스캔 구조)와 ②(자동 동작 라벨)는 양립한다 — 구조는 DAR-357, 칩 라벨/색은 DAR-368.

// 좌측 엣지 컬러바 폭(2~3px). 얇은 마커라 글꼴 배율과 독립적인 절대값으로 고정한다.
const ACCENT_BAR_WIDTH = 3;

interface PositionCardProps {
  position: Position;
  onPress?: (position: Position) => void;
}

function PositionCardBase({ position, onPress }: PositionCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(position), [onPress, position]);

  const status = position.thesisStatus;
  const statusColor = thesisStatusColor(status, colors);

  // DAR-368: 자동 동작 디스크립터(라벨·톤·a11y) — 표시 문구를 시스템 행동과 일치시킨다.
  const action = positionSystemAction(position);
  const isAutoSell = action.isAutoSell;
  const isMonitoring = action.tone === 'monitoring';

  // DAR-357 + DAR-368: 좌측 엣지 컬러바 — 자동 매도 예정(하드룰 손절)은 경고색으로 도드라지게,
  // 그 외 비정상 상태(훼손/만료/관찰)도 상태색, 정상(ACTIVE)은 중립 헤어라인(거짓 경보 방지).
  const barColor = isAutoSell ? colors.error : status === 'ACTIVE' ? colors.border : statusColor;

  // DAR-368: 자동 매도(하드룰 손절·청산)만 솔리드 경고색 강조 — 시스템이 실제로 체결을 예정함을 우선 노출.
  const chipBg = isAutoSell ? colors.error : colors.surfaceSecondary;
  const chipTextColor = isAutoSell ? colors.onColor : statusColor;

  // 수량·평단 메타 1줄(둘 다 부재 시 행 생략).
  const metaParts: string[] = [];
  if (position.quantity !== undefined) {
    metaParts.push(`${position.quantity.toLocaleString('ko-KR')}주`);
  }
  if (position.avgPrice !== undefined) {
    metaParts.push(`평단 ${position.avgPrice.toLocaleString('ko-KR')}원`);
  }
  const metaText = metaParts.join('  ·  ');

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${position.corpName}, 손익 ${formatPnlPercent(
        position.pnlPercent,
      )}, ${action.a11yLabel}`}
    >
      <Surface
        elevation={1}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {/* 좌측 엣지 상태 컬러바 — 카드 라운드에 맞춰 좌측 모서리만 둥글게(DAR-357). */}
        <View style={[styles.accentBar, { backgroundColor: barColor }]} />

        <View style={styles.header}>
          <Text
            style={[typo.bodyMedium, styles.name, { color: colors.text, minWidth: 0 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {position.corpName}
          </Text>
          <Chip
            compact
            mode="flat"
            // DAR-298: 고정 높이 상태칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            // DAR-368: 자동 매도(하드룰 손절·청산)만 솔리드 경고색, 그 외는 옅은 보조 표면.
            style={[styles.statusChip, { backgroundColor: chipBg }]}
            textStyle={[typo.small, { color: chipTextColor, fontWeight: '700' }]}
            // DAR-368: 자동 매도='zap'(시스템 자동 실행), 모니터링='activity'(시스템 감시). 수동 alert 금지.
            icon={
              isAutoSell
                ? ({ size }) => <Feather name="zap" size={size} color={chipTextColor} />
                : isMonitoring
                  ? ({ size }) => <Feather name="activity" size={size} color={chipTextColor} />
                  : undefined
            }
          >
            {action.label}
          </Chip>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </View>

        {/* 손익률 칩(§12) — 색조(이익/손실)+부호+화살표 병행. 좌측 정렬(내용폭만 차지) (DAR-357). */}
        <PriceChangeChip value={position.pnlPercent} context="pnl" style={styles.pnlChip} />

        {metaText ? (
          <Text
            style={[typo.small, { color: colors.textTertiary, flexShrink: 1, minWidth: 0 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {metaText}
          </Text>
        ) : null}

        {/* DAR-368: 하드룰 손절은 Engine5가 자동 체결 — 수동 매도 불필요임을 정직하게 고지(예정 상태). */}
        {isAutoSell ? (
          <Text style={[typo.small, { color: colors.error }]}>
            시스템이 다음 평가 시 자동 매도 — 조치 불필요
          </Text>
        ) : null}
      </Surface>
    </TouchableOpacity>
  );
}

// FlatList renderItem 자식 — 부모 리렌더 시 불필요한 리렌더 차단(DAR-128 성능 스윕).
export const PositionCard = React.memo(PositionCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    // 세로 스택: [이름+상태칩] / [손익칩] / [메타] 사이 일정 간격.
    gap: spacing.sm,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: ACCENT_BAR_WIDTH,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    // 가용폭을 차지해 상태칩·셰브런을 우측에 고정하고 긴 종목명은 한 줄 말줄임.
    flex: 1,
  },
  statusChip: {
    // DAR-298: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 24,
  },
  pnlChip: {
    // 내용폭만 차지하도록 좌측 정렬(블록 전체로 늘어나지 않게).
    alignSelf: 'flex-start',
  },
});
