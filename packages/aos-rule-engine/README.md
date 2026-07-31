# AOS Rule Evaluator Core

디바이스와 서버 replay가 동일한 버전·Feature Snapshot·Rule 목록으로 동일한 평가 결과를 만들기 위한 동기식 순수 TypeScript 패키지다.

## 현재 제공 범위

- 전략·리스크 버전 hash와 Feature Snapshot hash를 포함한 입력 계약
- `priority → ruleKey` 고정 순서 실행
- 구현체 registry 주입
- 룰별 trace와 byte-stable canonical receipt
- Hard Risk 비활성화·입력 누락·실패·오류의 fail-safe 차단
- 런타임 dependency와 플랫폼 API 사용을 차단하는 경계 검사

이 패키지는 설정을 내려받거나 저장하지 않으며, Feature Snapshot을 생성하거나 hash하지 않는다. `SignalDecision`, 주문 계획, 백테스트·Shadow 영속화도 후속 어댑터의 책임이다.

## 검증

저장소 루트 기준:

```bash
node packages/aos-rule-engine/scripts/check-boundaries.cjs
cd backend
npx tsc -p ../packages/aos-rule-engine/tsconfig.json
node --test ../packages/aos-rule-engine/test/*.test.cjs
```
