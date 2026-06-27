import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip } from 'react-native-paper';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { Button } from '@components/common/Button';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ProvenanceBar, relativeTime, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import { DisclosureAiAnalysisSection } from '@components/disclosure/DisclosureAiAnalysisSection';
import { DisclosureSignalLink } from '@components/disclosure/DisclosureSignalLink';
import { DisclosureFiledFactsSection } from '@components/disclosure/DisclosureFiledFactsSection';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useHaptics } from '@hooks/useHaptics';
import { useDisclosureDetail, useDisclosureEvent } from '@hooks/useDisclosures';
import { useCheckSaved, useSaveDisclosure, useUnsaveDisclosure } from '@hooks/useSavedDisclosures';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { isOfflineMutationBlockedError } from '@utils/offlineMutation';
import {
  getTypeStyle,
  getTypeLabel,
  getEventTypeLabel,
  getPolarityLabel,
} from '@utils/disclosureType';
import { extractKeyFigures } from '@utils/keyFigures';
import { formatYmdDots } from '@utils/datetime';

// 극성/이벤트 평문 매핑은 utils/disclosureType.ts(단일 출처)로 통합 — raw enum 단독 노출 금지(P0-B).

/** 공시 상세 정보 행 — onPress 없는 행도 허용(종목코드/고유번호 등 비대화형 행). */
type InfoRow = { label: string; value: string; onPress?: () => void };

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

  // E8(DAR-453): 인지 과부하 완화 — 'AI 이벤트 분류'(구조 지표)는 기본 펼침으로 즉시 노출.
  //   가장 무거운 'AI 심층 분석'은 자체 컴포넌트에서 기본 접힘 처리(밀도 완화).
  const [eventExpanded, setEventExpanded] = React.useState(true);

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
    } catch (e) {
      // DAR-226: 오프라인 차단은 가드가 이미 안내 스낵바를 띄웠으므로 일반 '실패' 메시지로 덮지 않는다.
      if (isOfflineMutationBlockedError(e)) return;
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
    } catch (e) {
      // DAR-226: 오프라인 차단은 가드 스낵바로 안내됨 — 일반 '실패' 메시지로 덮지 않는다.
      if (isOfflineMutationBlockedError(e)) return;
      showSnackbar(snackbarCopy.disclosureSaveFailed, { duration: SNACKBAR_DURATION.error });
    }
  };

  // 로딩/에러/빈 상태는 헤더를 유지한 채 분기 — 에러 시 무한 스피너·강제 이탈 대신 재시도 동선 제공.
  if (isLoading || isError || !disclosure) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
          >
            <Ionicons name="chevron-back" size={sizing.icon.lg} color={colors.text} />
          </TouchableOpacity>
          <Text
            style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}
            accessibilityRole="header"
          >
            공시 상세
          </Text>
          <View style={styles.headerButton} />
        </View>
        {isLoading ? (
          // DAR-147 정렬: 중앙 스피너 대신 상세 레이아웃 매칭 스켈레톤(배지·제목 / 정보 카드 / AI 분석).
          <DetailSkeleton
            cards={[{ chip: true, lines: 2 }, { lines: 5 }, { chip: true, lines: 4 }]}
          />
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

  // DAR-188: "종목코드"는 HTS/증권앱에서 쓰는 6자리 stockCode여야 한다.
  //   과거엔 corpCode(8자리 DART 고유번호)를 잘못 바인딩해 종목상세(005930)와 불일치.
  //   상장사는 6자리 stockCode를 노출하고, 비상장·미연동 공시는 라벨을 "고유번호"로
  //   정직하게 정정해 corpCode를 표기(가짜 종목코드 노출 금지).
  const stockCodeRow: InfoRow = disclosure.stockCode
    ? { label: '종목코드', value: disclosure.stockCode }
    : { label: '고유번호', value: disclosure.corpCode };
  const infoRows: InfoRow[] = [
    { label: '기업명', value: disclosure.corpName, onPress: () => router.push(`/company/${disclosure.corpCode}`) },
    stockCodeRow,
    { label: '공시유형', value: getTypeLabel(disclosure.disclosureType) },
    { label: '접수번호', value: disclosure.rcpNo },
    { label: '접수일시', value: formatYmdDots(disclosure.rcpDt) },
  ];

  // 이벤트 추출 핵심 수치(DAR-46 §3) — 화이트리스트 키만 평문 라벨·단위로 노출.
  const keyFigures = extractKeyFigures(disclosureEvent?.extractedData);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Ionicons name="chevron-back" size={sizing.icon.lg} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}
          accessibilityRole="header"
        >
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
              <Text style={[typo.caption, styles.infoLabel, { color: colors.textSecondary }]}>{row.label}</Text>
              {/* DAR-305: 큰 글꼴서 긴 값(기업명 등)이 우측 ›를 화면 밖으로 밀지 않도록 값만 한 줄 말줄임, ›는 분리해 유지. */}
              <View style={styles.infoValueWrap}>
                <Text
                  style={[typo.captionMedium, styles.infoValue, { color: row.onPress ? colors.primary : colors.text }]}
                  numberOfLines={1}
                >
                  {row.value}
                </Text>
                {row.onPress ? (
                  <Text style={[typo.captionMedium, styles.infoChevron, { color: colors.primary }]}>{' ›'}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </Card>

        {/* 본문 핵심 수치 — E8(DAR-453) 우선순위 재배치: 원문에서 추출한 '사실' 정량값을
            AI 해석보다 먼저 노출(핵심 우선). DAR-95 적재 정량 fact 실연동(DAR-112, 패널 v5 #8). */}
        <DisclosureFiledFactsSection rcpNo={disclosure.rcpNo} />

        {/* AI 이벤트 분류 — GET /disclosure-events/:rcpNo 실연동 (기획 §3 SCR-DISCLOSURE-AI).
            E8(DAR-453): '심층 분석'과 외형 혼동 차단 위해 tag 아이콘·'분류' 라벨로 차별화 + 접이식. */}
        {disclosureEvent ? (
          <Surface
            elevation={0}
            style={[styles.aiSection, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {/* 섹션 헤더 — 탭하여 접기/펼치기(밀도 완화). 'AI 심층 분석'(cpu)과 다른 tag 아이콘으로 구분. */}
            <TouchableOpacity
              style={styles.aiHeader}
              activeOpacity={0.7}
              onPress={() => setEventExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: eventExpanded }}
              accessibilityLabel={`AI 이벤트 분류, ${eventExpanded ? '펼침' : '접힘'}`}
            >
              <View style={styles.aiTitleRow}>
                <Feather name="tag" size={sizing.icon.sm} color={colors.primary} />
                <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
                  AI 이벤트 분류
                </Text>
              </View>
              <View style={styles.aiHeaderRight}>
                <AiReferenceLabel />
                <Feather
                  name={eventExpanded ? 'chevron-up' : 'chevron-down'}
                  size={sizing.icon.md}
                  color={colors.textTertiary}
                  style={styles.aiChevron}
                />
              </View>
            </TouchableOpacity>

            {eventExpanded ? (
              <>
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
                // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
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
              </>
            ) : null}
          </Surface>
        ) : null}

        {/* AI 심층 분석(Engine2) — 요약·Persona 해석·Position Thesis 실연동 (DAR-102).
            E8(DAR-453): 가장 무거운 섹션 → 기본 접힘(접이식)으로 밀도 완화. */}
        <DisclosureAiAnalysisSection rcpNo={disclosure.rcpNo} />

        {/* 공시 → 매수 신호 역링크(DAR-208) — 그 공시로 생성된 신호가 있을 때만 진입 카드 노출.
            게스트(미인증)는 신호 API 401이므로 호출 자체를 막는다. */}
        <DisclosureSignalLink rcpNo={disclosure.rcpNo} enabled={isAuthenticated} />

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
    // E9(DAR-453): 탭 가능한 기업명 행이 ≈42pt(<44)였음 → 최소 터치 영역 보장(비대화형 행도 동일 높이로 정렬).
    minHeight: sizing.minTouchTarget,
  },
  // DAR-305: 라벨은 고정폭 유지, 값 묶음은 줄어들며 우측 정렬·말줄임(큰 글꼴 오버플로 방지). 평시 동일.
  infoLabel: {
    flexShrink: 0,
  },
  infoValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  infoValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  infoChevron: {
    flexShrink: 0,
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
    // E8(DAR-453): 접기/펼치기 토글 버튼 — 최소 터치 영역 보장.
    minHeight: sizing.minTouchTarget,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiChevron: {
    marginLeft: spacing.xs,
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
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 24,
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
