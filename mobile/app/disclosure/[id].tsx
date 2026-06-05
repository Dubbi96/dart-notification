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
import { Surface, Chip } from 'react-native-paper';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { parse, format } from 'date-fns';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { Button } from '@components/common/Button';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useDisclosureDetail, useDisclosureEvent } from '@hooks/useDisclosures';
import { useCheckSaved, useSaveDisclosure, useUnsaveDisclosure } from '@hooks/useSavedDisclosures';
import { useRequireAuth } from '@hooks/useRequireAuth';
import {
  getTypeStyle,
  getTypeLabel,
  getEventTypeLabel,
  getPolarityLabel,
} from '@utils/disclosureType';

// 극성/이벤트 평문 매핑은 utils/disclosureType.ts(단일 출처)로 통합 — raw enum 단독 노출 금지(P0-B).

function polarityColor(polarity: string, colors: { success: string; error: string; textSecondary: string }): string {
  if (polarity === 'POSITIVE') return colors.success;
  if (polarity === 'NEGATIVE') return colors.error;
  return colors.textSecondary;
}

export default function DisclosureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const { showSnackbar } = useSnackbar();
  const { data: disclosure, isLoading } = useDisclosureDetail(id!);
  const { data: disclosureEvent } = useDisclosureEvent(id!);
  const { data: isSaved, refetch: refetchSaved } = useCheckSaved(id!, { enabled: isAuthenticated });
  const saveMutation = useSaveDisclosure();
  const removeMutation = useUnsaveDisclosure();

  const handleToggleSave = async () => {
    if (!disclosure) return;
    if (!requireAuth()) return;

    const wasSaved = isSaved;
    try {
      if (wasSaved) {
        await removeMutation.mutateAsync(disclosure.rcpNo);
        showSnackbar(snackbarCopy.disclosureUnsaved, { duration: SNACKBAR_DURATION.success });
      } else {
        await saveMutation.mutateAsync(disclosure.rcpNo);
        showSnackbar(snackbarCopy.disclosureSaved, {
          duration: SNACKBAR_DURATION.success,
          action: { label: '저장된 공시 보기', onPress: () => router.push('/settings-detail/saved-disclosures') },
        });
      }
      refetchSaved();
    } catch {
      showSnackbar(snackbarCopy.disclosureSaveFailed, { duration: SNACKBAR_DURATION.error });
    }
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

        {/* AI 분석 섹션 — GET /disclosure-events/:rcpNo 실연동 (기획 §3 SCR-DISCLOSURE-AI) */}
        {disclosureEvent ? (
          <Surface
            elevation={0}
            style={[styles.aiSection, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {/* 섹션 헤더 */}
            <View style={styles.aiHeader}>
              <View style={styles.aiTitleRow}>
                <Feather name="cpu" size={16} color={colors.primary} />
                <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
                  AI 분석 결과
                </Text>
              </View>
              <AiReferenceLabel />
            </View>

            {/* 이벤트 분류 */}
            <View style={[styles.aiRow, { marginTop: spacing.sm }]}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>이벤트 유형</Text>
              <Chip
                compact
                mode="flat"
                style={[styles.aiChip, { backgroundColor: colors.surfaceSecondary }]}
                textStyle={[typo.small, { color: colors.text }]}
              >
                {getEventTypeLabel(disclosureEvent.eventType)}
              </Chip>
            </View>

            {/* 이벤트 방향 (긍/부정) */}
            <View style={styles.aiRow}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>이벤트 극성</Text>
              <View style={styles.polarityRow}>
                <Feather
                  name={disclosureEvent.polarity === 'POSITIVE' ? 'trending-up' : disclosureEvent.polarity === 'NEGATIVE' ? 'trending-down' : 'minus'}
                  size={14}
                  color={polarityColor(disclosureEvent.polarity, colors)}
                />
                <Text style={[typo.captionMedium, { color: polarityColor(disclosureEvent.polarity, colors), marginLeft: spacing.xs }]}>
                  {getPolarityLabel(disclosureEvent.polarity)}
                </Text>
              </View>
            </View>

            {/* AI 신뢰도 */}
            {disclosureEvent.isAiAssisted ? (
              <View style={styles.aiRow}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>AI 신뢰도</Text>
                <Text style={[typo.captionMedium, { color: colors.text }]}>
                  {Math.round(disclosureEvent.confidence * 100)}%
                </Text>
              </View>
            ) : null}

            {/* 면책 문구 (인라인) — 기획 §5 공시 상세 AI 섹션 위치 */}
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
              AI 분석은 참고 정보이며 투자 결정의 책임은 투자자 본인에게 있습니다.
            </Text>
          </Surface>
        ) : null}

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

        {/* DisclaimerSection — disclosure에 AI 분석이 있을 때만 표시 */}
        {disclosureEvent ? <DisclaimerSection style={styles.disclaimer} /> : null}
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
  aiSection: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiChip: {
    height: 24,
  },
  polarityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
