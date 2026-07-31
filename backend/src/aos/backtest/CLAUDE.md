# AOS Backtest 규칙

- StrategyVersion, RiskPolicyVersion, dataset manifest/hash를 고정하지 않은 run은 AOS 결과로 기록하지 않는다.
- 기존 `backtest_runs`와 route는 전환 기간 동안 유지하며 과거 run/trade를 삭제하지 않는다.
- 다음 거래일 시가, 비용, slippage, 거래정지·상하한가 등 기존 PIT 제약을 재사용한다.
- train/validation/test와 sensitivity를 영수증에 포함하고 acceptance 수치는 명시적으로 주입된 정책만 평가한다.
- acceptance 통과는 주문 활성화가 아니며 별도 승인·Shadow gate를 우회할 수 없다.
- AI는 주문·gate·가중치를 바꾸지 않는다.
