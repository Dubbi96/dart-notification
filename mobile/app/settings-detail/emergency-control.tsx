import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@components/common/ScreenHeader';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { useActivateMobileKillSwitch, useAosMobileControl } from '@hooks/useAosMobileControl';
import { useAutoTradingStatus } from '@hooks/useAutoTradingStatus';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';
import { radius, sizing, spacing } from '@theme/spacing';

const HOLD_DELAY_MS = 1_200;
const MIN_REASON_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;

function errorCode(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })
    ?.response;
  if (response?.status === 403) return '이 계정에는 비상 제어 권한이 없습니다.';
  if (response?.status === 401) return '로그인을 다시 확인해 주세요.';
  const message = response?.data?.message;
  return typeof message === 'string' ? message : '요청을 완료하지 못했습니다.';
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR');
}

export default function EmergencyControlScreen() {
  const { colors, typography: typo } = useTheme();
  const { isAuthenticated } = useAuthStore();
  const { showSnackbar } = useSnackbar();
  const operator = useAosMobileControl(isAuthenticated);
  const status = useAutoTradingStatus(1);
  const activate = useActivateMobileKillSwitch();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<{
    receiptHash: string;
    effectiveAt: string | null;
  } | null>(null);

  const hasPermission =
    operator.data?.operator.permissions.includes('EMERGENCY_CONTROL') === true;
  const controlEnabled = operator.data?.mutationsEnabled === true && hasPermission;
  const killActive = status.data?.killSwitch.isActive === true;
  const formValid =
    password.length >= MIN_PASSWORD_LENGTH && reason.trim().length >= MIN_REASON_LENGTH;
  const buttonDisabled = !controlEnabled || killActive || !formValid || activate.isPending;
  const stateLabel = useMemo(() => {
    if (killActive) return '신규 진입 중단 중';
    if (status.isLoading) return '상태 확인 중';
    return '신규 진입 허용 상태';
  }, [killActive, status.isLoading]);

  const handleActivate = () => {
    if (buttonDisabled) return;
    activate.mutate(
      {
        password,
        reason: reason.trim(),
        correlationId: `mobile-kill:${Crypto.randomUUID()}`,
      },
      {
        onSuccess: (result) => {
          setReceipt({ receiptHash: result.receiptHash, effectiveAt: result.effectiveAt });
          setPassword('');
          setReason('');
          showSnackbar('신규 진입 중단 명령이 기록됐습니다.', { duration: 4000 });
        },
        onError: (error) => showSnackbar(errorCode(error), { duration: 4000 }),
      },
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader
        title="비상 제어"
        subtitle="운영자 전용 · 제한된 통제"
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.stateCard,
            {
              backgroundColor: killActive ? colors.errorSurface : colors.surface,
              borderColor: killActive ? colors.error : colors.border,
            },
          ]}
        >
          <View style={styles.stateRow}>
            <View
              style={[
                styles.stateIcon,
                { backgroundColor: killActive ? colors.errorSurface : colors.primaryLight },
              ]}
            >
              <Feather
                name={killActive ? 'slash' : 'shield'}
                size={22}
                color={killActive ? colors.error : colors.primary}
              />
            </View>
            <View style={styles.flex}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>현재 Risk 상태</Text>
              <Text style={[typo.h3, { color: killActive ? colors.error : colors.text }]}>
                {stateLabel}
              </Text>
            </View>
          </View>
          <Text style={[typo.small, styles.notice, { color: colors.textSecondary }]}>
            {status.data?.notice ?? '서버의 Kill Switch 상태를 확인합니다.'}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            확인 시각 {formatTimestamp(status.data?.asOf)}
          </Text>
        </View>

        {operator.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typo.body, { color: colors.textSecondary }]}>권한을 확인하고 있어요.</Text>
          </View>
        ) : operator.isError ? (
          <View style={[styles.messageCard, { backgroundColor: colors.surface }]}>
            <Feather name="lock" size={20} color={colors.textSecondary} />
            <View style={styles.flex}>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>모바일 비상 제어 접근 불가</Text>
              <Text style={[typo.small, { color: colors.textSecondary }]}>
                {errorCode(operator.error)} 상태 조회는 계속 사용할 수 있습니다.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.sectionCard, { backgroundColor: colors.surface }]}>
              <Text style={[typo.h3, { color: colors.text }]}>신규 진입 전체 중단</Text>
              <Text style={[typo.body, styles.description, { color: colors.textSecondary }]}>
                신규 매수 진입만 즉시 막습니다. 손절·추적손절 등 위험 축소 규칙은 별도 정책을
                따르며, 이 화면에서는 자동 해제하지 않습니다.
              </Text>

              {!operator.data?.mutationsEnabled && (
                <View style={[styles.readOnlyBox, { backgroundColor: colors.warningSurface }]}>
                  <Feather name="eye" size={18} color={colors.warning} />
                  <Text style={[typo.small, styles.flex, { color: colors.text }]}>
                    서버가 읽기 전용 모드입니다. Admin에서 운영 설정을 확인해 주세요.
                  </Text>
                </View>
              )}

              <Text style={[typo.captionMedium, styles.label, { color: colors.textSecondary }]}>
                중단 사유
              </Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="무엇을 왜 중단하는지 기록"
                placeholderTextColor={colors.inputPlaceholder}
                multiline
                maxLength={1000}
                style={[
                  typo.body,
                  styles.reasonInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.inputText,
                  },
                ]}
                accessibilityLabel="신규 진입 중단 사유"
              />

              <Text style={[typo.captionMedium, styles.label, { color: colors.textSecondary }]}>
                운영자 비밀번호 재확인
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="8자 이상"
                placeholderTextColor={colors.inputPlaceholder}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                style={[
                  typo.body,
                  styles.passwordInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.inputText,
                  },
                ]}
                accessibilityLabel="운영자 비밀번호 재확인"
              />

              <Pressable
                onLongPress={handleActivate}
                delayLongPress={HOLD_DELAY_MS}
                disabled={buttonDisabled}
                accessibilityRole="button"
                accessibilityLabel="길게 눌러 신규 진입 중단"
                accessibilityHint="1.2초 동안 길게 누르면 신규 진입 중단 명령이 실행됩니다."
                accessibilityState={{ disabled: buttonDisabled }}
                style={({ pressed }) => [
                  styles.haltButton,
                  {
                    backgroundColor: buttonDisabled ? colors.surfaceSecondary : colors.error,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                {activate.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather
                      name="alert-octagon"
                      size={20}
                      color={buttonDisabled ? colors.textTertiary : colors.primaryForeground}
                    />
                    <Text
                      style={[
                        typo.bodyMedium,
                        {
                          color: buttonDisabled
                            ? colors.textTertiary
                            : colors.primaryForeground,
                        },
                      ]}
                    >
                      {killActive ? '이미 중단됨' : '1.2초 길게 눌러 중단'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {(receipt ?? operator.data?.killSwitch) && (
              <View style={[styles.receiptCard, { backgroundColor: colors.surfaceSecondary }]}>
                <View style={styles.receiptTitle}>
                  <Feather name="check-circle" size={18} color={colors.success} />
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>명령 영수증</Text>
                </View>
                <Text style={[typo.small, { color: colors.textSecondary }]}>
                  적용 {formatTimestamp((receipt ?? operator.data?.killSwitch)?.effectiveAt)}
                </Text>
                <Text
                  selectable
                  numberOfLines={2}
                  style={[typo.small, styles.hash, { color: colors.textTertiary }]}
                >
                  {(receipt ?? operator.data?.killSwitch)?.receiptHash}
                </Text>
              </View>
            )}
          </>
        )}

        <View style={[styles.boundaryCard, { borderColor: colors.border }]}>
          <Text style={[typo.captionMedium, { color: colors.text }]}>모바일 통제 경계</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            Rule·Weight 편집, 승인, Kill Switch 해제는 Admin에서만 수행합니다. 이 앱은 실주문을
            직접 생성하지 않습니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.base, paddingBottom: spacing['3xl'] },
  flex: { flex: 1, minWidth: 0 },
  stateCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.base },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stateIcon: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { marginTop: spacing.md, marginBottom: spacing.xs },
  centerBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  messageCard: {
    borderRadius: radius.lg,
    padding: spacing.base,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  sectionCard: { borderRadius: radius.lg, padding: spacing.base },
  description: { marginTop: spacing.sm, marginBottom: spacing.base },
  readOnlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  reasonInput: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
  },
  passwordInput: {
    minHeight: sizing.minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  haltButton: {
    minHeight: 52,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  receiptCard: { borderRadius: radius.lg, padding: spacing.base, gap: spacing.xs },
  receiptTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hash: { fontFamily: 'monospace' },
  boundaryCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.base, gap: spacing.sm },
});
