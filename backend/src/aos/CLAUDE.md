# AOS 도메인 규칙

> 상위 규칙: `backend/CLAUDE.md` · 목표 문서: 저장소 외부 AOS Context Pack과 승인된 Migration Plan

## 책임

- AOS는 버전이 고정된 Rule Engine·Risk Engine과 그 결정 원장을 소유한다.
- AI 산출물은 공시·뉴스·패턴·시장 상황을 구조화한 입력 특성일 뿐, 주문·수량·Hard Risk Gate를 결정하거나 우회할 수 없다.
- 국내 주식 Long Only, 2~20거래일 스윙 범위를 벗어나는 전략은 만들지 않는다.
- 장기투자 자산과 시스템 트레이딩 자금은 분리하며, 트레이딩 손실을 장기계좌에서 자동 보전하지 않는다.

## 변경 규율

- Rule·Weight·Strategy Version의 설정 본문은 `DRAFT`에서만 변경한다.
- Hard Risk 한도 역시 독립된 `RiskPolicyVersion`으로 관리하며 `DRAFT`에서만 변경한다.
- 활성화는 검증·백테스트·승인·종가 이후 예약 단계를 모두 통과해야 한다.
- 장중에는 이미 승인된 주문, 손절, 추적손절, 비상 규칙만 실행할 수 있다.
- 활성 버전은 수정하지 않고 새 버전을 생성한다. 모든 결정은 사용한 버전과 입력 스냅샷을 추적할 수 있어야 한다.

## 점진 전환

- 기존 엔진을 한 번에 교체하지 않는다. Backtest → Shadow Trading → 제한적 운영 순으로 진행한다.
- 기존 신호/모의운용 경로에 연결할 때는 dual-write와 reconciliation을 먼저 마련한다.
- 새로운 런타임 배선은 별도 Issue와 회귀 테스트 없이는 추가하지 않는다.
- `strategy-management`와 `risk-policy`는 현재 저장·승격 제어평면이며 기존 Engine5 실행 경로의 설정 원본이 아니다.
