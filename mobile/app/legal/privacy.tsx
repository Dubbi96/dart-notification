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

export default function PrivacyScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          개인정보 처리방침
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.lg }]}>
          시행일: 2026년 3월 9일
        </Text>

        <Text style={[typo.body, { color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.xl }]}>
          공시on(이하 "서비스")은 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 등
          관련 법령을 준수합니다. 본 개인정보 처리방침은 서비스가 수집하는 개인정보의 항목,
          수집 목적, 보유 기간 등을 안내합니다.
        </Text>

        <Section title="1. 수집하는 개인정보 항목" colors={colors} typo={typo}>
          {`서비스는 회원가입 및 서비스 제공을 위해 다음 정보를 수집합니다:

[필수 항목]
• 카카오 계정 고유 식별자 (카카오 ID)
• 이름 (카카오 프로필 닉네임)
• 이메일 주소 (카카오 계정 이메일)

[자동 수집 항목]
• 기기 정보 (기기 식별자, OS 버전)
• 푸시 알림 토큰 (Expo Push Token)
• 서비스 이용 기록 (관심목록, 알림 설정)`}
        </Section>

        <Section title="2. 개인정보의 수집 및 이용 목적" colors={colors} typo={typo}>
          {`수집된 개인정보는 다음 목적으로 이용됩니다:

• 회원 식별 및 인증
• 맞춤형 공시 알림 서비스 제공
• 관심기업 관리 및 알림 발송
• 서비스 개선 및 통계 분석
• 고객 문의 및 불만 처리`}
        </Section>

        <Section title="3. 개인정보의 보유 및 이용 기간" colors={colors} typo={typo}>
          {`• 회원 탈퇴 시까지 보유하며, 탈퇴 즉시 파기합니다.
• 단, 관련 법령에 의해 보존할 필요가 있는 경우 해당 기간 동안 보관합니다:
  - 계약 또는 청약철회 등에 관한 기록: 5년
  - 소비자의 불만 또는 분쟁 처리에 관한 기록: 3년
  - 접속에 관한 기록: 3개월`}
        </Section>

        <Section title="4. 개인정보의 제3자 제공" colors={colors} typo={typo}>
          서비스는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다.
          다만, 이용자의 동의가 있거나 법령에 의해 요구되는 경우에는 예외로 합니다.
        </Section>

        <Section title="5. 개인정보의 처리 위탁" colors={colors} typo={typo}>
          {`서비스는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁합니다:

• Amazon Web Services (AWS): 서버 호스팅 및 데이터 저장
• Expo (Expo Application Services): 푸시 알림 발송`}
        </Section>

        <Section title="6. 이용자의 권리" colors={colors} typo={typo}>
          {`이용자는 언제든지 다음 권리를 행사할 수 있습니다:

• 개인정보 열람 요청
• 개인정보 수정 요청
• 개인정보 삭제 요청 (회원 탈퇴)
• 개인정보 처리 정지 요청

위 권리 행사는 앱 내 설정 또는 고객센터를 통해 가능합니다.`}
        </Section>

        <Section title="7. 개인정보의 파기" colors={colors} typo={typo}>
          {`서비스는 개인정보 보유 기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.

• 전자적 파일: 복구 불가능한 방법으로 영구 삭제
• 기타 기록물: 파쇄 또는 소각`}
        </Section>

        <Section title="8. 개인정보 보호책임자" colors={colors} typo={typo}>
          {`서비스의 개인정보 처리에 관한 업무를 총괄하는 개인정보 보호책임자는 다음과 같습니다:

• 책임자: 공시on 운영팀
• 이메일: support@gongsion.com

개인정보 침해에 대한 신고나 상담이 필요한 경우 아래 기관에 문의할 수 있습니다:
• 개인정보침해신고센터 (privacy.kisa.or.kr / 118)
• 개인정보분쟁조정위원회 (kopico.go.kr / 1833-6972)`}
        </Section>

        <Section title="9. 개인정보 처리방침 변경" colors={colors} typo={typo}>
          본 개인정보 처리방침은 법령, 정책 또는 서비스 변경에 따라 수정될 수 있으며,
          변경 시 앱 내 공지를 통해 안내합니다.
        </Section>

        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xl }]}>
          본 개인정보 처리방침은 2026년 3월 9일부터 시행합니다.
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
