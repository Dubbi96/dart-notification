import React from 'react';
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
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

export default function TermsScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          서비스 이용약관
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.lg }]}>
          시행일: 2026년 3월 9일
        </Text>

        <Section title="제1조 (목적)" colors={colors} typo={typo}>
          본 약관은 공시on(이하 "서비스")이 제공하는 DART 공시 알림 서비스의 이용과 관련하여
          서비스와 이용자 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.
        </Section>

        <Section title="제2조 (정의)" colors={colors} typo={typo}>
          {`① "서비스"란 공시on이 제공하는 DART 공시 실시간 알림, 공시 검색, 관심기업 관리 등 관련 제반 서비스를 의미합니다.
② "이용자"란 본 약관에 따라 서비스를 이용하는 자를 의미합니다.
③ "회원"이란 서비스에 회원가입을 하고 서비스를 이용하는 자를 의미합니다.`}
        </Section>

        <Section title="제3조 (약관의 효력 및 변경)" colors={colors} typo={typo}>
          {`① 본 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다.
② 서비스는 합리적인 사유가 발생할 경우 관련 법령에 위배되지 않는 범위에서 약관을 변경할 수 있으며, 변경된 약관은 공지 후 효력이 발생합니다.`}
        </Section>

        <Section title="제4조 (회원가입 및 계정)" colors={colors} typo={typo}>
          {`① 이용자는 카카오 소셜 로그인을 통해 회원가입을 할 수 있습니다.
② 회원은 1개의 계정만 생성할 수 있습니다.
③ 회원 정보에 변경이 있는 경우, 즉시 수정하여야 합니다.`}
        </Section>

        <Section title="제5조 (서비스의 제공)" colors={colors} typo={typo}>
          {`서비스는 다음과 같은 기능을 제공합니다:
• DART(전자공시시스템) 공시 정보 조회
• 관심 기업 등록 및 관리
• 공시 유형별 필터링 및 검색
• 실시간 푸시 알림
• 공시 북마크(저장) 기능`}
        </Section>

        <Section title="제6조 (서비스 이용의 제한)" colors={colors} typo={typo}>
          {`서비스는 다음 각 호에 해당하는 경우 서비스 이용을 제한할 수 있습니다:
① 타인의 정보를 도용한 경우
② 서비스 운영을 고의로 방해한 경우
③ 서비스를 이용하여 법령 또는 공서양속에 반하는 행위를 한 경우
④ 기타 서비스가 정한 이용 조건에 위반한 경우`}
        </Section>

        <Section title="제7조 (서비스의 변경 및 중단)" colors={colors} typo={typo}>
          {`① 서비스는 운영상, 기술상의 필요에 따라 제공하고 있는 서비스를 변경할 수 있습니다.
② 서비스는 천재지변, 시스템 장애 등 불가항력적 사유가 발생한 경우 서비스 제공을 일시적으로 중단할 수 있습니다.`}
        </Section>

        <Section title="제8조 (면책조항)" colors={colors} typo={typo}>
          {`① 서비스는 DART 공시 정보를 가공하여 제공하며, 정보의 정확성 및 완전성을 보장하지 않습니다.
② 서비스에서 제공하는 정보는 투자 판단의 참고 자료이며, 이를 근거로 한 투자 결과에 대해 서비스는 책임을 지지 않습니다.
③ 이용자는 공시 원문을 직접 확인하여 투자 의사결정을 내려야 합니다.`}
        </Section>

        <Section title="제9조 (지적재산권)" colors={colors} typo={typo}>
          {`① 서비스에 대한 저작권 및 지적재산권은 서비스에 귀속됩니다.
② DART 공시 원문의 저작권은 금융감독원 전자공시시스템에 있습니다.`}
        </Section>

        <Section title="제10조 (분쟁 해결)" colors={colors} typo={typo}>
          {`① 서비스와 이용자 간에 발생한 분쟁에 대해서는 대한민국 법률을 적용합니다.
② 서비스 이용과 관련하여 발생한 분쟁은 서울중앙지방법원을 관할 법원으로 합니다.`}
        </Section>

        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xl }]}>
          부칙: 본 약관은 2026년 3월 9일부터 시행합니다.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children, colors, typo }: { title: string; children: string; colors: any; typo: any }) {
  return (
    <View style={styles.section}>
      <Text style={[typo.bodyMedium, { color: colors.text, marginBottom: spacing.sm }]}>{title}</Text>
      <Text style={[typo.body, { color: colors.textSecondary, lineHeight: 22 }]}>{children}</Text>
    </View>
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
  section: {
    marginBottom: spacing.xl,
  },
});
