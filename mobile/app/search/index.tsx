import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { parse, format } from 'date-fns';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useDebounce } from '@hooks/useDebounce';
import { useUnifiedSearch, shouldUnifiedSearch } from '@hooks/useUnifiedSearch';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';

import type { Company } from '@app-types/user.types';
import type { Disclosure } from '@app-types/disclosure.types';

type SearchRow =
  | { kind: 'sectionHeader'; key: string; label: string; count: number }
  | { kind: 'company'; key: string; company: Company }
  | { kind: 'disclosure'; key: string; disclosure: Disclosure };

function marketLabel(market: string | null): string {
  if (market === 'KOSPI') return '코스피';
  if (market === 'KOSDAQ') return '코스닥';
  return '';
}

function formatRcpDt(rcpDt: string): string {
  try {
    return format(parse(rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd');
  } catch {
    return rcpDt;
  }
}

export default function UnifiedSearchScreen() {
  const { colors, typography: typo, isDark } = useTheme();

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const debounced = useDebounce(query, 300);
  const term = debounced.trim();
  const searching = shouldUnifiedSearch(term);

  const { data, isLoading, isError, error, refetch } = useUnifiedSearch(searching ? term : '');

  // 기업·공시 결과를 섹션 헤더와 함께 단일 FlatList 데이터로 합성한다.
  const rows = useMemo<SearchRow[]>(() => {
    const companies = data?.companies.items ?? [];
    const disclosures = data?.disclosures.items ?? [];
    const out: SearchRow[] = [];
    if (companies.length > 0) {
      out.push({
        kind: 'sectionHeader',
        key: 'h-company',
        label: '기업',
        count: data?.companies.total ?? companies.length,
      });
      companies.forEach((c) =>
        out.push({ kind: 'company', key: `c-${c.corpCode}`, company: c }),
      );
    }
    if (disclosures.length > 0) {
      out.push({
        kind: 'sectionHeader',
        key: 'h-disclosure',
        label: '공시',
        count: data?.disclosures.total ?? disclosures.length,
      });
      disclosures.forEach((d) =>
        out.push({ kind: 'disclosure', key: `d-${d.rcpNo}`, disclosure: d }),
      );
    }
    return out;
  }, [data]);

  const openCompany = useCallback((corpCode: string) => {
    router.push(`/company/${corpCode}`);
  }, []);

  const openDisclosure = useCallback((rcpNo: string) => {
    router.push(`/disclosure/${rcpNo}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SearchRow }) => {
      if (item.kind === 'sectionHeader') {
        return (
          <View style={styles.sectionHeader}>
            <Text style={[typo.caption, { color: colors.textSecondary }]}>
              {item.label}
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary }]}>
              {item.count.toLocaleString()}건
            </Text>
          </View>
        );
      }

      if (item.kind === 'company') {
        const c = item.company;
        const mLabel = marketLabel(c.market);
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => openCompany(c.corpCode)}
            accessibilityRole="button"
            accessibilityLabel={`${c.corpName}${c.stockCode ? ` 종목코드 ${c.stockCode}` : ''}, 기업 상세 보기`}
            accessibilityHint="기업 상세 화면으로 이동합니다"
          >
            <Card style={styles.card} variant="elevated">
              <View style={styles.companyRow}>
                <View style={styles.companyInfo}>
                  <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
                    {c.corpName}
                  </Text>
                  {c.stockCode ? (
                    <Text style={[typo.small, styles.companyMeta, { color: colors.textTertiary }]}>
                      {c.stockCode}
                      {mLabel ? ` · ${mLabel}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={20} color={colors.textTertiary} />
              </View>
            </Card>
          </TouchableOpacity>
        );
      }

      const d = item.disclosure;
      const typeStyle = getTypeStyle(d.disclosureType, isDark);
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => openDisclosure(d.rcpNo)}
          accessibilityRole="button"
          accessibilityLabel={`${d.corpName} ${d.reportName}, 공시 상세 보기`}
          accessibilityHint="공시 상세 화면으로 이동합니다"
        >
          <Card style={styles.card} variant="elevated">
            <View style={styles.disclosureHeader}>
              <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
                <Text style={[typo.small, styles.typeBadgeText, { color: typeStyle.text }]}>
                  {getTypeLabel(d.disclosureType)}
                </Text>
              </View>
              <Text style={[typo.small, { color: colors.textTertiary }]}>
                {formatRcpDt(d.rcpDt)}
              </Text>
            </View>
            <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
              {d.reportName}
            </Text>
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              {d.corpName}
            </Text>
          </Card>
        </TouchableOpacity>
      );
    },
    [colors, typo, isDark, openCompany, openDisclosure],
  );

  const renderBody = () => {
    if (!searching) {
      return (
        <EmptyState
          icon="search"
          title="기업·공시 통합 검색"
          description="종목명·종목코드 또는 공시명을 2글자 이상 입력하세요."
        />
      );
    }
    if (isError) {
      return <ApiErrorState error={error} onRetry={() => refetch()} />;
    }
    if (isLoading) {
      return <SkeletonList variant="disclosure" count={6} />;
    }
    return (
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="검색 결과가 없습니다"
            description={`"${term}"에 대한 기업·공시를 찾지 못했어요. 종목코드 6자리나 공시명으로 다시 검색해 보세요.`}
          />
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, marginLeft: spacing.sm }]}>통합 검색</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: colors.inputBackground,
                borderColor: focused ? colors.primary : colors.inputBorder,
              },
            ]}
          >
            <Feather name="search" size={18} color={focused ? colors.primary : colors.textTertiary} />
            <TextInput
              style={[typo.body, styles.searchInput, { color: colors.text }]}
              placeholder="기업명·종목코드·공시명 검색"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
              returnKeyType="search"
              accessibilityLabel="통합 검색"
              accessibilityHint="기업명·종목코드·공시명으로 검색하세요"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="검색어 지우기"
              >
                <Feather name="x-circle" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {renderBody()}
      </KeyboardAvoidingView>
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
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  card: {
    marginBottom: spacing.sm,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  companyInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  companyMeta: {
    marginTop: 2,
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontWeight: '600',
  },
});
