import React, { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button } from '@components/common/Button';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { radius, spacing } from '@theme/spacing';
import { runDeviceRuleSelfCheck } from '@utils/deviceRuleDecision';

/** 합성 입력으로 실제 기기 evaluator를 호출한다. 실계좌/시세 API 호출이나 주문은 없다. */
export function DeviceRuleCheckSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, typography: typo, isDark } = useTheme();
  const danger = isDark ? colors.error : palette.red600;
  const reducedMotion = useReducedMotion();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runDeviceRuleSelfCheck>> | null>(
    null,
  );
  const [error, setError] = useState(false);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(false);
    setResult(null);
    try {
      setResult(await runDeviceRuleSelfCheck());
    } catch {
      setError(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[typo.h2, styles.flex, { color: colors.text }]} accessibilityRole="header">
            기기 판단 점검
          </Text>
          <Button title="닫기" variant="ghost" size="sm" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.intro, { backgroundColor: colors.primaryLight }]}>
            <Feather name="cpu" size={28} color={colors.primaryDark} />
            <Text style={[typo.h3, { color: colors.text }]}>위험 앞에서 멈추는지 확인해요</Text>
            <Text style={[typo.body, { color: colors.textSecondary }]}>
              가격 누락, 오래된 데이터, 위험 신호와 긴급 중단 등 합성 사례를 이 휴대전화의 Rule
              Engine으로 계산합니다.
            </Text>
          </View>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            현재는 종가 기반 Shadow 계획입니다. 앱을 닫은 동안의 상시 감시, 실시간 가격 판단, 자동
            실주문은 연결되지 않았습니다.
          </Text>
          <Button
            title={busy ? '기기에서 계산 중' : result ? '다시 점검하기' : '이 기기에서 점검하기'}
            onPress={run}
            loading={busy}
            fullWidth
          />
          <View accessibilityLiveRegion="polite">
            {error ? (
              <Text style={[typo.body, { color: danger }]} accessibilityRole="alert">
                점검을 완료하지 못했습니다. 다시 시도해 주세요. 통과로 간주하지 않습니다.
              </Text>
            ) : null}
            {result ? (
              <>
                <Text style={[typo.h3, { color: colors.text }]}>
                  {result.passed} / {result.total} 사례 통과
                </Text>
                <Text style={[typo.caption, styles.note, { color: colors.textSecondary }]}>
                  이 결과는 안전 분기 동작 점검입니다. 수익성 검증, 백테스트, 실거래 승인 또는 현재
                  데이터의 정상 여부를 뜻하지 않습니다.
                </Text>
                {result.cases.map((item) => (
                  <View key={item.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                    <Feather
                      name={item.passed ? 'check-circle' : 'alert-circle'}
                      size={20}
                      color={item.passed ? colors.primaryDark : danger}
                    />
                    <View style={styles.flex}>
                      <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.label}</Text>
                      <Text style={[typo.caption, { color: colors.textSecondary }]}>
                        {item.passed ? '예상대로 동작' : '점검 실패 · 실거래 연결 금지'}
                      </Text>
                      <Text style={[typo.caption, { color: colors.textSecondary }]}>
                        {item.explanation}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  intro: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  note: { marginTop: spacing.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
});
