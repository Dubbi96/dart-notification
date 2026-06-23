import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Switch, Checkbox, Divider } from 'react-native-paper';
import { X } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { ApiErrorState } from '@components/common/StateView';
import { useDialog } from '@components/common/DialogProvider';
import { useNotificationSettings, useUpdateNotificationSettings } from '@hooks/useNotificationSettings';
import { useDisclosureTypes } from '@hooks/useDisclosureTypes';

const MAX_KEYWORDS = 5;

interface NotificationSettingsForm {
  isEnabled: boolean;
  disclosureTypes: string[];
  keywords: string[];
  // DAR-85: 신호·청산·논리훼손 푸시 토글(기본 OFF)
  signalPushEnabled: boolean;
  exitPushEnabled: boolean;
  thesisPushEnabled: boolean;
  // DAR-424: 라이브 페이퍼 체결 알림 토글(기본 ON)
  tradePushEnabled: boolean;
}

// DAR-85: 투자 신호 푸시 토글 정의(기본 OFF — 스팸 차단·안전)
// DAR-424: 체결 알림(매수/매도) 토글 추가 — 기본 ON(체결 통지 기본 수신·과알림은 OFF로 차단).
const SIGNAL_PUSH_TOGGLES: {
  name: 'signalPushEnabled' | 'exitPushEnabled' | 'thesisPushEnabled' | 'tradePushEnabled';
  label: string;
  description: string;
}[] = [
  { name: 'signalPushEnabled', label: '매수 신호', description: '강력매수·매수 신호 발생 시 알림' },
  { name: 'exitPushEnabled', label: '청산 권고', description: '청산 조건 충족 시 알림 (권고 — 자동 주문 아님)' },
  { name: 'thesisPushEnabled', label: '투자논리 훼손', description: '매수 논리의 무효 조건 충족 시 알림' },
  { name: 'tradePushEnabled', label: '체결 알림', description: '모의투자 매수/매도 체결 시 알림 (기본 켜짐)' },
];

export default function NotificationSettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { data: settings, isLoading, isError, error, refetch } = useNotificationSettings();
  const { data: disclosureTypes = [] } = useDisclosureTypes();
  const updateSettings = useUpdateNotificationSettings();

  const { control, handleSubmit, reset, watch, formState: { isDirty } } = useForm<NotificationSettingsForm>({
    defaultValues: {
      isEnabled: true,
      disclosureTypes: [],
      keywords: [],
      signalPushEnabled: false,
      exitPushEnabled: false,
      thesisPushEnabled: false,
      // DAR-424: 체결 알림 기본 ON.
      tradePushEnabled: true,
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        isEnabled: settings.isEnabled,
        disclosureTypes: settings.disclosureTypes ?? [],
        keywords: settings.keywords ?? [],
        // 기본 OFF: 서버가 필드를 안 주는 구버전 호환 위해 ?? false
        signalPushEnabled: settings.signalPushEnabled ?? false,
        exitPushEnabled: settings.exitPushEnabled ?? false,
        thesisPushEnabled: settings.thesisPushEnabled ?? false,
        // DAR-424: 체결 알림은 기본 ON — 서버가 필드를 안 주는 구버전 호환 위해 ?? true.
        tradePushEnabled: settings.tradePushEnabled ?? true,
      });
    }
  }, [settings, reset]);

  const handleBack = () => {
    if (isDirty) {
      showDialog({
        title: '변경사항이 있어요',
        message: '저장하지 않고 나가시겠어요?',
        icon: { name: 'alert-circle', color: colors.warning },
        buttons: [
          { text: '취소', style: 'cancel' },
          { text: '나가기', onPress: () => router.back() },
        ],
      });
    } else {
      router.back();
    }
  };

  const onSubmit = (data: NotificationSettingsForm) => {
    // 로드 실패/미완료 상태에서는 폼이 기본값이므로 저장 시 서버 설정을 덮어쓸 수 있어 차단.
    if (!settings) return;
    updateSettings.mutate(
      {
        disclosureTypes: data.disclosureTypes,
        keywords: data.keywords,
        isEnabled: data.isEnabled,
        signalPushEnabled: data.signalPushEnabled,
        exitPushEnabled: data.exitPushEnabled,
        thesisPushEnabled: data.thesisPushEnabled,
        tradePushEnabled: data.tradePushEnabled,
      },
      {
        onSuccess: () => {
          showDialog({ title: '저장 완료', message: '알림 설정이 저장되었습니다.', icon: { name: 'check-circle' } });
          reset(data);
        },
        onError: () => {
          showDialog({ title: '오류', message: '설정 저장에 실패했습니다.', icon: { name: 'alert-circle', color: colors.error } });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="알림 설정" onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // 로드 실패 시 폼(기본값)을 보여주면 저장 시 서버 설정을 기본값으로 덮어써 데이터가 유실됨.
  // 폼 대신 에러뷰+재시도를 노출해 사용자 설정을 보호한다.
  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="알림 설정" onBack={() => router.back()} />
        <ApiErrorState
          error={error}
          onRetry={refetch}
          title="알림 설정을 불러오지 못했습니다"
          description="저장 시 설정이 초기화될 수 있어 화면을 막았습니다. 잠시 후 다시 시도해 주세요."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="알림 설정" onBack={handleBack} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Push toggle */}
        <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>
          푸시 알림
        </Text>
        <Controller
          control={control}
          name="isEnabled"
          render={({ field: { onChange, value } }) => (
            <AccessibleToggleRow
              label="새 공시 알림 받기"
              value={value}
              onChange={onChange}
              colors={colors}
              typo={typo}
            />
          )}
        />

        {watch('isEnabled') && (
          <>
            {/* 구분선 */}
            <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />

            {/* DAR-85: 투자 신호 푸시 토글 (기본 OFF) */}
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.xs }]}>
              투자 신호 알림
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
              매수 신호·청산 권고·논리 훼손 시점 알림 (기본 꺼짐)
            </Text>
            {SIGNAL_PUSH_TOGGLES.map((toggle) => (
              <Controller
                key={toggle.name}
                control={control}
                name={toggle.name}
                render={({ field: { onChange, value } }) => (
                  <AccessibleToggleRow
                    label={toggle.label}
                    description={toggle.description}
                    value={value}
                    onChange={onChange}
                    colors={colors}
                    typo={typo}
                    style={{ marginBottom: spacing.sm }}
                  />
                )}
              />
            ))}

            {/* 구분선 */}
            <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />

            {/* Disclosure Types */}
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.xs }]}>
              공시 유형
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
              선택하지 않으면 모든 유형의 공시를 받습니다
            </Text>
            <Controller
              control={control}
              name="disclosureTypes"
              render={({ field: { onChange, value } }) => (
                <>
                  {disclosureTypes.map((type, index) => {
                    const isSelected = value.includes(type.id);
                    const toggleType = () => {
                      onChange(
                        isSelected
                          ? value.filter((t) => t !== type.id)
                          : [...value, type.id],
                      );
                    };
                    return (
                      <React.Fragment key={type.id}>
                        <TouchableOpacity
                          style={[
                            styles.typeItem,
                            {
                              backgroundColor: isSelected ? colors.primaryLight : colors.surface,
                              borderColor: isSelected ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={toggleType}
                          activeOpacity={0.7}
                          accessible
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          accessibilityLabel={
                            type.description ? `${type.label}, ${type.description}` : type.label
                          }
                        >
                          <View style={styles.typeContent}>
                            <Text style={[typo.bodyMedium, { color: colors.text }]}>{type.label}</Text>
                            <Text style={[typo.small, { color: colors.textSecondary }]}>{type.description}</Text>
                          </View>
                          <Checkbox
                            status={isSelected ? 'checked' : 'unchecked'}
                            onPress={toggleType}
                            color={colors.primary}
                            uncheckedColor={colors.border}
                          />
                        </TouchableOpacity>
                        {index < disclosureTypes.length - 1 && (
                          <Divider style={{ backgroundColor: colors.borderLight }} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            />

            {/* Keywords */}
            <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs }]}>
              키워드
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
              알림 받을 키워드 (최대 {MAX_KEYWORDS}개)
            </Text>
            <Controller
              control={control}
              name="keywords"
              render={({ field: { onChange, value } }) => (
                <KeywordTagInput
                  keywords={value}
                  onChange={onChange}
                  maxKeywords={MAX_KEYWORDS}
                />
              )}
            />
          </>
        )}

        <Button
          title="설정 저장"
          onPress={handleSubmit(onSubmit)}
          fullWidth
          size="lg"
          loading={updateSettings.isPending}
          disabled={!isDirty || !settings}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type ThemeColors = ReturnType<typeof useTheme>['colors'];
type ThemeTypography = ReturnType<typeof useTheme>['typography'];

interface AccessibleToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: ThemeColors;
  typo: ThemeTypography;
  style?: StyleProp<ViewStyle>;
}

// 스위치 행 전체를 단일 접근 단위로 묶는다(라벨/설명 합성 + role=switch + state.checked).
// 스크린리더가 '무엇에 대한 스위치인지/켜짐·꺼짐'을 한 번에 읽도록 한다.
function AccessibleToggleRow({
  label,
  description,
  value,
  onChange,
  colors,
  typo,
  style,
}: AccessibleToggleRowProps) {
  return (
    <TouchableOpacity
      style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.borderLight }, style]}
      onPress={() => onChange(!value)}
      activeOpacity={0.7}
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={description ? `${label}, ${description}` : label}
    >
      <View style={styles.typeContent}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[typo.small, { color: colors.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        color={colors.primary}
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
  );
}

interface KeywordTagInputProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  maxKeywords: number;
}

function KeywordTagInput({ keywords, onChange, maxKeywords }: KeywordTagInputProps) {
  const { colors, typography: typo } = useTheme();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);

  const addKeyword = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || keywords.includes(trimmed) || keywords.length >= maxKeywords) return;
    onChange([...keywords, trimmed]);
  };

  const removeKeyword = (keyword: string) => {
    onChange(keywords.filter((k) => k !== keyword));
  };

  const handleSubmitEditing = () => {
    addKeyword(input);
    setInput('');
  };

  const handleChangeText = (text: string) => {
    if (text.endsWith(',') || text.endsWith(', ')) {
      const keyword = text.replace(/,\s*$/, '').trim();
      if (keyword) addKeyword(keyword);
      setInput('');
    } else {
      setInput(text);
    }
  };

  return (
    <View>
      {keywords.length > 0 && (
        <View style={kwStyles.tagContainer}>
          {keywords.map((keyword) => (
            <View
              key={keyword}
              style={[kwStyles.tag, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
            >
              <Text style={[typo.body, { color: colors.primary, fontWeight: '600' }]}>
                {keyword}
              </Text>
              <TouchableOpacity onPress={() => removeKeyword(keyword)} hitSlop={8}>
                <X size={14} color={colors.primary} weight="bold" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {keywords.length < maxKeywords && (
        <View
          style={[
            kwStyles.inputRow,
            {
              backgroundColor: colors.inputBackground,
              borderColor: focused ? colors.primary : colors.inputBorder,
            },
          ]}
        >
          <TextInput
            style={[kwStyles.input, { color: colors.inputText, ...typo.body }]}
            placeholder="키워드 입력 후 엔터"
            placeholderTextColor={colors.inputPlaceholder}
            value={input}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmitEditing}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            returnKeyType="done"
          />
        </View>
      )}
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {keywords.length}/{maxKeywords}개
      </Text>
    </View>
  );
}

const kwStyles = StyleSheet.create({
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  sectionDivider: {
    height: 1,
    marginVertical: spacing.xl,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  typeContent: { flex: 1 },
});
