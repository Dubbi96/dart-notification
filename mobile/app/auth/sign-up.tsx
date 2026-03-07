import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Input } from '@components/common/Input';
import { Button } from '@components/common/Button';
import { useSignUp } from '@hooks/useAuth';

export default function SignUpScreen() {
  const { colors, typography: typo } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { mutate: signUp, isPending, error } = useSignUp();

  const handleSignUp = () => {
    if (!email || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('비밀번호 불일치', '비밀번호가 일치하지 않습니다.');
      return;
    }
    signUp({ email, password, name: name || undefined });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Back button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.form}>
            <Text style={[typo.h1, { color: colors.text }]}>회원가입</Text>
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing['2xl'] }]}>
              실시간 공시 알림을 시작하세요
            </Text>

            <Input
              label="이름"
              placeholder="이름을 입력하세요"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <Input
              label="이메일"
              placeholder="이메일을 입력하세요"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Input
              label="비밀번호"
              placeholder="비밀번호를 만드세요"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Input
              label="비밀번호 확인"
              placeholder="비밀번호를 다시 입력하세요"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            {error && (
              <Text style={[typo.small, { color: colors.error, marginTop: spacing.sm }]}>
                {(error as any)?.response?.data?.message || '회원가입에 실패했습니다. 다시 시도해주세요.'}
              </Text>
            )}

            <Button
              title="회원가입"
              onPress={handleSignUp}
              fullWidth
              size="lg"
              loading={isPending}
              style={{ marginTop: spacing.md }}
            />

            <View style={styles.signInRow}>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                이미 계정이 있으신가요?{' '}
              </Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text style={[typo.captionMedium, { color: colors.primary }]}>로그인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  backButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  form: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing['2xl'],
  },
});
