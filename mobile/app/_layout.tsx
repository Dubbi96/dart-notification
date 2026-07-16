import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { queryClient } from '@services/queryClient';
import { ThemeContext, getTheme, useAppColorScheme, useTextScale, getPaperTheme } from '@theme';
import { SnackbarProvider } from '@components/common/SnackbarProvider';
import { DialogProvider } from '@components/common/DialogProvider';
import { OfflineBanner } from '@components/common/OfflineBanner';
import { IosGateSurvey } from '@components/survey/IosGateSurvey';
import { useNotificationSetup } from '@hooks/useNotificationSetup';
import { configureOnlineManager } from '@services/onlineManager';
import { recordFunnelStep } from '@services/funnel.service';
import { applyGlobalTextScalingPolicy } from '@utils/textScaling';

// DAR-224: 앱 전역 ErrorBoundary. Expo Router가 이 named export 를 감지해
// 루트 서브트리(모든 화면)의 렌더타임 에러를 격리·폴백 렌더한다 → 프로덕션 백지/크래시 차단.
export { ErrorFallback as ErrorBoundary } from '@components/common/ErrorFallback';

// DAR-173: React Query onlineManager 를 NetInfo 에 연동(모듈 로드 1회).
// 단절→복구 시 refetchOnReconnect 로 stale 쿼리 자동 재요청.
configureOnlineManager();

// DAR-304: 시스템 폰트 배율 더블 적용 제거(첫 렌더 전 1회). typography 가 PixelRatio
// 배율을 fontSize·lineHeight 에 이미 반영하므로 RN <Text>/<TextInput> 의 중복
// allowFontScaling 을 전역으로 끈다 → 비율 보존·받침 미잘림·레이아웃 안정.
applyGlobalTextScalingPolicy();

function AppContent() {
  const colorScheme = useAppColorScheme();
  const textScale = useTextScale();
  const theme = getTheme(colorScheme, textScale);
  const paperTheme = getPaperTheme(colorScheme);

  useNotificationSetup();

  // 갭분석 W15 ③: 온보딩 퍼널 1단계(install) 계측 — 설치당 1회, fire-and-forget(실패 무시).
  // 측정 전용 표면 — 렌더·네비게이션 흐름에 어떤 영향도 없다(온보딩 UI 재설계 금지).
  useEffect(() => {
    void recordFunnelStep('install', undefined, { once: true });
  }, []);

  return (
    <PaperProvider theme={paperTheme}>
      <ThemeContext.Provider value={theme}>
        <DialogProvider>
        <SnackbarProvider>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <View style={styles.appShell}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/sign-in" />
            <Stack.Screen name="kakao" options={{ animation: 'none' }} />
            <Stack.Screen name="disclosures/index" />
            <Stack.Screen name="search/index" />
            <Stack.Screen
              name="disclosure/[id]"
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="disclosure/viewer"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen name="intro/index" options={{ animation: 'fade' }} />
            <Stack.Screen name="onboarding/index" />
            <Stack.Screen name="settings-detail/watchlist" />
            <Stack.Screen name="settings-detail/notification-settings" />
            <Stack.Screen name="settings-detail/profile" />
            <Stack.Screen name="settings-detail/saved-disclosures" />
            <Stack.Screen name="settings-detail/collection-status" />
            <Stack.Screen name="settings-detail/ai-cost" />
            <Stack.Screen name="settings-detail/support" />
            <Stack.Screen name="portfolio/trade-history" />
            <Stack.Screen name="portfolio/auto-trading" />
            <Stack.Screen name="portfolio/backtest-track-record" />
            <Stack.Screen name="portfolio/strategy/[key]" />
            <Stack.Screen name="company/[corpCode]" />
            <Stack.Screen name="philosophy/index" />
            <Stack.Screen name="philosophy/[id]" />
            <Stack.Screen name="event-stats/index" />
            <Stack.Screen name="legal/terms" />
            <Stack.Screen name="legal/privacy" />
            <Stack.Screen name="legal/data-sources" />
          </Stack>
          {/* DAR-173: 전역 오프라인 배너 — 절대 위치 오버레이라 화면 트리 위에 떠야 하므로 Stack 뒤. */}
          <OfflineBanner />
          {/* DAR-516: iOS 게이트 1문항 설문 — iOS+인증+미응답에서 1회 노출(Portal). 안드로이드=null. */}
          <IosGateSurvey />
          </View>
        </SnackbarProvider>
        </DialogProvider>
      </ThemeContext.Provider>
    </PaperProvider>
  );
}

export default function RootLayout() {
  return (
    // DAR-114: 루트 GestureHandlerRootView(flex:1) 추가.
    // 누락 시 (1) 화면 트리에 높이 경계가 없어 flex:1 FlatList가 높이 0으로 붕괴→아이템 미렌더,
    // (2) gesture-handler 미초기화로 스크롤/드래그 불가 — 앱 전역 리스트·스크롤 장애의 근본 원인.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
  },
});
