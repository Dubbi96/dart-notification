import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MagnifyingGlass } from 'phosphor-react-native';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useCompanySearch } from '@hooks/useCompanySearch';
import { useAddToWatchlist } from '@hooks/useWatchlist';
import { useDialog } from '@components/common/DialogProvider';
import type { Company } from '@app-types/user.types';

const MAX_WATCHLIST_COUNT = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
  existingCorpCodes: string[];
  currentCount?: number;
}

export function CompanySearchModal({ visible, onClose, existingCorpCodes, currentCount = 0 }: Props) {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Company[]>([]);

  const { data: results, isLoading } = useCompanySearch(debouncedQuery);
  const addToWatchlist = useAddToWatchlist();

  const selectedCorpCodes = useMemo(
    () => new Set(selected.map((c) => c.corpCode)),
    [selected],
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (timer) clearTimeout(timer);
      const newTimer = setTimeout(() => setDebouncedQuery(text.trim()), 300);
      setTimer(newTimer);
    },
    [timer],
  );

  const remainingSlots = MAX_WATCHLIST_COUNT - currentCount;

  const toggleSelect = (company: Company) => {
    setSelected((prev) => {
      const exists = prev.find((c) => c.corpCode === company.corpCode);
      if (exists) return prev.filter((c) => c.corpCode !== company.corpCode);
      if (prev.length >= remainingSlots) {
        showDialog({
          title: '등록 한도 초과',
          message: `관심 기업은 최대 ${MAX_WATCHLIST_COUNT}개까지 등록할 수 있습니다.`,
          icon: { name: 'alert-circle', color: '#EAB308' },
        });
        return prev;
      }
      return [...prev, company];
    });
  };

  const handleSubmit = () => {
    for (const company of selected) {
      addToWatchlist.mutate({ corpCode: company.corpCode, corpName: company.corpName });
    }
    handleClose();
  };

  const handleClose = () => {
    setQuery('');
    setDebouncedQuery('');
    setSelected([]);
    onClose();
  };

  const totalNewCount = selected.filter(
    (c) => !existingCorpCodes.includes(c.corpCode),
  ).length;

  const renderItem = ({ item }: { item: Company }) => {
    const isAlreadyAdded = existingCorpCodes.includes(item.corpCode);
    const isSelected = selectedCorpCodes.has(item.corpCode);
    const isChecked = isAlreadyAdded || isSelected;

    return (
      <TouchableOpacity
        style={styles.resultItem}
        activeOpacity={0.7}
        onPress={() => !isAlreadyAdded && toggleSelect(item)}
        disabled={isAlreadyAdded}
      >
        <View style={styles.companyInfo}>
          <Text style={[typo.body, { color: isAlreadyAdded ? colors.textTertiary : colors.text }]}>
            {item.corpName}
          </Text>
          {item.stockCode && (
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
              {item.stockCode} {item.market && `· ${item.market}`}
            </Text>
          )}
        </View>
        <View
          style={[
            styles.checkCircle,
            isChecked
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { borderColor: colors.borderLight },
          ]}
        >
          {isChecked && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" transparent={false} onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.backButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text }]}>기업 검색</Text>
        </View>

        {/* Search Input */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={[typo.body, styles.searchInput, { color: colors.text }]}
            placeholder="기업명 검색"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            autoFocus
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => handleQueryChange('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {/* 한도 안내 */}
        {remainingSlots <= 5 && (
          <View style={styles.limitBanner}>
            <Text style={[typo.small, { color: remainingSlots === 0 ? colors.error : colors.warning }]}>
              {remainingSlots === 0
                ? `관심 기업 한도에 도달했습니다 (${MAX_WATCHLIST_COUNT}/${MAX_WATCHLIST_COUNT})`
                : `관심 기업 등록 가능: ${remainingSlots}개 남음`}
            </Text>
          </View>
        )}

        {/* Results */}
        {isLoading && debouncedQuery.length > 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={results ?? []}
            renderItem={renderItem}
            keyExtractor={(item) => item.corpCode}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              debouncedQuery.length > 0 ? (
                <View style={styles.centered}>
                  <MagnifyingGlass size={48} color={colors.textTertiary} weight="thin" />
                  <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
                    검색 결과가 없습니다
                  </Text>
                </View>
              ) : null
            }
          />
        )}

        {/* Bottom Button */}
        <View style={[styles.bottomBar, { borderTopColor: colors.borderLight }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: totalNewCount > 0 ? colors.primary : colors.borderLight },
            ]}
            onPress={handleSubmit}
            disabled={totalNewCount === 0 || addToWatchlist.isPending}
            activeOpacity={0.8}
          >
            <Text
              style={[
                typo.bodyMedium,
                { color: totalNewCount > 0 ? '#FFFFFF' : colors.textTertiary },
              ]}
            >
              {totalNewCount > 0 ? `${totalNewCount}개 추가하기` : '기업을 선택하세요'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  backButton: {
    padding: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: spacing.sm,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
  },
  companyInfo: {
    flex: 1,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centered: {
    alignItems: 'center',
    paddingTop: 60,
  },
  limitBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
    borderTopWidth: 1,
  },
  submitButton: {
    paddingVertical: spacing.base,
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
