import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Switch, Checkbox, Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { X } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { useDialog } from '@components/common/DialogProvider';
import { useNotificationSettings, useUpdateNotificationSettings } from '@hooks/useNotificationSettings';
import { useDisclosureTypes } from '@hooks/useDisclosureTypes';

const MAX_KEYWORDS = 5;

interface NotificationSettingsForm {
  isEnabled: boolean;
  disclosureTypes: string[];
  keywords: string[];
}

export default function NotificationSettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { data: settings, isLoading } = useNotificationSettings();
  const { data: disclosureTypes = [] } = useDisclosureTypes();
  const updateSettings = useUpdateNotificationSettings();

  const { control, handleSubmit, reset, watch, formState: { isDirty } } = useForm<NotificationSettingsForm>({
    defaultValues: {
      isEnabled: true,
      disclosureTypes: [],
      keywords: [],
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        isEnabled: settings.isEnabled,
        disclosureTypes: settings.disclosureTypes ?? [],
        keywords: settings.keywords ?? [],
      });
    }
  }, [settings, reset]);

  const handleBack = () => {
    if (isDirty) {
      showDialog({
        title: '변경사항이 있어요',
        message: '저장하지 않고 나가시겠어요?',
        icon: { name: 'alert-circle', color: '#F59E0B' },
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
    updateSettings.mutate(
      {
        disclosureTypes: data.disclosureTypes,
        keywords: data.keywords,
        isEnabled: data.isEnabled,
      },
      {
        onSuccess: () => {
          showDialog({ title: '저장 완료', message: '알림 설정이 저장되었습니다.', icon: { name: 'check-circle' } });
          reset(data);
        },
        onError: () => {
          showDialog({ title: '오류', message: '설정 저장에 실패했습니다.', icon: { name: 'alert-circle', color: '#EF4444' } });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
            알림 설정
          </Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          알림 설정
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Push toggle */}
        <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>
          푸시 알림
        </Text>
        <Controller
          control={control}
          name="isEnabled"
          render={({ field: { onChange, value } }) => (
            <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              <View>
                <Text style={[typo.bodyMedium, { color: colors.text }]}>새 공시 알림 받기</Text>
              </View>
              <Switch
                value={value}
                onValueChange={onChange}
                color={colors.primary}
              />
            </View>
          )}
        />

        {watch('isEnabled') && (
          <>
            {/* 구분선 */}
            <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />

            {/* Disclosure Types */}
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.xs }]}>
              공시 유형
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.md }]}>
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
            <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.md }]}>
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
          disabled={!isDirty}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
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
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    width: 56,
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
