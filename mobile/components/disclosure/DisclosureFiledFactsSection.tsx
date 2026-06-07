import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, FlatList } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ApiErrorState } from '@components/common/StateView';
import { useDisclosureFiledFacts } from '@hooks/useDisclosures';
import { factLabel, formatFiledFactValue } from '@utils/filedFacts';

import type { FiledFact } from '@app-types/disclosure.types';

// 공시 상세 '본문 핵심 수치' 섹션 (DAR-112, 패널 v5 #8).
//  - useDisclosureFiledFacts로 DAR-95 적재 정량 fact(계약금액·전환가·배당성향 등)를 노출.
//    신호·AI 분석의 정량 근거를 화면에서 투명하게 보여준다(여태 모바일 노출 0).
//  - 3상태: 로딩(스켈레톤)·에러(ApiErrorState+재시도)·빈(추출 fact 없음 정직 안내).
//  - 많을 때 FlatList로 렌더. 테마 토큰만 사용(하드코딩 색상 0). 읽기 전용.

/** 스켈레톤용 pulse (DisclosureAiAnalysisSection 패턴 — opacity 0.4→1→0.4, 1.5s). */
function usePulse() {
  const [opacity] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function SectionFrame({ children }: { children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={0}
      style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel="본문 핵심 수치 섹션"
    >
      <View style={styles.header}>
        <Feather name="bar-chart-2" size={16} color={colors.primary} />
        <Text
          style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}
          accessibilityRole="header"
        >
          본문 핵심 수치
        </Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.xs }]}>
        공시 원문에서 추출한 정량값입니다. 신호·분석의 근거로 참고하세요.
      </Text>
      {children}
    </Surface>
  );
}

function LoadingSkeleton() {
  const { colors } = useTheme();
  const opacity = usePulse();
  const row = (key: string) => (
    <Animated.View
      key={key}
      style={[
        styles.skeletonRow,
        { opacity, backgroundColor: colors.surfaceSecondary },
      ]}
    />
  );
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="본문 핵심 수치 불러오는 중">
      {row('s1')}
      {row('s2')}
      {row('s3')}
    </View>
  );
}

function FactRow({ fact }: { fact: FiledFact }) {
  const { colors, typography: typo } = useTheme();
  const display = formatFiledFactValue(fact);
  if (!display) return null;
  const label = factLabel(fact.factKey);
  return (
    <View
      style={[styles.factRow, { borderBottomColor: colors.borderLight }]}
      accessibilityLabel={`${label} ${display}`}
    >
      <Text style={[typo.caption, styles.factLabel, { color: colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.md }]}>
        {display}
      </Text>
    </View>
  );
}

export function DisclosureFiledFactsSection({ rcpNo }: { rcpNo: string }) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useDisclosureFiledFacts(rcpNo);

  if (isLoading) {
    return (
      <SectionFrame>
        <LoadingSkeleton />
      </SectionFrame>
    );
  }

  if (isError) {
    return (
      <SectionFrame>
        <View style={styles.stateBox}>
          <ApiErrorState
            error={error}
            title="핵심 수치를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            onRetry={refetch}
          />
        </View>
      </SectionFrame>
    );
  }

  // 표시 가능한(포맷된 값이 있는) fact만 추림 — 빈/비정상 값은 제외.
  const facts = (data ?? []).filter((f) => formatFiledFactValue(f).length > 0);

  if (facts.length === 0) {
    return (
      <SectionFrame>
        <View style={styles.emptyBox}>
          <Feather name="bar-chart-2" size={32} color={colors.textTertiary} />
          <Text
            style={[typo.bodyMedium, styles.centerText, { color: colors.text, marginTop: spacing.sm }]}
          >
            추출된 본문 수치가 없습니다
          </Text>
          <Text
            style={[
              typo.caption,
              styles.centerText,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            이 공시는 정량 수치가 표준화되지 않았거나, 본문에 해당 항목이 없습니다.
          </Text>
        </View>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame>
      <FlatList
        data={facts}
        scrollEnabled={false}
        keyExtractor={(f) => `${f.factKey}-${f.sectionPath ?? ''}`}
        renderItem={({ item }) => <FactRow fact={item} />}
        ListFooterComponent={
          <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
            DART 공시 원문 기반 추출값이며, 일부 항목은 누락·근사일 수 있습니다.
          </Text>
        }
      />
    </SectionFrame>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  stateBox: {
    minHeight: 200,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  skeletonRow: {
    height: 16,
    marginTop: spacing.sm,
    borderRadius: radius.sm,
  },
  factLabel: {
    flex: 1,
  },
  centerText: {
    textAlign: 'center',
  },
});
