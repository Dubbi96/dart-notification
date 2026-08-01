import React from 'react';
import { Redirect } from 'expo-router';
import { SHOW_TRADING } from '@utils/tradingVisibility';

// DAR-549: 트레이딩 라우트 진입 가드(HOC).
//
// 첫 게시(Play) 빌드(SHOW_TRADING=false)에서 포트폴리오·자동매매·체결내역·백테스트·전략 화면은
// 탭바에서 숨겨지지만(href:null), 라우트 자체는 네비게이터에 남아 딥링크·잔존 링크로 직접 진입할 수
// 있다. 이 가드로 진입 즉시 홈으로 리다이렉트한다(이슈 요구: "진입 시 홈 리다이렉트").
//
// HOC 로 감싸는 이유: 리다이렉트를 내부 화면의 훅/쿼리보다 **먼저** 판정하기 위함.
// 화면 본문에서 조건부 early-return 하면 rules-of-hooks 위반이거나 불필요한 데이터 페치가
// 발생한다. 래퍼 컴포넌트는 훅을 호출하지 않으므로 SHOW_TRADING=false 시 내부 화면을 아예
// 마운트하지 않는다(쿼리 미발화). SHOW_TRADING 은 빌드 상수라 렌더 간 분기 순서도 고정된다.
export function withTradingGuard<P extends object>(
  Inner: React.ComponentType<P>,
): React.ComponentType<P> {
  function TradingGuarded(props: P) {
    if (!SHOW_TRADING) {
      return <Redirect href="/(tabs)/signals" />;
    }
    return <Inner {...props} />;
  }
  TradingGuarded.displayName = `withTradingGuard(${Inner.displayName ?? Inner.name ?? 'Screen'})`;
  return TradingGuarded;
}
