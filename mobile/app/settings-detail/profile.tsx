import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { Input } from '@components/common/Input';
import { Button } from '@components/common/Button';
import { useDialog } from '@components/common/DialogProvider';
import { useMe, useUpdateMe } from '@hooks/useAuth';

interface ProfileForm {
  name: string;
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const { showDialog } = useDialog();
  // 서버 User SSOT = useMe().data (authStore 복제 제거, DAR-262).
  const { data: user } = useMe();
  // 저장은 useUpdateMe(useMutation) 경유 — onSuccess 에서 ['users','me'] 캐시가 갱신되어
  // 홈 헤더 인사말 등 useMe 소비 화면과 표기가 즉시 일치한다(UXR-18/D-6).
  const { mutate: updateMe, isPending: isSaving } = useUpdateMe();

  // useMe().data 는 비동기 로드 → 콜드 캐시/딥링크 진입 시 마운트 시점엔 비어 있을 수 있다.
  // `values` 로 데이터 도착 시 이름을 반영하고, 동일 데이터 refetch 는 구조적 공유로 편집을 보존한다.
  const { control, handleSubmit, formState: { isDirty } } = useForm<ProfileForm>({
    values: { name: user?.name ?? '' },
  });

  const onSubmit = useCallback((data: ProfileForm) => {
    updateMe(
      { name: data.name },
      {
        onSuccess: () => {
          showDialog({ title: '저장 완료', message: '프로필이 업데이트되었습니다.', icon: { name: 'check-circle' } });
          router.back();
        },
        onError: () => {
          showDialog({ title: '오류', message: '프로필 저장에 실패했습니다.', icon: { name: 'alert-circle', color: colors.error } });
        },
      },
    );
  }, [updateMe, showDialog, colors.error]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="프로필" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, {
            backgroundColor: colors.primaryLight,
            borderColor: colors.primaryBorder,
            shadowColor: colors.primary,
          }]}>
            <Feather name="user" size={40} color={colors.primary} />
          </View>
        </View>

        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, value } }) => (
            <Input label="이름" value={value} onChangeText={onChange} />
          )}
        />
        <Input
          label="이메일"
          value={user?.email || ''}
          editable={false}
        />

        <Button
          title="변경사항 저장"
          onPress={handleSubmit(onSubmit)}
          fullWidth
          size="lg"
          loading={isSaving}
          disabled={!isDirty}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing['xl'],
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
});
