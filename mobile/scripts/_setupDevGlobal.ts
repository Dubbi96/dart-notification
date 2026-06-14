/**
 * tsx 검증 스크립트 프리로드 — RN 전역 `__DEV__`를 정의한다.
 * utils/copy.ts 등 일부 모듈이 모듈 로드 시점에 `if (__DEV__)` 자기검증을 수행하는데,
 * Node/tsx 환경엔 이 전역이 없어 ReferenceError가 난다. 부작용 import 로 가장 먼저
 * 로드해 전역을 주입한다(검증 전용, 앱 번들엔 영향 없음).
 */
(globalThis as unknown as { __DEV__?: boolean }).__DEV__ = false;
