# Strategy Management 컨텍스트

## 이번 컨텍스트의 책임

- `Strategy`, `RuleDefinition`, `StrategyVersion`, `StrategyVersionRule`의 수명주기를 관리한다.
- 설정 JSON은 정규화한 뒤 SHA-256 해시로 식별한다.
- `DRAFT` 이후 설정과 룰 구성은 불변이다.
- 상태 전이는 순수하고 결정적이어야 하며 단위 테스트로 전이 행렬을 고정한다.

## 금지

- AI/LLM 모듈 import 금지.
- 주문·체결·RiskCheck·Paper Trading 서비스 호출 금지.
- `AppModule`, Cron, Queue 등록 금지(Issue #551 범위).
- 실제 전략 생성·활성화 및 운영 DB migration 실행 금지(Issue #551 범위).

## 다음 단계 경계

- 거래소 캘린더 기반 종가 이후 활성화와 단일 ACTIVE 보장은 후속 Issue에서 서비스/트랜잭션으로 구현한다.
- Feature Snapshot, Backtest, Shadow Trading 연결은 각각 별도 버전 계약이 마련된 뒤 진행한다.

