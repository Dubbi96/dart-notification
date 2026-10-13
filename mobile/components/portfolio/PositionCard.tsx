import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { thesisStatusColor, positionSystemAction, formatPnlPercent } from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

// 포지션 카드(기획 §3 SCR-PORTFOLIO). 손익률 색상 + 시스템 자동 동작 배지.
// VIOLATED/EXPIRED 정렬 우선순위는 화면(리스트)에서 처리한다.
//
// 세로 스택([이름]/[상태]/[손익칩]/[수량·평단])으로 긴 이름·큰 글씨에서도 값을 보존한다.
//  ① 좌측 엣지 솔리드 컬러바(코드에디터 에러마커식) — 다종목 세로 스캔 시 '빨간 막대 있나?'만 보면
//     위험 종목을 즉시 식별. 자동 매도 예정(하드룰 손절)·비정상 상태=경고색, 정상(ACTIVE)=중립.
//  ② 상태칩이 행동 지시를 흡수 → 별도 경고 행 제거(간결).
//
// DAR-368: 모의투자는 **시스템 트레이딩 현황**이다 — 상태칩을 자동 동작 언어로 표기한다.
//  · 하드룰 손절·청산(EXIT) = '자동 매도 예정'(경고 표면 + 자동 실행 아이콘 zap). 시스템이 다음
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

  // 경고 의미는 색상 표면·엣지로 유지하고, 상태 텍스트는 읽기 쉬운 본문 대비를 사용한다.
  const chipBg = isAutoSell ? colors.errorSurface : colors.surfaceSecondary;

  // 수량·평단은 각각 자연 높이로 표시해 큰 글씨에서도 금융 숫자를 말줄임하지 않는다.
  const metaParts: string[] = [];
  if (position.quantity !== undefined) {
    metaParts.push(`${position.quantity.toLocaleString('ko-KR')}주`);
  }
  if (position.avgPrice !== undefined) {
    metaParts.push(`평단 ${position.avgPrice.toLocaleString('ko-KR')}원`);
  }

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
          <Text style={[typo.bodyMedium, styles.name, { color: colors.text }]}>
            {position.corpName}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </View>

        <View style={[styles.statusChip, { backgroundColor: chipBg }]}>
          {isAutoSell || isMonitoring ? (
            <Feather name={isAutoSell ? 'zap' : 'activity'} size={16} color={statusColor} />
          ) : null}
          <Text style={[typo.captionMedium, styles.statusText, { color: colors.text }]}>
            {action.label}
          </Text>
        </View>

        {/* 손익률 칩(§12) — 색조(이익/손실)+부호+화살표 병행. 좌측 정렬(내용폭만 차지) (DAR-357). */}
        {/* 카드 전체가 상세 진입 버튼이므로 내부에 별도 버튼을 중첩하지 않는다. */}
        <PriceChangeChip
          value={position.pnlPercent}
          context="pnl"
          disableInfo
          style={styles.pnlChip}
        />

        {metaParts.map((part) => (
          <Text key={part} style={[typo.caption, { color: colors.textSecondary }]}>
            {part}
          </Text>
        ))}

        {/* DAR-368: 하드룰 손절은 Engine5가 자동 체결 — 수동 매도 불필요임을 정직하게 고지(예정 상태). */}
        {isAutoSell ? (
          <Text style={[typo.caption, { color: colors.text }]}>
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
    // 세로 스택: [이름] / [상태] / [손익칩] / [수량·평단] 사이 일정 간격.
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
    // 회사명은 셰브런만 남긴 한 행의 가용폭을 사용하고 자연스럽게 줄바꿈한다.
    flex: 1,
    minWidth: 0,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusText: {
    flexShrink: 1,
    fontWeight: '700',
  },
  pnlChip: {
    // 내용폭만 차지하도록 좌측 정렬(블록 전체로 늘어나지 않게).
    alignSelf: 'flex-start',
  },
});
