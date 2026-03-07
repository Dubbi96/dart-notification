import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Switch, Checkbox, Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { Input } from '@components/common/Input';
import { useNotificationSettings, useUpdateNotificationSettings } from '@hooks/useNotificationSettings';

const DISCLOSURE_TYPES = [
  { id: 'regular', label: '정기보고서', desc: '사업/분기/반기보고서' },
  { id: 'material', label: '주요사항보고', desc: '주요 기업 이벤트' },
  { id: 'acquisition', label: '지분변동', desc: '주식 거래' },
  { id: 'equity', label: '자본변동', desc: '증자/감자' },
  { id: 'other', label: '기타', desc: '기타 공시' },
];

export default function NotificationSettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { data: settings, isLoading } = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();

  const [pushEnabled, setPushEnabled] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState('');

  useEffect(() => {
    if (settings) {
      setPushEnabled(settings.isEnabled);
      setSelectedTypes(settings.disclosureTypes ?? []);
      setKeywords((settings.keywords ?? []).join(', '));
    }
  }, [settings]);

  const toggleType = (id: string) => {
    setSelectedTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const handleSave = () => {
    const keywordList = keywords
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    updateSettings.mutate(
      {
        disclosureTypes: selectedTypes,
        keywords: keywordList,
        isEnabled: pushEnabled,
      },
      {
        onSuccess: () => {
          Alert.alert('저장 완료', '알림 설정이 저장되었습니다.');
          router.back();
        },
        onError: () => {
          Alert.alert('오류', '설정 저장에 실패했습니다.');
        },
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
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
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          알림 설정
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Push toggle */}
        <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <View>
            <Text style={[typo.bodyMedium, { color: colors.text }]}>푸시 알림</Text>
            <Text style={[typo.small, { color: colors.textSecondary }]}>
              새 공시 알림 받기
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={setPushEnabled}
            color={colors.primary}
          />
        </View>

        {/* Disclosure Types */}
        <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md }]}>
          공시 유형
        </Text>
        {DISCLOSURE_TYPES.map((type, index) => {
          const isSelected = selectedTypes.includes(type.id);
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
                onPress={() => toggleType(type.id)}
                activeOpacity={0.7}
              >
                <View style={styles.typeContent}>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>{type.label}</Text>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>{type.desc}</Text>
                </View>
                <Checkbox
                  status={isSelected ? 'checked' : 'unchecked'}
                  onPress={() => toggleType(type.id)}
                  color={colors.primary}
                  uncheckedColor={colors.border}
                />
              </TouchableOpacity>
              {index < DISCLOSURE_TYPES.length - 1 && (
                <Divider style={{ backgroundColor: colors.borderLight }} />
              )}
            </React.Fragment>
          );
        })}

        {/* Keywords */}
        <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xl }]}>
          키워드
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
          쉼표로 구분하세요 (예: 배당, 합병, 주식분할)
        </Text>
        <Input
          placeholder="키워드를 입력하세요"
          value={keywords}
          onChangeText={setKeywords}
        />

        <Button
          title="설정 저장"
          onPress={handleSave}
          fullWidth
          size="lg"
          loading={updateSettings.isPending}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

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
