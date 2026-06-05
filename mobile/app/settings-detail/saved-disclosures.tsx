import React from 'react';
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
import { EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useSavedDisclosures, useRemoveSavedDisclosure } from '@hooks/useSavedDisclosures';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';

export default function SavedDisclosuresScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const { showSnackbar } = useSnackbar();
  const { data, isLoading } = useSavedDisclosures();
  const removeMutation = useRemoveSavedDisclosure();

  const items = data?.data ?? [];

  const handleRemove = (id: string) => {
    removeMutation.mutate(id);
    showSnackbar(snackbarCopy.disclosureUnsaved, { duration: SNACKBAR_DURATION.success });
  };

  const renderItem = ({ item }: { item: any }) => {
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
              onPress={() => handleRemove(item.id)}
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
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, marginLeft: spacing.sm }]}>저장된 공시</Text>
        <View style={{ flex: 1 }} />
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          {items.length}건
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
