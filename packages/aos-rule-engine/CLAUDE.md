# AOS Rule Engine 공유 코어 규칙

## 책임

- Android/iOS 디바이스와 백엔드 replay가 같은 입력으로 같은 평가 receipt를 생성하는 순수 TypeScript 코어다.
- 설정 저장, 네트워크 수집, DB 접근, 주문 생성·집행은 이 패키지의 책임이 아니다.
- AI 산출물은 검증된 Feature Snapshot 값으로만 들어올 수 있으며, Hard Risk 판정을 우회할 수 없다.

## 절대 경계

- 런타임 dependency 0을 유지한다.
- Node, React, React Native, Expo, NestJS, Prisma, DB, 네트워크, 파일·보안 저장소를 import하지 않는다.
- 시스템 시계, 난수, 전역 mutable state를 사용하지 않는다. 시간과 버전은 입력으로만 받는다.
- 비동기 함수와 부수효과를 추가하지 않는다.
- Hard Risk 룰의 비활성화·입력 누락·FAIL·ABSTAIN·실행 오류는 fail-safe `BLOCKED`로 판정한다.
- 이 패키지에서 주문 방향·수량·가격 또는 실제 전략 임계값을 결정하지 않는다.

## 변경 완료 조건

- `scripts/check-boundaries.cjs`
- `npx tsc -p packages/aos-rule-engine/tsconfig.json`
- `node --test packages/aos-rule-engine/test/*.test.cjs`
- 같은 의미의 입력 순서가 달라도 canonical receipt가 byte 단위로 같다는 회귀 테스트
