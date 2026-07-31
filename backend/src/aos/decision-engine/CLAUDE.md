# AOS Decision Engine 규칙

> 상위 규칙: `backend/src/aos/CLAUDE.md`

- FeatureSnapshot, pinned StrategyVersion, pinned RiskPolicyVersion 없이 결정 원장을 만들지 않는다.
- 공유 `@dart-notification/aos-rule-engine`의 canonical receipt를 그대로 저장한다.
- SignalDecision과 RuleEvaluationTrace는 append-only이며 재평가는 새 decision으로 남긴다.
- Legacy parity 불일치는 관측·보고만 하며 기존 TradingSignal을 변경하지 않는다.
- 승인되지 않은 임계값이나 Market Regime 분류 기준을 이 모듈에서 추정하지 않는다.
- AI 산출물은 snapshot input일 뿐 Rule/Risk 우선순위를 바꿀 수 없다.
