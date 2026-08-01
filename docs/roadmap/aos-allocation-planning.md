# AOS Realized-profit Allocation Planning — Phase A8

Issue #576의 구현 정본이다. 시스템 트레이딩에서 결산된 확정이익을 `SPGI 50% / VTI 30% /
SYSTEM_TRADING 20%`로 나누는 **계획과 승인 원장**만 제공한다. 송금, 환전, 매수, 브로커 주문은
구조적으로 존재하지 않는다.

## 계산 계약

1. 운영자가 시스템 트레이딩 KRW 계정, 닫힌 기간, 확정이익, 세금·FX 유보액과 원천 증거를 입력한다.
2. 확정이익이 0 이하이거나 `확정이익 - 세금 유보 - FX 유보`가 0 이하이면 plan을 만들지 않는다.
3. 원 단위 정수만 허용한다. SPGI와 VTI는 각각 50%, 30% 내림값을 받고 잔여 원은
   SYSTEM_TRADING에 둔다. 세 항목 합계는 항상 distributable profit과 정확히 같다.
4. 동일 기간은 일반 생성으로 중복할 수 없다. 기존 plan을 취소한 뒤 명시적 reissue로만 새 revision을 만든다.
5. plan 생성자는 승인할 수 없다. plan에 고정된 Allocation Policy가 더 이상 ACTIVE가 아니면 승인하지 않는다.

이 계산은 자본 bucket의 `availableAmount`나 `autoReplenishAllowed`를 수정하지 않는다. 시스템 손실을
장기계좌에서 자동 보전하는 경로도 없다.

## 정책과 미확정 항목

50/30/20 비율만 제품 결정으로 고정했다. 다음 항목은 임의 기본값을 정하지 않고 versioned JSON으로
명시한다.

- 확정이익 정산 주기: 월/분기/기타
- 세금 유보 산식
- FX 기준 source·시각과 실제 환전 방식
- 최소 배분/송금 금액
- SPGI concentration cap

Admin에서 미확정 상태는 `OPEN_QUESTION`으로 저장할 수 있다. 각 plan의 세금·FX 유보액은 0을
포함해 운영자가 반드시 숫자로 입력하고, source evidence hash와 함께 보존한다.

## 데이터와 감사

- `AosAllocationPolicy`: 50/30/20 및 운영 placeholder의 불변 버전
- `AosAllocationPlan`: 계정·닫힌 기간·확정이익·유보액·정책 hash를 고정한 계획
- `AosAllocationPlanItem`: SPGI/VTI/SYSTEM_TRADING 원 단위 금액
- `AosAllocationLedgerEntry`: 생성·활성화·승인·취소·재발행 append-only 사건
- `AosOperatorCommandReceipt`: RBAC, 5분 단일 사용 Step-up, request/result hash

DB trigger는 policy/plan의 핵심 필드 변경, item/ledger의 update/delete/truncate를 차단한다. 정책과
plan의 작성자/승인자 분리는 애플리케이션과 DB CHECK 양쪽에서 강제한다. 정책 활성화는 검증된 KRX
거래일의 종가 이후에만 가능하다.

## 화면

- Admin `자산 배분`: 정책 DRAFT/장후 승인, plan 생성/승인/취소/reissue, 금액 waterfall과 hash 원장
- Mobile `포지션`: 로그인 사용자에게 승인된 최근 plan과 세 목적지 금액만 조회 전용으로 표시
- 두 화면 모두 `송금·FX·주문 없음`을 명시하며 실행 CTA를 제공하지 않는다.

## 검증 증거

- 전체 78개 migration을 새 로컬 TimescaleDB에 적용
- DB에서 101원을 50/30/21원으로 저장하고 세 항목 합계 101원 확인
- 0원 plan CHECK 차단, plan 핵심 금액 변경 차단, ledger 변경 차단
- 순수 계산 테스트: 손실/0원/유보액 초과/음수/원 단위/결정적 hash
- Admin typecheck/test/build 및 1280px·375px 브라우저 overflow 검사
- Mobile typecheck/lint 및 Android export/전체 Jest

로컬 검증용 DB는 확인 후 삭제했다. 운영 migration과 OCI 배포는 별도 휴먼 승인 전까지 실행하지 않는다.
