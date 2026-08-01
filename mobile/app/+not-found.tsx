import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { Button } from '@components/common/Button';
import { spacing } from '@theme/spacing';

export default function NotFoundScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[typo.h2, { color: colors.text }]}>페이지를 찾을 수 없어요</Text>
      <Button
        title="홈으로 가기"
        onPress={() => router.replace('/(tabs)/signals')}
        style={{ marginTop: spacing.xl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
