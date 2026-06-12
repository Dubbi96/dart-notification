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
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ProvenanceBar, relativeTime, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import { DisclosureAiAnalysisSection } from '@components/disclosure/DisclosureAiAnalysisSection';
import { DisclosureFiledFactsSection } from '@components/disclosure/DisclosureFiledFactsSection';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useHaptics } from '@hooks/useHaptics';
import { useDisclosureDetail, useDisclosureEvent } from '@hooks/useDisclosures';
import { useCheckSaved, useSaveDisclosure, useUnsaveDisclosure } from '@hooks/useSavedDisclosures';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useRequireAuth } from '@hooks/useRequireAuth';
import {
  getTypeStyle,
  getTypeLabel,
  getEventTypeLabel,
  getPolarityLabel,
} from '@utils/disclosureType';
import { extractKeyFigures } from '@utils/keyFigures';

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
  const haptics = useHaptics();
  const { data: disclosure, isLoading, isError, error, refetch } = useDisclosureDetail(id!);
  const { data: disclosureEvent } = useDisclosureEvent(id!);
  const { data: isSaved, refetch: refetchSaved } = useCheckSaved(id!, { enabled: isAuthenticated });
  const saveMutation = useSaveDisclosure();
  const removeMutation = useUnsaveDisclosure();
  // 관심기업 토글(DAR-155) — 기업 상세까지 가지 않고 공시 상세에서 1탭 등록/해제. 서버 상태는 React Query 동기.
  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const watchlistItem = watchlistData?.data?.find((item) => item.corpCode === disclosure?.corpCode);
  const isWatched = !!watchlistItem;

  const handleToggleWatchlist = async () => {
    if (!disclosure) return;
    if (!requireAuth()) return;
    try {
      if (isWatched && watchlistItem) {
        await removeFromWatchlist.mutateAsync(watchlistItem.id);
        haptics.success();
        showSnackbar(snackbarCopy.watchlistRemoved(disclosure.corpName), {
          duration: SNACKBAR_DURATION.success,
        });
      } else {
        await addToWatchlist.mutateAsync({
          corpCode: disclosure.corpCode,
          corpName: disclosure.corpName,
        });
        haptics.success();
        showSnackbar(snackbarCopy.watchlistAdded(disclosure.corpName), {
          duration: SNACKBAR_DURATION.success,
        });
      }
    } catch {
      showSnackbar(snackbarCopy.watchlistAddFailed, { duration: SNACKBAR_DURATION.error });
    }
  };

  const handleToggleSave = async () => {
    if (!disclosure) return;
    if (!requireAuth()) return;

    const wasSaved = isSaved;
    try {
      if (wasSaved) {
        await removeMutation.mutateAsync(disclosure.rcpNo);
        haptics.light();
        showSnackbar(snackbarCopy.disclosureUnsaved, { duration: SNACKBAR_DURATION.success });
      } else {
        await saveMutation.mutateAsync(disclosure.rcpNo);
        haptics.success();
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

  // 로딩/에러/빈 상태는 헤더를 유지한 채 분기 — 에러 시 무한 스피너·강제 이탈 대신 재시도 동선 제공.
  if (isLoading || isError || !disclosure) {
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
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : isError ? (
          <ApiErrorState
            error={error}
            onRetry={refetch}
            title="공시를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
          />
        ) : (
          <EmptyState
            icon="file-text"
            title="공시를 찾을 수 없습니다"
            description="삭제되었거나 존재하지 않는 공시입니다."
          />
        )}
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

  // 이벤트 추출 핵심 수치(DAR-46 §3) — 화이트리스트 키만 평문 라벨·단위로 노출.
  const keyFigures = extractKeyFigures(disclosureEvent?.extractedData);

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
        <View style={styles.headerActions}>
          {/* 관심기업 토글(DAR-155) — 로그인 사용자에게만 노출, 게스트는 기존 헤더 유지 */}
          {isAuthenticated && disclosure.corpCode ? (
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={handleToggleWatchlist}
              disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
              accessibilityRole="button"
              accessibilityState={{ selected: isWatched }}
              accessibilityLabel={isWatched ? '관심기업 해제' : '관심기업 추가'}
            >
              <Ionicons
                name={isWatched ? 'star' : 'star-outline'}
                size={23}
                color={isWatched ? colors.primary : colors.text}
              />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={handleToggleSave}
            disabled={saveMutation.isPending || removeMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? '저장 해제' : '공시 저장'}
          >
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={isSaved ? colors.primary : colors.text}
            />
          </TouchableOpacity>
        </View>
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

            {/* 출처·시점 바(§7) — AI 분석이 언제 생성됐는지 상시 노출 */}
            {disclosureEvent.extractedAt ? (
              <ProvenanceBar
                items={
                  [
                    { icon: 'clock', label: `분석 ${relativeTime(disclosureEvent.extractedAt)}` },
                  ] as ProvenanceItem[]
                }
              />
            ) : null}

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

            {/* 신뢰도(DAR-56) — 맨퍼센트 금지: 3단계 평문 + 'AI 자기보고 한계' 주석.
                isAiAssisted=false면 '규칙 분류'로 표기(과신 차단). */}
            <View style={styles.aiRowTop}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>신뢰도</Text>
              <EvidenceMeta
                ai={{
                  confidence: disclosureEvent.confidence,
                  isAiAssisted: disclosureEvent.isAiAssisted,
                }}
              />
            </View>

            {/* 핵심 수치(DAR-46 §3) — 추출된 이벤트 수치를 평문 라벨·단위로 통합 표시 */}
            {keyFigures.length > 0 ? (
              <View style={styles.keyFigures}>
                <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                  핵심 수치
                </Text>
                {keyFigures.map((fig) => (
                  <View key={fig.key} style={styles.aiRow}>
                    <Text style={[typo.small, { color: colors.textSecondary }]}>{fig.label}</Text>
                    <Text style={[typo.captionMedium, { color: colors.text }]}>{fig.display}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 면책 문구 (인라인) — 기획 §5 공시 상세 AI 섹션 위치 */}
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
              AI 분석은 참고 정보이며 투자 결정의 책임은 투자자 본인에게 있습니다.
            </Text>
          </Surface>
        ) : null}

        {/* 본문 핵심 수치 — DAR-95 적재 정량 fact 실연동 (DAR-112, 패널 v5 #8) */}
        <DisclosureFiledFactsSection rcpNo={disclosure.rcpNo} />

        {/* AI 심층 분석(Engine2) — 요약·Persona 해석·Position Thesis 실연동 (DAR-102) */}
        <DisclosureAiAnalysisSection rcpNo={disclosure.rcpNo} />

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
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
  aiRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  aiChip: {
    height: 24,
  },
  keyFigures: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  polarityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
