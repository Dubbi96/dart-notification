# Changelog

본 백엔드의 주요 변경 이력. 형식은 Keep a Changelog 약식, 버전은 SemVer(pre-1.0).
1.0.0은 모의운용 졸업 + 실주문 승격 시 예약한다.

## [0.1.0] - 2026-06-27 — 자동 매수/매도·모의매매 결함 13건 수정

> 감사(자동 매수/매도 논리 타당성 + 모의매매 처리 정합성)에서 도출한 13건 결함을
> SSOT 로드맵(`docs/roadmap/cc-trading-fix-roadmap-2026-06-26.md`) 기준으로 수정.
> 적대적 검증으로 4건(F1·F3·F6·F9) 원안 결함을 교정 후 반영.
> 전 구간 `tsc 0` · `npm test` 242스위트 3224건 그린 · `nest build` 통과. 스키마 변경 0.

### Fixed (정확성 — 손절·익절·회계·리스크)
- **F1** 장중 실시간 손절 복원 — `entry=REAL` 정체 일봉의 cross-source 가짜손절은 막되(DAR-433),
  거래일 차 신선도 가드로 장중 실시간 −8% 손절을 발화시킨다(DAR-366). 원안의 달력일 임계는
  월요일·연휴마다 손절을 억제해 폐기, 거래일 차(`tradingDayDiff`)로 교정.
- **F3** `evaluateExits`가 빈 공시·null 지표를 넘겨 6 Exit 트리거가 −8% 단일 손절로 붕괴하던 결함
  해소 — 실 기술지표·악재(NEGATIVE/고위험) 공시를 graceful 주입(SYNTHETIC 미혼합, rcpDt 999999
  천장, low20 20일 최저 교정).
- **F2** 익절(Take-Profit) 자동청산 부재 해소 — `calculateExitScore`에 하드 익절 오버라이드(목표 도달
  → 최소 EXIT, 손절과 대칭). 익절은 **부분 스케일아웃**(절반 매도·잔량 보유)으로 동작 — 매도분을
  합성 CLOSED 행으로 기록해 기존 회계가 실현손익을 정확히 반영(스키마 변경 0).
- **F7** 매수 수수료가 회계에서 누락되던 결함 — 청산 netPnl(부분/전량 비례)·진입 현금가드에 차감.
- **F8** (Phase1) 체결가를 KRX 호가단위로 정렬(불리한 방향 — 슬리피지 항상 비용). 동적 슬리피지·
  부분체결(Phase2)은 백로그.
- **F12** 졸업 게이트 표본 하한 5→20 상향(이항잡음 완화, 단타 트랙과 정합).
- **L** 단타 강제청산 가격결측 시 진입가로 0% 손익을 날조하던 데이터정합 결함 — 실측 폴백체인(같은
  거래일 일봉 한정)+정직 고지. volume-liquidity "하드 차단" 오라벨 정정.

### Fixed (리스크 — kill-switch)
- **F5** 분봉 단타 진입이 `killSwitchActive:false` 하드코딩으로 kill-switch를 우회하던 결함 — 공유
  KillSwitchManager 결선(발동 시 신규 진입 차단·청산은 허용).
- **F11** 단타 주간 손실 한도가 당일치를 넣어 무력하던 것을 이번주(월~) 실현손익 합산으로 정정.
- **F6** 시스템 모의(`openNewPositions`)에도 동일 kill-switch 가드 — kill-switch가 모든 모의 진입을
  멈춤. (전체 OrderRiskService 단일 게이트·감사 통일은 M11 실주문 전 후속.)

### Changed (신호·등급)
- **F4** 매수신호 푸시 통지가 SignalGrade enum 불일치(`STRONG_BUY` vs `STRONG_BUY_CANDIDATE`)로
  영구 미발화하던 결함 해소 + 공시단위(corpCode,rcpNo) dedup(persona fan-out 4중 푸시 방지).
- **F9** 소비자 등급 임계 80/60/30 → **50/45/30** 분포 재보정(STRONG 0.01% 붕괴 교정). BUY=45는
  DAR-322 보수성 경계(무의미 규모 score 41) 위에 둬 가짜 BUY 인플레이션 방지.
- **F10** 결측 재정규화가 동일 공시 파생 상관버킷에 가중치를 몰아 buyScore가 상수로 수렴하던 거짓
  corroboration 제거 — 독립 증거 0이면 상관그룹을 합=1.0으로 부풀리지 않는다.

### 릴리스 원칙 (정직 게이트)
- plumbing 정확성(손절·익절·회계·kill-switch)은 hard gate로 통과 → 발행. **엣지(수익성)는 hard
  gate가 아니다**: 백테스트상 매수논리 엣지가 미확인이므로(baseline −14.5%), **execution(실주문/
  자동매매)은 비활성 유지**하고 paper/research 라벨로 출시한다. 졸업(M10)·실주문 승격(M11)은 별도
  휴먼 승인 게이트.
