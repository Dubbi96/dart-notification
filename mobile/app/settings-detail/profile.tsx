import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Input } from '@components/common/Input';
import { Button } from '@components/common/Button';
import { useDialog } from '@components/common/DialogProvider';
import { useMe } from '@hooks/useAuth';
import { api } from '@services/api';

interface ProfileForm {
  name: string;
}

export default function ProfileScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  // 서버 User SSOT = useMe().data (authStore 복제 제거, DAR-262).
  const { data: user } = useMe();
  const [isSaving, setIsSaving] = useState(false);

  // useMe().data 는 비동기 로드 → 콜드 캐시/딥링크 진입 시 마운트 시점엔 비어 있을 수 있다.
  // `values` 로 데이터 도착 시 이름을 반영하고, 동일 데이터 refetch 는 구조적 공유로 편집을 보존한다.
  const { control, handleSubmit, formState: { isDirty } } = useForm<ProfileForm>({
    values: { name: user?.name ?? '' },
  });

  const onSubmit = async (data: ProfileForm) => {
    setIsSaving(true);
    try {
      await api.patch('/users/me', { name: data.name });
      showDialog({ title: '저장 완료', message: '프로필이 업데이트되었습니다.', icon: { name: 'check-circle' } });
      router.back();
    } catch {
      showDialog({ title: '오류', message: '프로필 저장에 실패했습니다.', icon: { name: 'alert-circle', color: colors.error } });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          프로필
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, {
            backgroundColor: colors.primaryLight,
            borderColor: colors.primary + '25',
            shadowColor: colors.primary,
          }]}>
            <Ionicons name="person" size={40} color={colors.primary} />
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
