import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE, type ThemeColors } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { RiskStatusBadges, summarizeRiskStatus } from '@components/common/RiskStatusBadges';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import {
  exitActionColor,
  exitActionLabel,
  pnlColor,
  formatPnlPercent,
} from '@utils/signalDisplay';

import type { ExitSignal, ExitReason } from '@app-types/signal.types';

// 매도 신호 카드(기획 §3 SCR-SIGNALS-EXIT).
// 매도 근거 kind별 아이콘 색상 매핑 + 권장 액션 배지 + 손익률.

interface ExitScoreCardProps {
  signal: ExitSignal;
  onPress?: (signal: ExitSignal) => void;
}

function reasonColor(kind: ExitReason['kind'], colors: ThemeColors): string {
  switch (kind) {
    case 'loss':
    case 'thesis':
      return colors.error;
    case 'chart':
      return colors.warning;
    case 'time':
      return colors.textSecondary;
  }
}

// 색맹·스크린리더 대응(§8-2/§8-4): 매도 근거 종류를 색 대신 텍스트로도 읽게 한다
function reasonKindLabel(kind: ExitReason['kind']): string {
  switch (kind) {
    case 'loss':
      return '손실';
    case 'thesis':
      return '논거 훼손';
    case 'chart':
      return '차트';
    case 'time':
      return '시간';
  }
}

function ExitScoreCardBase({ signal, onPress }: ExitScoreCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);
  // DAR-99: 관리종목·거래정지·상폐위험 배지(DART 폴백·근사값). 손실 회피 1차 방어선.
  const { data: riskStatus } = useStockRiskStatus({ corpCode: signal.corpCode });
  const riskSummary = summarizeRiskStatus(riskStatus);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      // 카드 그룹핑(§8-1/§8-4): 카드를 단일 단위로 읽기. 위험상태는 카드 라벨에 합성한다.
      accessibilityLabel={`${signal.corpName} 매도 신호, Exit Score ${signal.exitScore}, ${exitActionLabel(
        signal.action,
      )}${riskSummary ? `, ${riskSummary}` : ''}`}
      accessibilityActions={[{ name: 'activate', label: '신호 상세 보기' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
      }}
    >
      <Surface
        elevation={2}
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.headerRow}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {signal.corpName}
          </Text>
          <Chip
            compact
            mode="flat"
            // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            style={[styles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: exitActionColor(signal.action, colors), fontWeight: '700' }]}
          >
            {exitActionLabel(signal.action)}
          </Chip>
        </View>

        {/* DAR-99: 위험 배지(위험 없으면 미표시) — 근사값(DART) 라벨 병기 */}
        <RiskStatusBadges status={riskStatus} compact style={styles.riskBadges} />

        <View style={styles.gaugeWrap}>
          <ScoreGauge
            score={signal.exitScore}
            kind="exit"
            statusText={exitActionLabel(signal.action)}
            accessibilityHidden
          />
        </View>

        {signal.reasons.length > 0 ? (
          <View style={styles.reasonList}>
            {signal.reasons.slice(0, 3).map((r) => (
              <View
                key={r.id}
                style={styles.reasonRow}
                accessibilityLabel={`매도 근거 ${reasonKindLabel(r.kind)}: ${r.label}`}
              >
                <Feather name="alert-circle" size={13} color={reasonColor(r.kind, colors)} />
                <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>{r.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {signal.recommendedAction ? (
          <View style={styles.recommendRow}>
            <Text style={[typo.small, { color: colors.textSecondary }]}>권장</Text>
            <Chip
              compact
              mode="flat"
              // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              style={[styles.recommendChip, { backgroundColor: colors.surfaceSecondary }]}
              textStyle={[typo.small, { color: colors.text }]}
            >
              {signal.recommendedAction}
            </Chip>
          </View>
        ) : null}

        {typeof signal.pnlPercent === 'number' ? (
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            현재 손익:{' '}
            <Text style={[typo.captionMedium, { color: pnlColor(signal.pnlPercent, colors) }]}>
              {formatPnlPercent(signal.pnlPercent)}
            </Text>
          </Text>
        ) : null}

        {signal.blockRebuy ? (
          <Banner visible actions={[]} style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, { color: colors.error }]}>
              재매수 차단됨 — 이 종목은 일정 기간 재진입이 차단됩니다.
            </Text>
          </Banner>
        ) : null}

        <View style={styles.footerRow}>
          <AiReferenceLabel />
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

// FlatList renderItem 자식 — 부모 리렌더 시 불필요한 리렌더 차단(DAR-128 성능 스윕).
export const ExitScoreCard = React.memo(ExitScoreCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
  },
  riskBadges: {
    marginTop: spacing.sm,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  reasonList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  recommendChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
  },
  banner: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
  footerRow: {
    marginTop: spacing.md,
  },
});
