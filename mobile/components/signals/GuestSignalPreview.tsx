import React from 'react';
import { ScrollView, Text, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button } from '@components/common/Button';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

interface GuestSignalPreviewProps {
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function GuestSignalPreview({ secondaryLabel, onSecondary }: GuestSignalPreviewProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.intro, { backgroundColor: colors.primaryLight }]}>
        <Feather name="compass" size={32} color={colors.primaryDark} />
        <Text style={[typo.h2, { color: colors.text }]}>조건을 먼저 확인하는 투자 계획</Text>
        <Text style={[typo.body, { color: colors.textSecondary }]}>공시와 종가를 바탕으로 조건을 확인하고, 조건이 맞을 때만 모의 가격 계획을 보여드려요.</Text>
      </View>
      <View style={styles.steps}>
        {[
          ['판단부터 읽기', '후보 종목을 보기 전에 진입 조건과 대기 이유를 확인해요.'],
          ['가격과 위험 함께 보기', '진입 구간, 손절 기준, 목표가를 한 계획으로 읽어요.'],
          ['근거는 필요할 때 펼치기', '공시 근거와 기기 계산 기록을 이어서 확인해요.'],
        ].map(([title, description], index) => (
          <View key={title} style={styles.row}>
            <Text style={[typo.captionMedium, { color: colors.primaryDark }]}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.flex}>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{title}</Text>
              <Text style={[typo.caption, styles.description, { color: colors.textSecondary }]}>{description}</Text>
            </View>
          </View>
        ))}
      </View>
      <Button title="로그인하고 판단 보기" onPress={() => router.push('/auth/sign-in')} fullWidth />
      {secondaryLabel && onSecondary ? <Button title={secondaryLabel} variant="ghost" onPress={onSecondary} fullWidth /> : null}
      <Text style={[typo.caption, { color: colors.textSecondary }]}>실계좌 자동매매는 아직 연결되지 않았어요. 로그인 없이 상단 ‘기기 점검’에서 합성 사례를 계산해 볼 수 있어요.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  intro: { padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg },
  steps: { gap: spacing.lg, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  description: { marginTop: spacing.xs },
});
