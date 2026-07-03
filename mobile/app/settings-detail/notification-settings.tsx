import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  BackHandler,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Switch, Checkbox, Divider } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { LoadingState, ApiErrorState } from '@components/common/StateView';
import { useDialog } from '@components/common/DialogProvider';
import { useNotificationSettings, useUpdateNotificationSettings } from '@hooks/useNotificationSettings';
import { useDisclosureTypes } from '@hooks/useDisclosureTypes';

import type { HitSlop } from '@utils/touchTarget';

const MAX_KEYWORDS = 5;

// UXR-5 D-5: 키워드 삭제(X)는 아이콘 전용 버튼이라 시각 크기(14px)가 44pt에 크게 못 미침.
// SearchOverlay 의 symmetricHitSlopForIcon 패턴(DAR-146 규약)대로 4방향 대칭 hitSlop 으로
// 유효 터치 영역을 sizing.minTouchTarget(44pt)까지 확장한다. 14 + 15*2 = 44pt.
const REMOVE_KEYWORD_ICON_SIZE = 14;
const REMOVE_KEYWORD_PAD = Math.max(
  0,
  Math.ceil((sizing.minTouchTarget - REMOVE_KEYWORD_ICON_SIZE) / 2),
);
const REMOVE_KEYWORD_HIT_SLOP: HitSlop = {
  top: REMOVE_KEYWORD_PAD,
  bottom: REMOVE_KEYWORD_PAD,
  left: REMOVE_KEYWORD_PAD,
  right: REMOVE_KEYWORD_PAD,
};

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
  // DAR-473(P01): 리스크·운영 알림 토글(기본 ON)
  opsPushEnabled: boolean;
}

// DAR-85: 투자 신호 푸시 토글 정의(기본 OFF — 스팸 차단·안전)
// DAR-424: 체결 알림(매수/매도) 토글 추가 — 기본 ON(체결 통지 기본 수신·과알림은 OFF로 차단).
// DAR-473(P01): 리스크·운영 알림(opsPushEnabled) 토글 추가 — 기본 ON.
const SIGNAL_PUSH_TOGGLES: {
  name:
    | 'signalPushEnabled'
    | 'exitPushEnabled'
    | 'thesisPushEnabled'
    | 'tradePushEnabled'
    | 'opsPushEnabled';
  label: string;
  description: string;
}[] = [
  { name: 'signalPushEnabled', label: '매수 신호', description: '강력매수·매수 신호 발생 시 알림' },
  { name: 'exitPushEnabled', label: '청산 권고', description: '청산 조건 충족 시 알림 (권고 — 자동 주문 아님)' },
  { name: 'thesisPushEnabled', label: '투자논리 훼손', description: '매수 논리의 무효 조건 충족 시 알림' },
  { name: 'tradePushEnabled', label: '체결 알림', description: '모의투자 매수/매도 체결 시 알림 (기본 켜짐)' },
  { name: 'opsPushEnabled', label: '운영·리스크 알림', description: '킬스위치·크론 지연 등 시스템 상태 알림 (기본 켜짐)' },
];

export default function NotificationSettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const navigation = useNavigation();
  const { data: settings, isLoading, isError, error, refetch } = useNotificationSettings();
  // UXR-5 D-4: 유형 목록의 로딩/실패를 구독해 빈 섹션으로 위장되지 않게 인라인 상태로 노출.
  const {
    data: disclosureTypes = [],
    isLoading: isTypesLoading,
    isError: isTypesError,
    refetch: refetchTypes,
  } = useDisclosureTypes();
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
      // DAR-473(P01): 운영·리스크 알림 기본 ON.
      opsPushEnabled: true,
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
        // DAR-473(P01): 운영·리스크 알림도 기본 ON — 구버전 호환 위해 ?? true.
        opsPushEnabled: settings.opsPushEnabled ?? true,
      });
    }
  }, [settings, reset]);

  // UXR-5 D-1: 다이얼로그의 '나가기' 확정 후 beforeRemove 가드가 재차 다이얼로그를 띄우지
  // 않도록 이탈 허용 플래그를 둔다(확정 이탈은 1회성 — 화면이 곧 언마운트됨).
  const allowLeaveRef = useRef(false);

  // UXR-5 D-1: 미저장 변경 확인 다이얼로그 — 헤더 back·하드웨어 back·스와이프백 공용.
  const confirmLeave = useCallback(() => {
    showDialog({
      title: '변경사항이 있어요',
      message: '저장하지 않고 나가시겠어요?',
      icon: { name: 'alert-circle', color: colors.warning },
      buttons: [
        { text: '취소', style: 'cancel' },
        {
          text: '나가기',
          onPress: () => {
            allowLeaveRef.current = true;
            router.back();
          },
        },
      ],
    });
  }, [showDialog, colors.warning]);

  const handleBack = useCallback(() => {
    if (isDirty) {
      confirmLeave();
    } else {
      router.back();
    }
  }, [isDirty, confirmLeave]);

  // UXR-5 D-1: Android 하드웨어 back·back 제스처 — 헤더 back과 동일한 미저장 가드
  // (onboarding/index.tsx 의 BackHandler 패턴 재사용).
  useEffect(() => {
    const onHardwareBack = () => {
      if (isDirty && !allowLeaveRef.current) {
        confirmLeave();
        return true; // 이탈 차단 — 다이얼로그의 '나가기'로만 나감
      }
      return false; // 변경 없음: 기본 pop 허용
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [isDirty, confirmLeave]);

  // UXR-5 D-1: iOS 스와이프백 등 나머지 pop 경로 — beforeRemove 로 화면 제거를 가로채
  // 동일 가드를 적용한다(하드웨어 back 은 위 BackHandler 가 dispatch 전에 차단).
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty || allowLeaveRef.current) return;
      e.preventDefault();
      confirmLeave();
    });
    return unsubscribe;
  }, [navigation, isDirty, confirmLeave]);

  // UXR-5 D-4: refetch 는 옵션 인자를 받으므로 press 이벤트가 흘러들지 않게 래핑.
  const handleRetryTypes = useCallback(() => {
    void refetchTypes();
  }, [refetchTypes]);

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
        opsPushEnabled: data.opsPushEnabled,
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
        {/* L-5a D-1: 수제 스피너 대신 표준 LoadingState — 로딩 표현 드리프트 제거. */}
        <LoadingState />
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
            {/* UXR-5 D-4: 유형 목록 로딩/실패/빈 응답이 무음의 빈 섹션으로 위장되지 않도록
                섹션 내부에 인라인 상태를 렌더한다(ai-cost.tsx SectionStatus 패턴 + 재시도). */}
            {isTypesLoading ? (
              <View style={styles.typesStatusRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[typo.small, { color: colors.textSecondary }]}>
                  공시 유형을 불러오는 중...
                </Text>
              </View>
            ) : isTypesError ? (
              <View style={styles.typesStatusRow}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>
                  공시 유형을 불러오지 못했습니다
                </Text>
                <TouchableOpacity
                  style={styles.typesRetryButton}
                  onPress={handleRetryTypes}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="공시 유형 다시 불러오기"
                >
                  <Text style={[typo.captionMedium, { color: colors.primary }]}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            ) : disclosureTypes.length === 0 ? (
              <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.md }]}>
                표시할 공시 유형이 없습니다
              </Text>
            ) : (
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
            )}

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

interface KeywordTagProps {
  keyword: string;
  onRemove: (keyword: string) => void;
}

// UXR-5 D-5: 태그 삭제(X) 버튼 — Feather 'x'(프로젝트 표준) + 44pt hitSlop + 스크린리더
// 라벨/역할. map 내 인라인 화살표 onPress 대신 태그 단위 컴포넌트로 분리(React.memo)해
// 부모 리렌더 시 불필요한 핸들러 재생성·자식 리렌더를 막는다.
const KeywordTag = React.memo(function KeywordTag({ keyword, onRemove }: KeywordTagProps) {
  const { colors, typography: typo } = useTheme();
  const handleRemove = useCallback(() => onRemove(keyword), [onRemove, keyword]);
  return (
    <View
      style={[kwStyles.tag, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
    >
      <Text style={[typo.body, { color: colors.primary, fontWeight: '600' }]}>{keyword}</Text>
      <TouchableOpacity
        onPress={handleRemove}
        hitSlop={REMOVE_KEYWORD_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={`${keyword} 키워드 삭제`}
      >
        <Feather name="x" size={REMOVE_KEYWORD_ICON_SIZE} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
});

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

  // D-5: memo 된 KeywordTag 에 전달하므로 안정 참조로 유지.
  const removeKeyword = useCallback(
    (keyword: string) => {
      onChange(keywords.filter((k) => k !== keyword));
    },
    [keywords, onChange],
  );

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
            <KeywordTag key={keyword} keyword={keyword} onRemove={removeKeyword} />
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
  // UXR-5 D-4: 공시 유형 섹션 인라인 로딩/에러 상태 행.
  typesStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  // D-4: 텍스트 링크형 재시도 버튼 — 유효 터치 영역 44pt 보장(sizing.minTouchTarget).
  typesRetryButton: {
    minHeight: sizing.minTouchTarget,
    minWidth: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
});
