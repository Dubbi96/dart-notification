import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { useAddToWatchlist } from '@hooks/useWatchlist';

const POPULAR_COMPANIES = [
  { id: '1', name: '삼성전자', code: '005930' },
  { id: '2', name: 'SK하이닉스', code: '000660' },
  { id: '3', name: '네이버', code: '035420' },
  { id: '4', name: '카카오', code: '035720' },
  { id: '5', name: 'LG에너지솔루션', code: '373220' },
  { id: '6', name: '삼성SDI', code: '006400' },
  { id: '7', name: '현대자동차', code: '005380' },
  { id: '8', name: '셀트리온', code: '068270' },
];

export default function OnboardingScreen() {
  const { colors, typography: typo } = useTheme();
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addToWatchlist = useAddToWatchlist();

  const toggleCompany = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const handleContinue = async () => {
    setIsSubmitting(true);
    try {
      const selectedCompanies = POPULAR_COMPANIES.filter((c) => selected.includes(c.id));
      for (const company of selectedCompanies) {
        addToWatchlist.mutate({ corpCode: company.code, corpName: company.name });
      }
      router.replace('/(tabs)/home');
    } catch {
      router.replace('/(tabs)/home');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>1단계 / 2</Text>
        </View>

        <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
          관심 기업을{'\n'}등록하세요
        </Text>
        <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          공시 알림을 받으려면 최소 1개 기업을 선택하세요
        </Text>

        <FlatList
          data={POPULAR_COMPANIES}
          keyExtractor={(item) => item.id}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.id);
            return (
              <TouchableOpacity
                style={[
                  styles.companyItem,
                  {
                    backgroundColor: isSelected ? colors.primaryLight : colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => toggleCompany(item.id)}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>{item.code}</Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <View style={styles.footer}>
        <Text style={[typo.caption, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md }]}>
          {selected.length}개 선택됨
        </Text>
        <Button
          title="계속하기"
          onPress={handleContinue}
          fullWidth
          size="lg"
          disabled={selected.length === 0}
          loading={isSubmitting}
        />
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => router.replace('/(tabs)/home')}
        >
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>나중에 하기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  stepIndicator: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  list: {
    marginTop: spacing.xl,
  },
  companyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  skipButton: {
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
});
