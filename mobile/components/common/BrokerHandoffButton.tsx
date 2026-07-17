import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import {
  BROKER_APPS,
  BROKER_HANDOFF_DISCLOSURE,
  BROKER_HANDOFF_TITLE,
  openBrokerApp,
  type BrokerApp,
} from '@utils/brokerHandoff';

// DAR-545: '증권사 앱에서 열기' 트리거 버튼 + 브로커 선택 바텀시트(재사용).
// 신호 상세·종목 상세가 동일한 UI/핸드오프 로직을 공유하도록 SSOT 컴포넌트로 뽑는다.
// 시트는 RN 코어 Modal(presentationStyle="pageSheet") — InfoSheet 패턴 재사용(크로스플랫폼 안전,
// 커스텀 래퍼 없음). 브로커는 대표 3사 정적 목록이라 map 렌더(장문 리스트 아님 → FlatList 불요).

interface BrokerHandoffButtonProps {
  /** 접근성 라벨에 섞을 컨텍스트(예: 종목명) — 선택. */
  contextLabel?: string;
}

interface BrokerRowProps {
  broker: BrokerApp;
  onSelect: (broker: BrokerApp) => void;
}

function BrokerRow({ broker, onSelect }: BrokerRowProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onSelect(broker), [broker, onSelect]);
  return (
    <TouchableOpacity
      onPress={handlePress}
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessibilityRole="button"
      // 정직: 라벨에 '설치돼 있지 않으면 앱스토어로 이동'을 명시해 스크린리더 사용자도 폴백을 안다.
      accessibilityLabel={`${broker.name} 앱 열기. 설치돼 있지 않으면 앱스토어로 이동합니다.`}
    >
      <Feather name="smartphone" size={sizing.icon.sm} color={colors.primary} />
      <Text style={[typo.body, { color: colors.text, flex: 1 }]}>{broker.name}</Text>
      <Feather name="external-link" size={sizing.icon.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

export function BrokerHandoffButton({ contextLabel }: BrokerHandoffButtonProps) {
  const { colors, typography: typo } = useTheme();
  const [visible, setVisible] = useState(false);

  const openSheet = useCallback(() => setVisible(true), []);
  const closeSheet = useCallback(() => setVisible(false), []);

  const handleSelect = useCallback((broker: BrokerApp) => {
    // 시트를 먼저 닫고 링크아웃 — 앱 전환 후 복귀 시 시트가 열린 채 남지 않게.
    setVisible(false);
    void openBrokerApp(broker);
  }, []);

  return (
    <>
      <TouchableOpacity
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={
          contextLabel ? `${contextLabel} — ${BROKER_HANDOFF_TITLE}` : BROKER_HANDOFF_TITLE
        }
        style={[styles.trigger, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
      >
        <Feather name="external-link" size={sizing.icon.sm} color={colors.primary} />
        <Text style={[typo.body, { color: colors.text, flex: 1 }]}>{BROKER_HANDOFF_TITLE}</Text>
        <Feather name="chevron-right" size={sizing.icon.md} color={colors.textTertiary} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSheet}
      >
        <SafeAreaView
          style={[styles.sheet, { backgroundColor: colors.background }]}
          edges={['top']}
        >
          <View style={styles.header}>
            <Text style={[typo.h3, { color: colors.text, flex: 1 }]} accessibilityRole="header">
              {BROKER_HANDOFF_TITLE}
            </Text>
            <TouchableOpacity
              onPress={closeSheet}
              style={styles.closeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <Feather name="x" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {BROKER_APPS.map((broker) => (
              <BrokerRow key={broker.id} broker={broker} onSelect={handleSelect} />
            ))}

            <View style={[styles.disclosure, { borderTopColor: colors.border }]} accessible>
              <Feather name="info" size={13} color={colors.textTertiary} />
              <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]}>
                {BROKER_HANDOFF_DISCLOSURE}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  sheet: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  closeBtn: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
