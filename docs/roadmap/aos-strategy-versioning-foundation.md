# AOS Strategy Versioning Foundation

> Issue: #551 · Phase: A2-1 · 구현일: 2026-07-31

## 1. 목적

AOS 전환의 첫 런타임 변경은 기존 매매 경로를 교체하는 작업이 아니라, Rule Engine이 재현 가능한 설정 버전을 참조할 수 있도록 만드는 일이다. 이 단계는 전략·룰 정의, 버전 수명주기, 설정 해시와 DB 불변성만 추가한다.

## 2. 이번 범위

- `Strategy`, `RuleDefinition`, `StrategyVersion`, `StrategyVersionRule` 모델과 create-only migration
- 국내주식 Long Only, 2~20거래일 스윙 제약
- `DRAFT` 중심 상태 전이 행렬
- 정렬된 JSON 정규화와 SHA-256 설정 해시
- 도메인과 DB 양쪽의 non-DRAFT 불변성 보호
- 상태 전이 및 결정적 해시 단위 테스트

## 3. 상태 수명주기

정상 경로:

`DRAFT → VALIDATED → BACKTESTED → APPROVAL_PENDING → APPROVED → SCHEDULED → ACTIVE`

보정·종료 경로:

- `VALIDATED | BACKTESTED → DRAFT`
- `APPROVAL_PENDING → REJECTED → DRAFT`
- `SCHEDULED → APPROVED`(예약 취소)
- `ACTIVE → SUPERSEDED | ROLLED_BACK | RETIRED`

`SCHEDULED`는 미래의 `effectiveFrom`이 있어야 하며 해당 시각 이전에는 `ACTIVE`로 전이할 수 없다. 거래소 캘린더와 종가 이후 창을 확인하는 활성화 서비스는 다음 Issue에서 추가한다. 현재 Issue에는 Cron, Queue, API, AppModule 배선이 없다.

## 4. 안전 경계

- 기존 `TradingSignal`, `BuyScore`, `RiskCheck`, `PaperTrade`, `OrderRequest`를 읽거나 쓰지 않는다.
- AI/LLM 모듈을 import하지 않는다.
- 실제 전략 레코드를 생성하거나 활성화하지 않는다.
- 운영 DB에 migration을 적용하지 않는다.
- 기존 모바일·웹 화면과 API를 변경하지 않는다.

## 5. 다음 구현 단위

1. KRX 거래일·종가 이후 창을 사용하는 활성화 오케스트레이터
2. 전략당 단일 `ACTIVE` 보장과 트랜잭션/동시성 제어
3. 활성화·반려·롤백 감사 원장 및 운영자 권한
4. Feature Snapshot과 공유 평가기 계약

후속 연결도 Backtest → Shadow Trading → 제한적 운영 순서를 지키며, 기존 매매 경로와의 dual-write/reconciliation이 준비되기 전에는 실행 권한을 넘기지 않는다.
