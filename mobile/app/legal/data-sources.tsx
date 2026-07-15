import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { type ThemeColors } from '@theme/colors';
import { type Typography } from '@theme/typography';
import { spacing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';

// W2 컴플라이언스(M0 정책 §4): 데이터 출처 화면 — 시세·지수·공시 데이터의 출처 기관,
// 지연(실시간 아님) 고지, 면책 문구를 한 곳에 명시한다. legal/terms.tsx 패턴 준수.

export default function DataSourcesScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="데이터 출처" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.lg }]}>
          최종 갱신일: 2026년 7월 16일
        </Text>

        <Section title="개요" colors={colors} typo={typo}>
          공시on(이하 &quot;서비스&quot;)이 화면에 표시하는 시세·지수·공시 데이터의 출처 기관과 제공
          조건, 지연 가능성, 이용 시 유의사항을 안내합니다.
        </Section>

        <Section title="1. 시세·지수 데이터 — 한국거래소(KRX)" colors={colors} typo={typo}>
          {`① 일봉 차트(장 마감 종가), 시장지수(KOSPI·KOSDAQ), ETF 관련 데이터는 한국거래소(KRX) 정보데이터시스템에서 수집합니다.
② 해당 데이터는 거래일 장 마감 후 확정되는 종가 기준 데이터로, 실시간 호가·체결 정보가 아닙니다.
③ 각 차트·지수 표면에는 기준 시점(예: '거래일 종가 기준', 'YYYY.MM.DD 종가')이 함께 표기됩니다.`}
        </Section>

        <Section title="2. 실시간·당일 시세 — 한국투자증권(KIS)" colors={colors} typo={typo}>
          {`① 현재가와 당일 분봉 차트는 한국투자증권(KIS) OpenAPI를 통해 제공받은 시세를 기준으로 합니다.
② 해당 시세는 수집·전송·처리 과정에서 지연될 수 있는 지연 데이터이며, 거래소의 실제 체결가·호가와 차이가 있을 수 있습니다.
③ '실시간'으로 표기된 값도 네트워크·기기 시계 상태에 따라 실제 시점과 어긋날 수 있으며, 각 화면의 갱신 시각·기준 라벨을 함께 확인해 주세요.`}
        </Section>

        <Section title="3. 공시 정보 — 금융감독원 DART" colors={colors} typo={typo}>
          {`① 공시 목록·원문·첨부 정보는 금융감독원 전자공시시스템(DART) OpenAPI를 통해 수집합니다.
② 공시 원문의 저작권은 금융감독원 전자공시시스템에 있으며, 서비스는 이를 가공·요약하여 제공합니다.
③ 수집·전송 과정에서 공시 게시 시점과 알림·표시 시점 사이에 지연이 발생할 수 있습니다.`}
        </Section>

        <Section title="4. 지연·오류 고지" colors={colors} typo={typo}>
          {`① 서비스가 표시하는 모든 데이터는 수집·전송·처리 과정에서 지연·누락·오류가 발생할 수 있습니다.
② 서비스는 데이터의 기준 시점을 각 화면에 표기하여(예: '거래일 종가 기준', '서버 조회 시각', 'N분 전 갱신') 최신성 여부를 확인할 수 있도록 합니다.
③ 데이터 제공 기관의 사정에 따라 일부 데이터의 제공이 변경·중단될 수 있습니다.`}
        </Section>

        <Section title="5. 면책 문구" colors={colors} typo={typo}>
          {`① 서비스가 제공하는 시세·지수·공시 데이터는 투자 판단의 참고 자료이며, 서비스는 데이터의 정확성·완전성·적시성을 보장하지 않습니다.
② 본 데이터를 근거로 한 투자 결과에 대하여 서비스는 책임을 지지 않습니다. 투자에 대한 최종 판단과 책임은 이용자 본인에게 있습니다.
③ 실제 거래 전에는 이용 중인 증권사 및 공식 출처(한국거래소, 금융감독원 DART)에서 데이터를 직접 확인하시기 바랍니다.`}
        </Section>

        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xl }]}>
          데이터 출처: 한국거래소(KRX) · 한국투자증권(KIS) · 금융감독원 DART
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children, colors, typo }: { title: string; children: string; colors: ThemeColors; typo: Typography }) {
  return (
    <View style={styles.section}>
      <Text style={[typo.bodyMedium, { color: colors.text, marginBottom: spacing.sm }]}>{title}</Text>
      <Text style={[typo.body, { color: colors.textSecondary, lineHeight: 22 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  section: {
    marginBottom: spacing.xl,
  },
});
