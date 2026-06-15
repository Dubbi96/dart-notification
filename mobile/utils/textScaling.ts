import * as React from 'react';

/**
 * DAR-304: 시스템 폰트 배율 더블 적용 제거.
 *
 * 근본 원인: `theme/index.ts`의 `useTextScale()`가 `PixelRatio.getFontScale()`(시스템
 * 배율)을 읽어 `makeTypography`로 typography 의 fontSize·lineHeight 에 **이미** 1회
 * 반영한다(둘 다 ×scale → 비율 보존). 그런데 RN 기본 `allowFontScaling=true`가 렌더
 * 시점에 시스템 배율을 fontSize 에만 **한 번 더** 곱한다 → fontSize 는 더블 스케일,
 * lineHeight 는 싱글 스케일 → 비율 붕괴 → 큰 글꼴에서 한글 받침 세로 클리핑·칩/박스
 * 레이아웃 오버플로.
 *
 * 해결(전역 단일 지점): RN 의 중복 적용을 끈다 — `<Text>`/`<TextInput>` 기본
 * `allowFontScaling`을 false 로 만든다. 그러면 fontSize·lineHeight 가 앱 배율로만 1회
 * 스케일 → 비율 보존. 사용자 큰 글꼴 접근성은 앱 자체 스케일(PixelRatio →
 * typography)이 그대로 제공하므로 유지된다.
 *
 * 왜 `Text.defaultProps` 가 아닌가: React 19 부터 함수형 컴포넌트의 `defaultProps`
 * 는 무시된다(RN 0.85 의 `Text`/`TextInput` 은 Flow `component()` 문법으로 컴파일된
 * 함수형 컴포넌트라 `Text.defaultProps.allowFontScaling = false` 패턴이 더 이상
 * 동작하지 않음). 또한 `import { Text } from 'react-native'` 는 Metro 에서 호출
 * 시점에 `_reactNative.Text` getter 를 lazy 하게 읽으므로, 공개 진입점의 getter 를
 * `allowFontScaling` 기본값을 주입하는 래퍼로 교체하면 직접 `<Text>` 사용 전 파일에
 * 일괄 적용된다. 명시적 per-instance `allowFontScaling` 은 그대로 우선한다(spread 순서).
 *
 * 공개 진입점(`react-native` index)만 패치하므로 RN 내부 상대경로 import 는 불변이다.
 */

let applied = false;

interface FontScalableProps {
  allowFontScaling?: boolean;
}

/**
 * 전역 텍스트 폰트 배율 정책 적용. 앱 부팅 시 1회 호출(멱등). `_layout.tsx` 의 어떤
 * 화면 컴포넌트보다 먼저 실행되어야 하므로 모듈 평가 시점에 호출한다.
 */
export function applyGlobalTextScalingPolicy(): void {
  if (applied) return;
  applied = true;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as Record<string, unknown>;

  for (const key of ['Text', 'TextInput'] as const) {
    // 방어적: RN 내부 구조 변경으로 getter 교체가 불가하더라도 부팅을 막지 않는다
    // (실패 시 폰트 배율 정책만 미적용으로 degrade, 크래시 없음).
    try {
      const Original = RN[key] as
        | React.ComponentType<FontScalableProps>
        | undefined;
      if (typeof Original !== 'function') continue;

      const Patched = (props: FontScalableProps): React.ReactElement =>
        React.createElement(Original, { allowFontScaling: false, ...props });
      (Patched as React.FunctionComponent).displayName = key;

      Object.defineProperty(RN, key, {
        configurable: true,
        enumerable: true,
        get: () => Patched,
      });
    } catch {
      // no-op: degrade gracefully
    }
  }
}
