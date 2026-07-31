# Risk Policy 컨텍스트

## 책임

- Hard Risk 한도를 `RiskPolicyVersion`으로 불변 버전화한다.
- 위험 한도 값은 사람이 승인한 입력만 저장하며 이 컨텍스트가 임의 기본값을 만들지 않는다.
- 국내주식 Long Only, 무레버리지, 무공매도, 장기계좌 자동보전 금지를 구조적으로 강제한다.
- 동일 limits 입력은 동일 canonical JSON과 SHA-256 hash를 만든다.

## 금지

- AI/LLM/Engine2 import 금지.
- Engine5 RiskCheck·주문·체결·Paper Trading 호출 또는 기존 상수 교체 금지.
- 실제 정책 seed/활성화, AppModule/Cron/Queue/API 등록 금지(Issue #557 범위).
- 운영 DB migration 실행 금지.

## 다음 단계 경계

- `ApprovalRecord`와 actor RBAC가 마련된 뒤에만 RiskPolicy activation service를 연결한다.
- 기존 Engine5 상수는 별도 legacy snapshot Issue에서 DRAFT로 가져오며 자동 ACTIVE로 만들지 않는다.
- Backtest·Shadow reconciliation 없이 기존 Risk 경로를 새 policy read로 전환하지 않는다.
