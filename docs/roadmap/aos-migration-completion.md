# AOS Migration A1–A8 Completion Record

초기 컨텍스트 패키지의 `MIGRATION_PLAN.md`를 실제 main 기준으로 추적하는 완료 기록이다.

| Phase | 상태    | main 산출물                                                                             |
| ----- | ------- | --------------------------------------------------------------------------------------- |
| A1–A2 | 완료    | Strategy/Rule/Risk version, KRX 장후 activation, approval/config audit                  |
| A3    | 완료    | device-capable deterministic Rule evaluator, Feature/Decision/Trace ledger              |
| A4    | 완료    | immutable version-pinned backtest, walk-forward/acceptance/attribution                  |
| A5    | 완료    | canonical Shadow/Paper account, risk/order/fill/reconciliation/intervention/Kill ledger |
| A6    | 완료    | 독립 Operator Web, RBAC, Step-up, read-only default, command receipt                    |
| A7    | 완료    | 온디바이스 Rule 재평가, 판단 중심 모바일 IA, 조건부 투자 계획, 화면·bundle 경량화       |
| A8    | 완료    | 50/30/20 확정이익 plan, 분리 승인, cancel/reissue 감사, 모바일 조회                     |
| A9    | 범위 밖 | 실거래·브로커·송금은 별도 사용자 승인과 법률/운영 acceptance 이후만 착수                |

## 현재 불변식

- 국내 주식 Long Only, 2–20거래일 Swing 범위
- AI는 구조화·score feature만 제공하며 주문·Risk gate를 결정하거나 우회하지 않음
- Rule/Weight/Strategy/Allocation Policy 효력 변경은 검증된 KRX 거래일 종가 이후
- 모바일 Rule 계산은 기기에서 즉시 수행하지만 Shadow 표시만 만들고 서버 주문 원장을 쓰지 않음
- 장기자산과 시스템 트레이딩 계정/bucket을 분리하고 손실 자동 보전 금지
- Backtest와 Shadow가 실거래보다 선행하며 현재 LIVE adapter는 없음

## 아직 제품·운영 결정이 필요한 항목

아래 항목은 구현 누락이 아니라 의도적으로 default를 정하지 않은 gate다.

- 초기 운영 전략/Hard Risk의 실제 수치 및 Shadow acceptance 기간·표본·성과 기준
- 실제 증권사·실계좌 구조, market/broker 데이터 계약과 reconciliation SLA
- 배분 주기, 세금 산식, FX 기준, 최소금액, SPGI concentration cap
- 계획 가격 노출 관련 법률·컴플라이언스 검토 주체와 완료 기준
- Operator 운영 계정 발급, SSO/2FA, 감사 보존·백업, Admin hosting/CORS/CSP
- A9 착수에 대한 명시적 사용자 승인

따라서 A1–A8 코드는 Shadow/Paper와 계획 단계에서 완결됐고, 위 결정을 임의 값으로 채우거나 LIVE로
확대하지 않는다.
