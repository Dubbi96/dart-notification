import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Surface, Chip } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { useAuthStore } from '@stores/authStore';

const SCREEN_WIDTH = Dimensions.get('window').width;

// 거장 4철학 목록 (P-A 시드 — 정적 표시용)
const PHILOSOPHERS = [
  { name: '워런 버핏', tags: ['가치투자', '장기보유'] },
  { name: '피터 린치', tags: ['성장주', '텐배거'] },
  { name: '조엘 그린블라트', tags: ['마법공식', '초과수익'] },
  { name: '드러켄밀러', tags: ['매크로', '추세추종'] },
] as const;

// 정적 목업 공시 데이터 (실데이터 없을 때 폴백 — 항상 '예시' 표시)
const MOCK_DISCLOSURES = [
  { corp: '삼성전자', type: '자기주식 취득', time: '2분 전', badge: '주요사항' },
  { corp: 'SK하이닉스', type: '유상증자 결정', time: '8분 전', badge: '주요사항' },
  { corp: 'NAVER', type: '분기 실적 발표', time: '15분 전', badge: '정기보고' },
] as const;

async function markIntroSeen() {
  await SecureStore.setItemAsync('hasSeenIntro', 'true');
}

interface SlideProps {
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}

function Slide1({ colors, typo }: SlideProps) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.slideInner}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
          <Feather name="bell" size={40} color={colors.primary} />
        </View>

        <Text style={[typo.h1, { color: colors.text, textAlign: 'center', marginTop: spacing.xl }]}>
          실시간 공시를{'\n'}바로 확인하세요
        </Text>
        <Text
          style={[
            typo.body,
            { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
          ]}
        >
          DART에 등록된 공시가 올라오면{'\n'}즉시 알려드립니다
        </Text>

        {/* 예시 공시 목록 */}
        <View style={styles.mockList}>
          <View
            style={[
              styles.exampleBadgeRow,
              { backgroundColor: colors.primaryLight, borderRadius: radius.full },
            ]}
          >
            <Feather name="info" size={12} color={colors.primary} />
            <Text style={[typo.small, { color: colors.primary }]}>예시</Text>
          </View>

          {MOCK_DISCLOSURES.map((d, i) => (
            <Surface
              key={i}
              elevation={1}
              style={[
                styles.mockDisclosureCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.disclosureRow}>
                <View style={styles.disclosureLeft}>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>{d.corp}</Text>
                  <Text style={[typo.small, { color: colors.textSecondary, marginTop: 2 }]}>
                    {d.type}
                  </Text>
                </View>
                <View style={styles.disclosureRight}>
                  <View
                    style={[
                      styles.badgePill,
                      { backgroundColor: colors.primaryLight },
                    ]}
                  >
                    <Text style={[typo.small, { color: colors.primary }]}>{d.badge}</Text>
                  </View>
                  <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
                    {d.time}
                  </Text>
                </View>
              </View>
            </Surface>
          ))}
        </View>
      </View>
    </View>
  );
}

function Slide2({ colors, typo }: SlideProps) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.slideInner}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
          <Feather name="trending-up" size={40} color={colors.primary} />
        </View>

        <Text style={[typo.h1, { color: colors.text, textAlign: 'center', marginTop: spacing.xl }]}>
          30초 만에{'\n'}투자 판단 받아보기
        </Text>
        <Text
          style={[
            typo.body,
            { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
          ]}
        >
          공시 발생 즉시 AI가 매수 점수를{'\n'}분석해 드립니다
        </Text>

        {/* 예시 BuyScoreCard */}
        <View style={styles.mockCardWrap}>
          <View style={styles.exampleBadgeRow}>
            <View
              style={[
                styles.exampleBadgeRow,
                { backgroundColor: colors.primaryLight, borderRadius: radius.full },
              ]}
            >
              <Feather name="info" size={12} color={colors.primary} />
              <Text style={[typo.small, { color: colors.primary }]}>예시</Text>
            </View>
          </View>

          <Surface
            elevation={2}
            style={[
              styles.mockScoreCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.scoreCardHeader}>
              <View style={styles.scoreCardHeaderLeft}>
                <Chip
                  compact
                  mode="flat"
                  style={{ backgroundColor: colors.surfaceSecondary }}
                  textStyle={[typo.small, { color: colors.textSecondary }]}
                >
                  유상증자
                </Chip>
                <Text style={[typo.bodyMedium, { color: colors.text }]}>삼성전자</Text>
              </View>
              <Chip
                compact
                mode="flat"
                style={{ backgroundColor: colors.successSurface }}
                textStyle={[typo.small, { color: colors.success, fontWeight: '700' }]}
              >
                강한매수
              </Chip>
            </View>

            <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              005930 · 유상증자 결정
            </Text>

            <View style={{ marginTop: spacing.md }}>
              <ScoreGauge
                score={82}
                kind="buy"
                statusText="강한매수"
                accessibilityHidden
                animated={false}
              />
            </View>

            <Text
              style={[
                typo.small,
                { color: colors.textSecondary, marginTop: spacing.sm },
              ]}
              numberOfLines={2}
            >
              PBR 1.2배 구간, ROE 12% 이상 유지 — 저평가 가능성 있음
            </Text>

            {/* 면책 */}
            <View
              style={[
                styles.disclaimerMini,
                { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm },
              ]}
            >
              <Feather name="alert-triangle" size={11} color={colors.textTertiary} />
              <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]}>
                AI 참고 정보 · 투자자문 아님
              </Text>
            </View>
          </Surface>
        </View>
      </View>
    </View>
  );
}

function Slide3({ colors, typo }: SlideProps) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.slideInner}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
          <Feather name="award" size={40} color={colors.primary} />
        </View>

        <Text style={[typo.h1, { color: colors.text, textAlign: 'center', marginTop: spacing.xl }]}>
          거장의 투자 철학으로{'\n'}분석합니다
        </Text>
        <Text
          style={[
            typo.body,
            { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
          ]}
        >
          버핏·린치·그린블라트·드러켄밀러의{'\n'}기준으로 종목 적합도를 계산합니다
        </Text>

        <View style={styles.philosophyGrid}>
          {PHILOSOPHERS.map((p) => (
            <Surface
              key={p.name}
              elevation={1}
              style={[
                styles.philosophyCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View
                style={[styles.philosophyIconWrap, { backgroundColor: colors.primaryLight }]}
              >
                <Feather name="user" size={20} color={colors.primary} />
              </View>
              <Text
                style={[typo.captionMedium, { color: colors.text, marginTop: spacing.sm }]}
              >
                {p.name}
              </Text>
              <View style={styles.tagRow}>
                {p.tags.map((tag) => (
                  <View
                    key={tag}
                    style={[styles.tagPill, { backgroundColor: colors.primaryLight }]}
                  >
                    <Text style={[typo.small, { color: colors.primary }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            </Surface>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function GuestIntroScreen() {
  const { colors, typography: typo } = useTheme();
  const enterGuest = useAuthStore((s) => s.enterGuest);
  const [currentIndex, setCurrentIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const slides = [
    { key: 'slide1', component: Slide1 },
    { key: 'slide2', component: Slide2 },
    { key: 'slide3', component: Slide3 },
  ];

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useMemo(() => ({ viewAreaCoveragePercentThreshold: 50 }), []);

  const goNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  }, [currentIndex, slides.length]);

  const handleKakaoStart = useCallback(async () => {
    await markIntroSeen();
    router.replace('/auth/sign-in');
  }, []);

  const handleGuest = useCallback(async () => {
    await markIntroSeen();
    enterGuest();
    router.replace('/(tabs)/home');
  }, [enterGuest]);

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      accessibilityLabel="공시온 서비스 소개 캐러셀"
    >
      {/* 슬라이드 */}
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <item.component colors={colors} typo={typo} />
        )}
        style={styles.list}
        accessibilityLabel={`슬라이드 ${currentIndex + 1} / ${slides.length}`}
      />

      {/* 하단 고정 영역 */}
      <View style={styles.footer}>
        {/* 페이지 닷 */}
        <View style={styles.dots} accessibilityElementsHidden>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === currentIndex ? colors.primary : colors.border,
                  width: i === currentIndex ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>

        {isLastSlide ? (
          /* 마지막 슬라이드 CTA */
          <View style={styles.ctaGroup}>
            <Button
              title="카카오로 시작"
              onPress={handleKakaoStart}
              fullWidth
              size="lg"
            />
            <TouchableOpacity
              style={styles.guestButton}
              onPress={handleGuest}
              accessibilityRole="button"
              accessibilityLabel="로그인 없이 둘러보기"
            >
              <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>
                둘러보기
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* 다음 슬라이드 네비게이션 */
          <View style={styles.navGroup}>
            <Button
              title="다음"
              onPress={goNext}
              fullWidth
              size="lg"
            />
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleKakaoStart}
              accessibilityRole="button"
              accessibilityLabel="소개 건너뛰고 카카오 로그인으로 이동"
            >
              <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>
                건너뛰기
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  slide: {
    flex: 1,
  },
  slideInner: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['2xl'],
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mockList: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  exampleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  mockDisclosureCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.base,
  },
  disclosureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  disclosureLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  disclosureRight: {
    alignItems: 'flex-end',
  },
  badgePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  mockCardWrap: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
  mockScoreCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  scoreCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scoreCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  disclaimerMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  philosophyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  philosophyCard: {
    width: (SCREEN_WIDTH - spacing.xl * 2 - spacing.sm) / 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    alignItems: 'flex-start',
  },
  philosophyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  tagPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['2xl'],
    paddingTop: spacing.base,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  ctaGroup: {
    gap: spacing.sm,
  },
  navGroup: {
    gap: spacing.sm,
  },
  guestButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
});
