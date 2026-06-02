import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

const DART_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=';

export default function DisclosureViewerScreen() {
  const { rcpNo, title } = useLocalSearchParams<{ rcpNo: string; title?: string }>();
  const { colors, typography: typo } = useTheme();
  const [isLoading, setIsLoading] = useState(true);

  const url = `${DART_VIEWER_URL}${rcpNo}`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* WebView */}
      <View style={styles.webviewContainer}>
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
              원문을 불러오는 중...
            </Text>
          </View>
        )}
        <WebView
          source={{ uri: url }}
          style={styles.webview}
          onLoadEnd={() => setIsLoading(false)}
          startInLoadingState={false}
          javaScriptEnabled
          domStorageEnabled
          scalesPageToFit
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  headerButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  webviewContainer: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  webview: {
    flex: 1,
  },
});
