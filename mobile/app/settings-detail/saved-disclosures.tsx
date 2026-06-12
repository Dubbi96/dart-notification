import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import {
  useSavedDisclosures,
  useRemoveSavedDisclosure,
  useSaveDisclosure,
} from '@hooks/useSavedDisclosures';
import { useHaptics } from '@hooks/useHaptics';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';

interface SavedDisclosureItem {
  id: string;
  rcpNo: string;
  reportName: string;
  corpName: string;
  rcpDt: string;
  disclosureType: string;
}

export default function SavedDisclosuresScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const { showSnackbar } = useSnackbar();
  const haptics = useHaptics();
  const { data, isLoading, isError, error, refetch } = useSavedDisclosures();
  const removeMutation = useRemoveSavedDisclosure();
  const saveMutation = useSaveDisclosure();

  const items = data?.data ?? [];

  // 해제는 즉시 mutate하되, SearchOverlay 워치리스트 패턴과 동일하게 '실행 취소'(rcpNo 재저장) 동선 제공.
  const handleRemove = useCallback(
    (id: string, rcpNo: string) => {
      removeMutation.mutate(id);
      haptics.light();
      showSnackbar(snackbarCopy.disclosureUnsaved, {
        duration: SNACKBAR_DURATION.success,
        action: { label: '실행 취소', onPress: () => saveMutation.mutate(rcpNo) },
      });
    },
    [removeMutation, saveMutation, haptics, showSnackbar],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedDisclosureItem }) => {
    const typeStyle = getTypeStyle(item.disclosureType, isDark);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push(`/disclosure/${item.rcpNo}`)}
      >
        <Card style={styles.card} variant="elevated">
          <View style={styles.cardHeader}>
            <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
              <Text style={[typo.small, { color: typeStyle.text, fontWeight: '600' }]}>
                {getTypeLabel(item.disclosureType)}
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => handleRemove(item.id, item.rcpNo)}
            >
              <Ionicons name="bookmark" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text
            style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]}
            numberOfLines={2}
          >
            {item.reportName}
          </Text>
          <View style={styles.cardFooter}>
            <Text style={[typo.caption, { color: colors.textSecondary }]}>
              {item.corpName}
            </Text>
            <Text style={[typo.caption, { color: colors.textTertiary }]}>
              {format(parse(item.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')}
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
    },
    [colors, typo, isDark, handleRemove],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, marginLeft: spacing.sm }]}>저장된 공시</Text>
        <View style={{ flex: 1 }} />
        {!isLoading && !isError ? (
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            {items.length}건
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        // 장애를 '저장 0건' 빈 상태로 위장하지 않도록 에러는 명시 분기 + 재시도 동선 제공.
        <ApiErrorState
          error={error}
          onRetry={refetch}
          title="저장된 공시를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          ListEmptyComponent={<EmptyState {...emptyStateCopy.savedDisclosuresEmpty} />}
        />
      )}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  card: {
    marginBottom: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
});
