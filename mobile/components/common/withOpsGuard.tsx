import React from 'react';
import { Redirect } from 'expo-router';
import { SHOW_OPS } from '@utils/opsVisibility';

// DAR-558: 내부 운영(ops) 라우트 진입 가드(HOC) — withTradingGuard.tsx(DAR-549)와 동일 구조.
//
// 첫 게시(Play) 빌드(SHOW_OPS=false)에서 AI 비용/거버넌스·수집 현황은 설정 화면에서 숨겨지지만,
// 라우트 자체는 네비게이터에 남아 딥링크·잔존 링크로 직접 진입할 수 있다. 이 가드로 진입 즉시
// 설정 탭으로 리다이렉트한다.
export function withOpsGuard<P extends object>(
  Inner: React.ComponentType<P>,
): React.ComponentType<P> {
  function OpsGuarded(props: P) {
    if (!SHOW_OPS) {
      return <Redirect href="/(tabs)/settings" />;
    }
    return <Inner {...props} />;
  }
  OpsGuarded.displayName = `withOpsGuard(${Inner.displayName ?? Inner.name ?? 'Screen'})`;
  return OpsGuarded;
}
