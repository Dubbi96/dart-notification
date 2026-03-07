import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { Button } from '@components/common/Button';
import { useDisclosureDetail } from '@hooks/useDisclosures';

export default function DisclosureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, typography: typo } = useTheme();
  const { data: disclosure, isLoading } = useDisclosureDetail(id!);

  if (isLoading || !disclosure) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
            공시 상세
          </Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const infoRows = [
    { label: '기업명', value: disclosure.corpName },
    { label: '종목코드', value: disclosure.corpCode },
    { label: '공시유형', value: disclosure.disclosureType },
    { label: '접수번호', value: disclosure.rcpNo },
    { label: '접수일시', value: disclosure.rcpDt },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          공시 상세
        </Text>
        <TouchableOpacity style={styles.headerButton}>
          <Ionicons name="bookmark-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Type Badge */}
        <View style={[styles.typeBadge, { backgroundColor: colors.primaryLight }]}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>
            {disclosure.disclosureType}
          </Text>
        </View>

        {/* Title */}
        <Text style={[typo.h2, { color: colors.text, marginTop: spacing.md }]}>
          {disclosure.reportName}
        </Text>
        <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {disclosure.corpName}
        </Text>

        {/* Info Card */}
        <Card style={styles.infoCard} variant="elevated">
          {infoRows.map((row, index) => (
            <View
              key={row.label}
              style={[
                styles.infoRow,
                index < infoRows.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.borderLight,
                },
              ]}
            >
              <Text style={[typo.caption, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[typo.captionMedium, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}
        </Card>

        {/* Action Buttons */}
        <Button
          title="DART에서 보기"
          onPress={() => {
            if (disclosure.dartUrl) {
              Linking.openURL(disclosure.dartUrl);
            }
          }}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.xl }}
        />

        <Button
          title="공유"
          onPress={() => {}}
          variant="outline"
          fullWidth
          size="lg"
          style={{ marginTop: spacing.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  infoCard: {
    marginTop: spacing.xl,
    padding: 0,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
});
