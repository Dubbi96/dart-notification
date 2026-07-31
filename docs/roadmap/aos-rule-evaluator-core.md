# AOS Device-Capable Rule Evaluator Core

> Issue: #561 · Phase: A3-1 · 구현일: 2026-07-31

## 1. 목적

서버 DI·DB·네트워크에 묶이지 않고 Android/iOS 디바이스와 백엔드 replay에서 같은 입력을 같은 순서로 계산하는 Rule Evaluator 기반을 만든다. 이 단계의 산출물은 주문 지시가 아니라 재현 가능한 평가 trace와 canonical receipt다.

## 2. 입력 계약

- `EvaluationVersionRef`: Strategy Version·Risk Policy Version 식별자와 SHA-256 content hash
- `FeatureSnapshot`: `KR_STOCK` 종목, UTC `asOf`, schema version, content hash, JSON feature 값
- `VersionedRule`: rule/implementation key, category, priority, weight, parameter hash, required feature, 누락 정책
- `RuleImplementationRegistry`: 플랫폼 어댑터가 주입하는 동기식 순수 함수 registry

평가기 자체는 Feature Snapshot이나 hash를 생성하지 않는다. 입력을 정규화·복제·동결한 뒤 평가하며 원본 object를 수정하지 않는다.

## 3. 결정론 계약

1. 룰을 `priority → ruleKey`의 UTF-16 code unit 순서로 정렬한다.
2. object key, required feature, reason code, block reason을 정렬한다.
3. 부동소수 score는 소수 12자리로 정규화하고 허용 범위 초과를 차단한다.
4. 평가 시작 시 구현체 registry를 snapshot하여 실행 도중 교체의 영향을 받지 않는다.
5. receipt에는 evaluator/version/snapshot hash와 룰별 parameter hash·trace를 포함한다.
6. canonical JSON은 순환 참조, accessor, non-enumerable/symbol key, non-finite number, sparse array, 비표준 object를 거부한다.

같은 의미의 입력이라면 rule 배열과 object key의 입력 순서가 달라도 `canonicalReceipt`가 byte 단위로 같아야 한다.

## 4. Fail-safe 행렬

| 상황 | 일반 룰 | Hard Risk 룰 |
|---|---|---|
| disabled | trace 후 skip | `BLOCKED` |
| 필수 feature 누락/null | 설정된 `BLOCK`/`ABSTAIN` | `BLOCKED` |
| 구현체 누락·accessor·비함수 | `BLOCKED` | `BLOCKED` |
| 구현체 예외·잘못된 결과 | `BLOCKED` | `BLOCKED` |
| 결과 `FAIL` | trace·score 반영 | `BLOCKED` |
| 결과 `ABSTAIN` | trace·score 반영 | `BLOCKED` |
| 결과 `PASS` | 정상 | 정상 |

AI 산출물은 사전에 검증된 feature 값으로만 들어올 수 있다. AI가 registry를 제공하거나 Risk 룰을 비활성화하고, 누락 정책으로 Hard Risk를 우회하는 경로는 허용하지 않는다.

## 5. 플랫폼·무게 경계

- 패키지 런타임 dependency 0
- Node·React·React Native·Expo·NestJS·Prisma import 0
- DB·네트워크·파일/보안 저장소 접근 0
- 시스템 시계·난수·비동기 함수·전역 mutable state 0
- CI가 경계 검사, 독립 TypeScript build, Node 내장 test를 실행

## 6. 현재 비배선

- 기존 `TradingSignal`, Buy/Exit Score, PaperTrade, OrderRequest를 읽거나 쓰지 않는다.
- `AppModule`, Cron, Queue, API, 모바일 화면/background task에 연결하지 않는다.
- 실제 룰 값·임계값·승인 정족수·계정 범위를 선택하지 않는다.
- 운영 DB migration과 프로덕션 배포가 없다.

## 7. 다음 구현 단위

1. A3-2: point-in-time Feature Snapshot schema/hash와 기존 feature dual-write
2. A3-3: 동일 fixture의 Node/Hermes parity와 SignalDecision shadow 기록
3. A4: Strategy/Risk/Feature version을 고정한 백테스트 replay

기존 실행 권한은 reconciliation이 준비될 때까지 유지하며 새 evaluator 결과는 Shadow 관찰 경로에서 먼저 비교한다.
