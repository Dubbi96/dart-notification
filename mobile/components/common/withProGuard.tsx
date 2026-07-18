import React from 'react';
import { Redirect } from 'expo-router';
import { SHOW_PRO_UPSELL } from '@utils/proVisibility';

// DAR-558: Pro 라우트 진입 가드(HOC) — withTradingGuard.tsx(DAR-549)와 동일 구조.
//
// 첫 게시(Play) 빌드(SHOW_PRO_UPSELL=false)에서 Pro 배너는 설정 화면에서 숨겨지지만, 라우트
// 자체는 네비게이터에 남아 딥링크·잔존 링크로 직접 진입할 수 있다. 이 가드로 진입 즉시 설정
// 탭으로 리다이렉트한다.
export function withProGuard<P extends object>(
  Inner: React.ComponentType<P>,
): React.ComponentType<P> {
  function ProGuarded(props: P) {
    if (!SHOW_PRO_UPSELL) {
      return <Redirect href="/(tabs)/settings" />;
    }
    return <Inner {...props} />;
  }
  ProGuarded.displayName = `withProGuard(${Inner.displayName ?? Inner.name ?? 'Screen'})`;
  return ProGuarded;
}
