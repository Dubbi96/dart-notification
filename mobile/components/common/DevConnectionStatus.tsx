import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { api, API_BASE_URL } from '@services/api';

// 개발용 연결 상태 인디케이터(DAR-43 §4) — __DEV__ 에서만 사용.
// 현재 API_BASE_URL 표기 + 게스트 허용 엔드포인트로 백엔드 도달 여부를 확인한다.
// 실기기↔로컬 백엔드(방화벽/Wi-Fi) 연결 진단용.
type Reach = 'idle' | 'checking' | 'ok' | 'fail';

export function DevConnectionStatus() {
  const { colors, typography: typo } = useTheme();
  const [reach, setReach] = useState<Reach>('idle');

  const check = useCallback(async () => {
    setReach('checking');
    try {
      await api.get('/disclosures', { params: { page: 1, limit: 1 } });
      setReach('ok');
    } catch {
      setReach('fail');
    }
  }, []);

  const statusColor =
    reach === 'ok' ? colors.success : reach === 'fail' ? colors.error : colors.textTertiary;
  const statusLabel =
    reach === 'ok'
      ? '도달 가능'
      : reach === 'fail'
        ? '도달 실패'
        : reach === 'checking'
          ? '확인 중…'
          : '미확인';

  return (
    <View style={[styles.container, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}>
      <View style={styles.row}>
        <Feather name="server" size={16} color={colors.textSecondary} />
        <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.sm }]}>
          개발용 연결 상태
        </Text>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[typo.small, { color: statusColor }]}>{statusLabel}</Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]} selectable>
        {API_BASE_URL}
      </Text>
      <TouchableOpacity
        style={[styles.button, { borderColor: colors.primary }]}
        onPress={check}
        disabled={reach === 'checking'}
        activeOpacity={0.7}
      >
        {reach === 'checking' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[typo.captionMedium, { color: colors.primary }]}>연결 확인</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 'auto',
    marginRight: spacing.xs,
  },
  button: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    minWidth: 88,
    alignItems: 'center',
  },
});
