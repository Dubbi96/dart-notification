# AOS Feature Engine 규칙

> 상위 규칙: `backend/src/aos/CLAUDE.md`

## 책임

- Rule Engine이 실제로 소비한 입력, 출처, 품질 상태를 point-in-time으로 동결한다.
- 같은 의미의 입력과 같은 관측 시점은 같은 canonical SHA-256을 만들어야 한다.
- 스냅샷은 append-only이며 정정은 기존 행 수정이 아니라 새 스냅샷으로 남긴다.

## 경계

- 점수, 임계값, 주문, 포지션 크기, Hard Risk 판단을 만들지 않는다.
- AI 결과는 입력 feature로만 저장하며 주문 권한을 갖지 않는다.
- stale 기준이나 필수 feature 목록을 임의로 정하지 않는다. caller가 적용한 계약과 결과를 그대로 기록한다.
- 레거시 dual-write 실패가 기존 TradingSignal 경로를 중단해서는 안 된다.
