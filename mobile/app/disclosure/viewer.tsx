import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { spacing, sizing } from '@theme/spacing';
import { ErrorState } from '@components/common/StateView';

const DART_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=';
// 외부 DART 서버 응답이 없을 때(다운·기내모드) 무한 스피너를 막는 상한.
const LOAD_TIMEOUT_MS = 20000;

export default function DisclosureViewerScreen() {
  const { rcpNo, title } = useLocalSearchParams<{ rcpNo: string; title?: string }>();
  const { colors, typography: typo } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = `${DART_VIEWER_URL}${rcpNo}`;

  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 로딩이 시작될 때마다 타임아웃을 건다. 응답이 끝나면(onLoadEnd/onError) 해제한다.
  // 외부 WebView 유일 화면이라 다른 화면의 React Query 타임아웃 가드가 적용되지 않음 → 직접 가드.
  useEffect(() => {
    if (isLoading && !hasError) {
      timeoutRef.current = setTimeout(() => {
        setIsLoading(false);
        setHasError(true);
      }, LOAD_TIMEOUT_MS);
    }
    return clearLoadTimeout;
  }, [isLoading, hasError, clearLoadTimeout]);

  const handleError = useCallback(() => {
    clearLoadTimeout();
    setIsLoading(false);
    setHasError(true);
  }, [clearLoadTimeout]);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  }, []);

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — DAR-316: '첨부'성 원문 뷰어도 앱 표준 좌상단 < 복귀 어포던스로 통일
          (DAR-294/295/303). 우상단 X(모달 닫기) 패턴을 제거해 전 상세/첨부 화면과 위치·형태 일관. */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Ionicons name="chevron-back" size={sizing.icon.lg} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[typo.bodyMedium, styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title ?? '공시 원문'}
        </Text>
        {/* 좌측 < 버튼과 대칭을 맞춰 제목을 중앙 정렬로 유지하는 우측 스페이서. */}
        <View style={styles.headerButton} />
      </View>

      {/* WebView */}
      <View style={styles.webviewContainer}>
        {hasError ? (
          <ErrorState
            icon="wifi-off"
            title="원문을 불러오지 못했습니다"
            description="DART 서버에 연결할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요."
            onRetry={handleRetry}
          />
        ) : (
          <>
            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                  원문을 불러오는 중...
                </Text>
              </View>
            )}
            <WebView
              ref={webViewRef}
              source={{ uri: url }}
              style={styles.webview}
              onLoadEnd={handleLoadEnd}
              onError={handleError}
              onHttpError={(e) => {
                // 하위 리소스 404가 정상 페이지를 에러로 만들지 않도록 메인 문서 실패만 처리.
                if (e.nativeEvent.url === url) {
                  handleError();
                }
              }}
              startInLoadingState={false}
              javaScriptEnabled
              domStorageEnabled
              scalesPageToFit
            />
          </>
        )}
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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  // 뒤로가기 44pt 보장(E-5): philosophy/company 헤더와 동일하게 minWidth/minHeight로 유효 터치
  // 영역을 sizing.minTouchTarget(44pt) 이상으로 통일한다(hitSlop 보정 불필요). 우측 스페이서도
  // 같은 스타일을 공유해 제목 중앙 정렬 대칭을 유지한다.
  headerButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    minWidth: sizing.minTouchTarget,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webviewContainer: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  webview: {
    flex: 1,
  },
});
