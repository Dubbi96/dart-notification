# AOS Governance 컨텍스트

## 책임

- Strategy/Risk/Activation 승인 결정을 대상 hash와 함께 append-only 원장으로 보존한다.
- 설정 생성·DRAFT 변경·상태 전이·활성화 이벤트를 actor와 correlation 기준으로 재현한다.
- 승인자 수와 역할표를 정하지 않고, 호출자가 명시한 separation policy만 순수 함수로 판정한다.

## 금지

- AI/LLM/Engine2 import 금지.
- 승인 인원·역할·권한의 기본값 또는 운영 seed 금지.
- 승인만으로 Hard Risk Gate 차단 결과를 허용으로 바꾸는 로직 금지.
- 기존 Strategy/Risk activation, Engine5, Signal/Paper/Order 호출 금지.
- AppModule/Cron/Queue/API/UI 등록과 운영 DB migration 금지(Issue #559 범위).

## 다음 단계 경계

- 실제 RBAC 역할표와 1인/2인 승인 정책은 Open Question 결정 후 별도 버전 정책으로 추가한다.
- 승인 원장을 Strategy/Risk 상태 전이에 연결할 때는 동일 transaction·대상 hash 재검증·멱등성을 강제한다.
- 기존 activation 서비스를 변경하기 전에 승인 누락/불일치 shadow 검증을 먼저 추가한다.
