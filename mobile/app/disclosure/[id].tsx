import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Share,
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
import { useCheckSaved, useSaveDisclosure, useUnsaveDisclosure } from '@hooks/useSavedDisclosures';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { parse, format } from 'date-fns';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';

export default function DisclosureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const { data: disclosure, isLoading } = useDisclosureDetail(id!);
  const { data: isSaved, refetch: refetchSaved } = useCheckSaved(id!, { enabled: isAuthenticated });
  const saveMutation = useSaveDisclosure();
  const removeMutation = useUnsaveDisclosure();

  const handleToggleSave = async () => {
    if (!disclosure) return;
    if (!requireAuth()) return;

    if (isSaved) {
      // 저장 해제: 먼저 savedDisclosure id를 가져와야 함
      // checkSaved만으로는 id를 모르므로, save/remove를 rcpNo 기반으로 처리
      await removeMutation.mutateAsync(disclosure.rcpNo);
    } else {
      await saveMutation.mutateAsync(disclosure.rcpNo);
    }
    refetchSaved();
  };

  if (isLoading || !disclosure) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
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
    { label: '기업명', value: disclosure.corpName, onPress: () => router.push(`/company/${disclosure.corpCode}`) },
    { label: '종목코드', value: disclosure.corpCode },
    { label: '공시유형', value: getTypeLabel(disclosure.disclosureType) },
    { label: '접수번호', value: disclosure.rcpNo },
    { label: '접수일시', value: format(parse(disclosure.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd') },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          공시 상세
        </Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleToggleSave}
          disabled={saveMutation.isPending || removeMutation.isPending}
        >
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={24}
            color={isSaved ? colors.primary : colors.text}
          />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Type Badge */}
        <View style={[styles.typeBadge, { backgroundColor: getTypeStyle(disclosure.disclosureType, isDark).bg }]}>
          <Text style={[typo.captionMedium, { color: getTypeStyle(disclosure.disclosureType, isDark).text }]}>
            {getTypeLabel(disclosure.disclosureType)}
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
            <TouchableOpacity
              key={row.label}
              style={[
                styles.infoRow,
                index < infoRows.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.borderLight,
                },
              ]}
              activeOpacity={row.onPress ? 0.7 : 1}
              onPress={row.onPress}
              disabled={!row.onPress}
            >
              <Text style={[typo.caption, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[typo.captionMedium, { color: row.onPress ? colors.primary : colors.text }]}>
                {row.value}
                {row.onPress ? ' ›' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </Card>

        {/* Action Buttons */}
        <Button
          title="원문 보기"
          onPress={() => {
            router.push({
              pathname: '/disclosure/viewer',
              params: { rcpNo: disclosure.rcpNo, title: disclosure.reportName },
            });
          }}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.xl }}
        />

        <Button
          title="공유"
          onPress={() => {
            const url = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${disclosure.rcpNo}`;
            Share.share({
              message: `${disclosure.reportName} - ${disclosure.corpName}\n${url}`,
              url,
            });
          }}
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
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
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
