import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { useCompanyDetail } from '@hooks/useCompanyDetail';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';

function formatEstDate(estDate: string | null): string {
  if (!estDate || estDate.length !== 8) return '-';
  return `${estDate.slice(0, 4)}.${estDate.slice(4, 6)}.${estDate.slice(6, 8)}`;
}

const MARKET_LABELS: Record<string, string> = {
  LISTED: '상장',
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  KONEX: '코넥스',
};

function getMarketLabel(corpCls: string | null, market: string | null): string {
  if (market) return MARKET_LABELS[market] ?? market;
  switch (corpCls) {
    case 'Y': return '코스피';
    case 'K': return '코스닥';
    case 'N': return '코넥스';
    default: return '비상장';
  }
}

export default function CompanyDetailScreen() {
  const { corpCode } = useLocalSearchParams<{ corpCode: string }>();
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const { data: company, isLoading } = useCompanyDetail(corpCode!);
  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItem = useMemo(
    () => watchlistData?.data?.find((item) => item.corpCode === corpCode),
    [watchlistData, corpCode],
  );
  const isWatched = !!watchlistItem;

  const handleToggleWatchlist = () => {
    if (!requireAuth()) return;
    if (!company) return;

    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate(watchlistItem.id);
    } else {
      addToWatchlist.mutate({ corpCode: company.corpCode, corpName: company.corpName });
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!company) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[typo.body, { color: colors.textSecondary }]}>기업 정보를 찾을 수 없습니다</Text>
        </View>
      </SafeAreaView>
    );
  }

  const overview = company.overview;
  const marketLabel = getMarketLabel(overview?.corpCls ?? null, company.market);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {company.corpName}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Company Header Card */}
        <Card style={styles.mainCard} variant="elevated">
          <View style={styles.companyHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[typo.h2, { color: colors.text }]}>{company.corpName}</Text>
              {overview?.corpNameEng && (
                <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
                  {overview.corpNameEng}
                </Text>
              )}
            </View>
            <View style={[styles.marketBadge, { backgroundColor: isDark ? '#052E16' : '#D1FAE5' }]}>
              <Text style={[typo.small, { color: isDark ? '#4ADE80' : '#059669', fontWeight: '600' }]}>
                {marketLabel}
              </Text>
            </View>
          </View>

          {company.stockCode && (
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              종목코드 {company.stockCode}
            </Text>
          )}

          {/* 관심기업 버튼 */}
          <TouchableOpacity
            style={[
              styles.watchlistButton,
              { backgroundColor: isWatched ? colors.surface : colors.primary },
              isWatched && { borderWidth: 1, borderColor: colors.borderLight },
            ]}
            onPress={handleToggleWatchlist}
            activeOpacity={0.8}
          >
            <Feather
              name={isWatched ? 'check' : 'plus'}
              size={16}
              color={isWatched ? colors.text : '#FFFFFF'}
            />
            <Text style={[
              typo.bodyMedium,
              { color: isWatched ? colors.text : '#FFFFFF', marginLeft: spacing.xs },
            ]}>
              {isWatched ? '관심기업' : '관심기업 추가'}
            </Text>
          </TouchableOpacity>
        </Card>

        {/* 기업 개요 */}
        {overview && (
          <View style={styles.section}>
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>기업 개요</Text>
            <Card variant="elevated">
              {overview.ceoName && (
                <InfoRow icon="user" label="대표이사" value={overview.ceoName} colors={colors} typo={typo} />
              )}
              {overview.industryCode && (
                <InfoRow icon="briefcase" label="업종코드" value={overview.industryCode} colors={colors} typo={typo} />
              )}
              {overview.estDate && (
                <InfoRow icon="calendar" label="설립일" value={formatEstDate(overview.estDate)} colors={colors} typo={typo} />
              )}
              {overview.accMonth && (
                <InfoRow icon="clock" label="결산월" value={`${overview.accMonth}월`} colors={colors} typo={typo} />
              )}
              {overview.address && (
                <InfoRow icon="map-pin" label="주소" value={overview.address} colors={colors} typo={typo} />
              )}
              {overview.homepageUrl && (
                <TouchableOpacity onPress={() => {
                  const url = overview.homepageUrl!.startsWith('http') ? overview.homepageUrl! : `https://${overview.homepageUrl}`;
                  Linking.openURL(url);
                }}>
                  <InfoRow icon="globe" label="홈페이지" value={overview.homepageUrl} colors={colors} typo={typo} isLink />
                </TouchableOpacity>
              )}
            </Card>
          </View>
        )}

        {/* 최근 공시 */}
        <View style={styles.section}>
          <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>최근 공시</Text>
          {company.recentDisclosures.length === 0 ? (
            <Card variant="elevated">
              <Text style={[typo.body, { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg }]}>
                최근 공시가 없습니다
              </Text>
            </Card>
          ) : (
            company.recentDisclosures.map((disclosure) => (
              <TouchableOpacity
                key={disclosure.rcpNo}
                activeOpacity={0.7}
                onPress={() => router.push(`/disclosure/${disclosure.rcpNo}`)}
              >
                <Card style={styles.disclosureCard} variant="elevated">
                  <View style={styles.disclosureHeader}>
                    <View
                      style={[
                        styles.typeBadge,
                        { backgroundColor: getTypeStyle(disclosure.disclosureType, isDark).bg },
                      ]}
                    >
                      <Text
                        style={[
                          typo.small,
                          { color: getTypeStyle(disclosure.disclosureType, isDark).text, fontWeight: '600' },
                        ]}
                      >
                        {getTypeLabel(disclosure.disclosureType)}
                      </Text>
                    </View>
                    <Text style={[typo.small, { color: colors.textTertiary }]}>
                      {disclosure.rcpDt.length === 8
                        ? format(parse(disclosure.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')
                        : disclosure.rcpDt}
                    </Text>
                  </View>
                  <Text style={[typo.body, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
                    {disclosure.reportName}
                  </Text>
                </Card>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, colors, typo, isLink }: {
  icon: string;
  label: string;
  value: string;
  colors: any;
  typo: any;
  isLink?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        <Feather name={icon as any} size={14} color={colors.textTertiary} />
        <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>{label}</Text>
      </View>
      <Text
        style={[
          typo.body,
          { color: isLink ? colors.primary : colors.text, flex: 1, textAlign: 'right' },
          isLink && { textDecorationLine: 'underline' },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
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
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    padding: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  scrollContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  mainCard: {
    marginBottom: 0,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  marketBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
  watchlistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    marginTop: spacing.base,
  },
  section: {
    marginTop: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 90,
  },
  disclosureCard: {
    marginBottom: spacing.sm,
  },
  disclosureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
});
