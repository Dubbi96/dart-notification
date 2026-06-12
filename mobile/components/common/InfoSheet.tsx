import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, sizing } from '@theme/spacing';

/**
 * 정보 공개(info disclosure) 시트 (DAR-175).
 *
 * 정적 배지·칩 위에 "이게 무슨 뜻인지"를 설명하는 표준 바텀시트. 손실 회피 방어선(위험 배지)이나
 * 등락 칩처럼 의미 파악이 중요한 컨트롤을 탭 가능한 버튼으로 만들고, 이 시트로 등급 정의·기준·근사값
 * 사유를 연결한다. RN 코어 Modal(presentationStyle="pageSheet")만 사용(SearchOverlay 패턴 재사용).
 */

export interface InfoSheetSection {
  /** 섹션 헤더 좌측 아이콘(선택). 색 단독 의미전달 금지 — 아이콘+텍스트 병행. */
  icon?: keyof typeof Feather.glyphMap;
  /** 아이콘 색(선택, 기본 textSecondary). */
  iconColor?: string;
  /** 섹션 제목. */
  heading: string;
  /** 섹션 본문 설명. */
  body: string;
}

interface InfoSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 시트 제목. */
  title: string;
  /** 본문 섹션 목록(등급 정의·의미 등). */
  sections: InfoSheetSection[];
  /** 하단 보조 각주(선택) — 출처·근사값 기준 등. */
  footnote?: string;
}

export function InfoSheet({ visible, onClose, title, sections, footnote }: InfoSheetProps) {
  const { colors, typography: typo } = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <View style={styles.header}>
          <Text style={[typo.h3, { color: colors.text, flex: 1 }]} accessibilityRole="header">
            {title}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="설명 닫기"
          >
            <Feather name="x" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {sections.map((s, idx) => (
            <View key={`${idx}-${s.heading}`} style={styles.section} accessible>
              <View style={styles.sectionHead}>
                {s.icon ? (
                  <Feather name={s.icon} size={16} color={s.iconColor ?? colors.textSecondary} />
                ) : null}
                <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]}>{s.heading}</Text>
              </View>
              <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                {s.body}
              </Text>
            </View>
          ))}

          {footnote ? (
            <View style={[styles.footnote, { borderTopColor: colors.border }]} accessible>
              <Feather name="info" size={13} color={colors.textTertiary} />
              <Text
                style={[
                  typo.small,
                  { color: colors.textTertiary, flex: 1, marginLeft: spacing.xs },
                ]}
              >
                {footnote}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
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
    paddingBottom: spacing['2xl'],
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
