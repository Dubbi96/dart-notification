import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';

// DAR-108(#9): 주문 화면 정직 표기 컴포넌트.
// 실주문(자동매매)은 로드맵 마지막 단계(M11·M12)이며 아직 도입 전이다.
// 안전 설계 원칙 3 — "자동매매는 마지막 단계다(백테스트·모의투자 통과 전략만 제한적 허용)" — 을
// UI 표면에 드러내고, 현재 제공되는 모의운용 동선으로 안내한다.
// ★실주문 기능을 추가하지 않는다 — 표기/안내(가드)만 담당한다.

export interface PaperTradingNoticeAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
}

interface PaperTradingNoticeProps {
  /** 화면별 보조 설명(예: '주문 이력은 모의운용 매매 성적표에서 확인하세요'). */
  description?: string;
  /** 모의운용 동선 버튼들. 첫 항목을 주 동선으로 노출. */
  actions: PaperTradingNoticeAction[];
}

export function PaperTradingNotice({ description, actions }: PaperTradingNoticeProps) {
  const { colors, typography: typo } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.primaryLight, borderColor: colors.border },
      ]}
      accessibilityLabel="실주문은 아직 제공하지 않으며 모의운용만 제공한다는 안내"
    >
      <View style={styles.headerRow}>
        <Feather name="shield" size={18} color={colors.primary} />
        <Text style={[typo.bodyMedium, styles.headerText, { color: colors.text }]}>
          M11·M12 실주문 도입 전 — 모의운용만 제공
        </Text>
      </View>

      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
        실주문(자동매매)은 안전 설계상 가장 마지막 단계입니다. 백테스트와 모의운용으로 전략을
        충분히 검증한 뒤(M11·M12)에야 제한적으로 도입하며, 지금은 모의운용만 제공합니다.
      </Text>

      {description ? (
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {description}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {actions.map((action, idx) => (
          <Button
            key={action.label}
            title={action.label}
            onPress={action.onPress}
            variant={action.variant ?? (idx === 0 ? 'primary' : 'outline')}
            size="sm"
            style={styles.actionButton}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
  actionButton: {
    flexGrow: 1,
  },
});
