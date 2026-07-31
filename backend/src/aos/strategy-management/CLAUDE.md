# Strategy Management 컨텍스트

## 이번 컨텍스트의 책임

- `Strategy`, `RuleDefinition`, `StrategyVersion`, `StrategyVersionRule`, `VersionActivation`의 수명주기를 관리한다.
- 설정 JSON은 정규화한 뒤 SHA-256 해시로 식별한다.
- `DRAFT` 이후 설정과 룰 구성은 불변이다.
- 상태 전이는 순수하고 결정적이어야 하며 단위 테스트로 전이 행렬을 고정한다.
- 예약·활성화는 검증된 KRX 거래일의 실제 종가 이후만 허용하고, 전략별 ACTIVE는 최대 하나다.
- 모든 활성화 요청은 `correlationId`로 멱등이며 실제 효력 구간을 원장에 남긴다.

## 금지

- AI/LLM 모듈 import 금지.
- 주문·체결·RiskCheck·Paper Trading 서비스 호출 금지.
- `AppModule`, Cron, Queue 자동 등록 금지(Issue #555 범위).
- 운영 데이터에 실제 전략 생성·활성화 금지.
- 운영 DB migration 실행 금지.

## 다음 단계 경계

- `ApprovalRecord`, `RiskPolicyVersion`, actor 권한/RBAC는 후속 A2 Issue에서 추가한다.
- Feature Snapshot, Backtest, Shadow Trading 연결은 각각 별도 버전 계약이 마련된 뒤 진행한다.
- Rule 평가 코어는 A3에서 서버 전용으로 묶지 않고 디바이스에서도 실행 가능한 순수 TypeScript 계약으로 분리한다.
