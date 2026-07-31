# AOS Operator Console 경계

- 모든 endpoint는 JWT와 operator RBAC를 모두 통과해야 한다.
- mutation은 `AOS_OPERATOR_MUTATIONS_ENABLED=true`와 scope가 일치하는 단일 사용 step-up grant가 함께 있어야 한다.
- 작성자와 승인자는 분리한다. 자기 승인은 금지한다.
- Kill Switch 해제 요청은 자동 해제가 아니다. A6는 안전한 발동과 요청/영수증만 제공한다.
- command, approval, config audit, human intervention 원장은 append-only다.
- UI는 Rule/Risk 결정을 설명·운영할 뿐 AI가 주문이나 Hard Risk를 우회하는 경로를 만들지 않는다.
