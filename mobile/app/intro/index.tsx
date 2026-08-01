import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  type ViewToken,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Surface, Chip } from 'react-native-paper';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { useAuthStore } from '@stores/authStore';
import { recordFunnelStep } from '@services/funnel.service';

const SCREEN_WIDTH = Dimensions.get('window').width;

// 거장 4철학 목록 (P-A 시드 — 정적 표시용)
const PHILOSOPHERS = [
  { name: '워런 버핏', tags: ['가치투자', '장기보유'] },
  { name: '피터 린치', tags: ['성장주', '텐배거'] },
  { name: '조엘 그린블라트', tags: ['마법공식', '초과수익'] },
  { name: '드러켄밀러', tags: ['매크로', '추세추종'] },
] as const;

// 정적 목업 공시 데이터 (가상 종목 — 실추천 오해 방지·항상 '예시' 표시)
const MOCK_DISCLOSURES = [
  { corp: '○○전자', type: '자기주식 취득', time: '2분 전', badge: '주요사항' },
  { corp: '△△바이오', type: '유상증자 결정', time: '8분 전', badge: '주요사항' },
  { corp: '□□에너지', type: '분기 실적 발표', time: '15분 전', badge: '정기보고' },
] as const;

async function markIntroSeen() {
  await SecureStore.setItemAsync('hasSeenIntro', 'true');
}

interface SlideProps {
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}

// 슬라이드 공통 셸 — 콘텐츠를 세로 ScrollView로 감싸 소형 화면·Dynamic Type 확대 시
// 하단 클리핑을 방지한다(A-INTRO-1). 가로 페이징 FlatList와 축이 달라 충돌하지 않는다.
function SlideShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <ScrollView
        style={styles.slideScroll}
        contentContainerStyle={styles.slideInner}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Slide1({ colors, typo }: SlideProps) {
  return (
    <SlideShell>
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
          <Text
            style={[typo.small, { color: colors.primary }]}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            예시
          </Text>
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
                <View style={[styles.badgePill, { backgroundColor: colors.primaryLight }]}>
                  <Text
                    style={[typo.small, { color: colors.primary }]}
                    maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  >
                    {d.badge}
                  </Text>
                </View>
                <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
                  {d.time}
                </Text>
              </View>
            </View>
          </Surface>
        ))}
      </View>
    </SlideShell>
  );
}

function Slide2({ colors, typo }: SlideProps) {
  return (
    <SlideShell>
      <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
        <Feather name="trending-up" size={40} color={colors.primary} />
      </View>

      {/* D1(L-4): '투자 판단 받아보기' 단정형 → 참고 정보 제공으로 교정(약관 '참고 자료' 원칙과 톤 일치). */}
      <Text style={[typo.h1, { color: colors.text, textAlign: 'center', marginTop: spacing.xl }]}>
        투자 판단에 참고할 신호를{'\n'}30초 만에 받아보세요
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
            <Text
              style={[typo.small, { color: colors.primary }]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              예시
            </Text>
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
              <Text style={[typo.bodyMedium, { color: colors.text }]}>○○전자</Text>
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
            예시 종목 · 유상증자 결정
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
            style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}
            numberOfLines={2}
          >
            저PBR·고ROE 구간 — 저평가 가능성 있음 (예시)
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
    </SlideShell>
  );
}

function Slide3({ colors, typo }: SlideProps) {
  return (
    <SlideShell>
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
            <View style={[styles.philosophyIconWrap, { backgroundColor: colors.primaryLight }]}>
              <Feather name="user" size={20} color={colors.primary} />
            </View>
            <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.sm }]}>
              {p.name}
            </Text>
            <View style={styles.tagRow}>
              {p.tags.map((tag) => (
                <View key={tag} style={[styles.tagPill, { backgroundColor: colors.primaryLight }]}>
                  <Text
                    style={[typo.small, { color: colors.primary }]}
                    maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  >
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          </Surface>
        ))}
      </View>
    </SlideShell>
  );
}

export default function GuestIntroScreen() {
  const { colors, typography: typo } = useTheme();
  const enterGuest = useAuthStore((s) => s.enterGuest);
  const [currentIndex, setCurrentIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  // 갭분석 W15 ③: 온보딩 퍼널 2단계(intro) 계측 — 설치당 1회, fire-and-forget(실패 무시).
  useEffect(() => {
    void recordFunnelStep('intro', undefined, { once: true });
  }, []);

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

  // DAR-472: 가로 페이징 캐러셀 renderItem 을 useCallback 으로 분리(테마 변경 시에만 재생성) —
  // 매 렌더마다 새 함수가 생겨 슬라이드가 불필요하게 재마운트되던 것을 방지한다.
  const renderSlide = useCallback<ListRenderItem<(typeof slides)[number]>>(
    ({ item }) => <item.component colors={colors} typo={typo} />,
    [colors, typo],
  );

  // 모든 슬라이드 폭이 SCREEN_WIDTH 로 고정 → getItemLayout 으로 오프셋을 즉시 계산해
  // scrollToIndex 가 측정 지연 없이 정확히 동작하도록 한다(A-INTRO-3).
  const getItemLayout = useCallback(
    (_data: ArrayLike<unknown> | null | undefined, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    [],
  );

  const goNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  }, [currentIndex, slides.length]);

  // 로그인 화면(카카오 로그인·둘러보기 선택)으로 이동. 인트로에서 카카오 인증을 직접
  // 수행하지 않으므로 CTA 라벨은 '시작하기'로 동작과 일치시킨다(A-NAV-1).
  const handleStart = useCallback(async () => {
    await markIntroSeen();
    router.replace('/auth/sign-in');
  }, []);

  const handleGuest = useCallback(async () => {
    await markIntroSeen();
    enterGuest();
    router.replace('/(tabs)/signals');
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
        getItemLayout={getItemLayout}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={renderSlide}
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
                  backgroundColor: i === currentIndex ? colors.primary : colors.border,
                  width: i === currentIndex ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>

        {isLastSlide ? (
          /* 마지막 슬라이드 CTA */
          <View style={styles.ctaGroup}>
            <Button title="시작하기" onPress={handleStart} fullWidth size="lg" />
            <TouchableOpacity
              style={styles.guestButton}
              onPress={handleGuest}
              accessibilityRole="button"
              accessibilityLabel="로그인 없이 둘러보기"
            >
              <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>둘러보기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* 다음 슬라이드 네비게이션 */
          <View style={styles.navGroup}>
            <Button title="다음" onPress={goNext} fullWidth size="lg" />
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleStart}
              accessibilityRole="button"
              accessibilityLabel="소개 건너뛰고 시작 화면으로 이동"
            >
              <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>건너뛰기</Text>
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
  slideScroll: {
    flex: 1,
  },
  // ScrollView contentContainerStyle: flexGrow 로 짧은 콘텐츠는 채우고, 길면 스크롤 허용.
  // paddingBottom 으로 하단 클리핑 방지(A-INTRO-1).
  slideInner: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.xl,
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
