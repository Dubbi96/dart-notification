import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { ThemeContext, getTheme, useAppColorScheme, getPaperTheme } from '@theme';

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
  const theme = getTheme(colorScheme);

  const paperTheme = getPaperTheme(colorScheme);

  return (
    <PaperProvider theme={paperTheme}>
      <ThemeContext.Provider value={theme}>
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
        <Stack.Screen
          name="disclosure/[id]"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="settings-detail/watchlist" />
        <Stack.Screen name="settings-detail/notification-settings" />
        <Stack.Screen name="settings-detail/profile" />
        </Stack>
      </ThemeContext.Provider>
    </PaperProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
