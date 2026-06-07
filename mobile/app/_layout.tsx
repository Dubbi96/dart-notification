import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { ThemeContext, getTheme, useAppColorScheme, useTextScale, getPaperTheme } from '@theme';
import { SnackbarProvider } from '@components/common/SnackbarProvider';
import { DialogProvider } from '@components/common/DialogProvider';
import { useNotificationSetup } from '@hooks/useNotificationSetup';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function AppContent() {
  const colorScheme = useAppColorScheme();
  const textScale = useTextScale();
  const theme = getTheme(colorScheme, textScale);
  const paperTheme = getPaperTheme(colorScheme);

  useNotificationSetup();

  return (
    <PaperProvider theme={paperTheme}>
      <ThemeContext.Provider value={theme}>
        <DialogProvider>
        <SnackbarProvider>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
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
            <Stack.Screen name="portfolio/trade-history" />
            <Stack.Screen name="company/[corpCode]" />
            <Stack.Screen name="philosophy/index" />
            <Stack.Screen name="philosophy/[id]" />
            <Stack.Screen name="event-stats/index" />
            <Stack.Screen name="legal/terms" />
            <Stack.Screen name="legal/privacy" />
          </Stack>
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
