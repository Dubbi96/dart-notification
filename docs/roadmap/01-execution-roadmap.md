# 실행 로드맵 — 전체 개발 순서 및 회귀 체크포인트

> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: 직접 판단(엔지니어링 관점) · 최종 수정: 2026-07-17 (DAR-548 정본 동기화 감사 — 게이트 백로그 참조[DAR-529]·M10 앵커 8/5 반영 확인, §3-1/§4 회귀 스위트 수 현행화 337 스위트) / 이전: 2026-07-16 (갭분석 퀵윈 웨이브 — MZ 수익화 토대(M10.5) 신설·M13A 게이트 정합(M13A-Lite 병기)·병행 트랙 C-트랙(컴플라이언스) 추가) / 이전: 2026-07-02

이 문서는 비전의 Phase 0~14를 **의존성 기준으로 재정렬한 실제 개발 순서(Milestone)** 와, 각 마일스톤이 끝날 때마다 **이전 단계를 함께 재확인하는 회귀 체크포인트**를 정의한다. 비전 8장의 "개발 우선순위"가 *무엇을* 만드는지라면, 이 문서는 *어떤 순서로, 무엇을 다시 검증하며* 만드는지를 다룬다.

핵심 운영 원칙(이 로드맵 전반에 적용):
- **누적 검증.** 다음 마일스톤으로 넘어가기 전, 직전까지의 모든 단계가 여전히 정상 동작하는지 회귀 확인한다. "앞이 무너지면 뒤는 의미 없다."
- **빌드 품질 우선(검증 게이트).** 얇게/대충 만든 결과가 우연히 잘 나와도 신뢰하지 않는다. 모든 기능을 **검증 가능한 품질**로 완성한 뒤, 모의투자로 실비용을 측정하고 나서야 실서비스/자동매매를 논한다. (참조: [MVP 정의](./cc-mvp-definition.md) §3)
- **데이터 소스 기준.** 시세·통계 기준 데이터는 **KRX 데이터마켓플레이스(한국거래소, 공기업)** 를 1차 소스로 한다. 실시간 현재가·주문 체결은 증권사 OpenAPI로 보완한다. (참조: [Phase 5](./phase-05-market-data.md))

---

## 1. 마일스톤 개요 (의존성 정렬)

| M | 마일스톤 | 포함 Phase | 한 줄 목표 | 진입 게이트 | 상태(2026-07-02) |
|---|----------|-----------|-----------|-------------|------------------|
| **M0** | 기준선 & 수집 안정화 | P0, P1 | 범위 확정 + 신뢰할 수 있는 공시 수집 파이프라인 | — (현행 코드 기반) | ✅ 완료 |
| **M1** | 공시 원문 파싱 | P2 | rcpNo 원문 다운로드·구조화(`DisclosureDocument`) | M0 | ✅ 완료 |
| **M2** | 이벤트·수치 추출 | P3 | 5종 이벤트 분류 + 핵심 수치(`DisclosureEvent`) | M1 | ✅ 완료 |
| **M3** | AI Analyst + 비용 계측 토대 | P4, P11(부분) | 4개 AI Task + `AIUsageLog`·L0~L2 게이트 | M2 | ✅ 완료 |
| **M4** | 시세·시장 데이터 | P5(KRX) | 일봉·지표·종목상태 토대(Quant Engine) | M0 (M2와 병행 가능) | ✅ 완료 |
| **M5** | Event Study | P9 | 이벤트별 과거 반응 통계(`EventStudyResult`) | M2, M4 | ✅ 완료 |
| **M6** | 매수 Signal Engine | P6 | Buy Score·`TradingSignal` | M3, M4, M5 | ✅ 완료(⚠️ 엣지 재검증 잔여) |
| **M7** | Position Thesis | P7 | 진입 논리·훼손 조건 저장(`PositionThesis`) | M6 | ✅ 완료 |
| **M8** | Portfolio & Exit Engine | P8 | Exit Score·`ExitSignal`·5액션 | M7 | ✅ 완료 |
| **M9** | 백테스트 | P10 | 과거 구간 전략 검증(`BacktestRun`) | M5, M6, M8 | ✅ 완료 |
| **M10** | 모의투자 + 비용 거버넌스 완성 | P12, P11(완성) | 실데이터 모의운용 + 실비용 측정 — **MVP 졸업 게이트** | M8, M9 | 🚧 진행 중(잔여: 라이브AI 상시 + 30일 캘린더 — 졸업 앵커 ≈8/5, §1 표 아래 주석) |
| **MZ** | 수익화 토대 (M10.5) | — | 티어(FREE/PRO)·가격 검증·과금 배관 — 정본: [cc-monetization-plan.md](./cc-monetization-plan.md) | M10 졸업 (+ 과금 활성화는 C-트랙 유사투자자문업 신고 게이트, §4) | 🚧 토대만(W0 스키마 User.tier·ProWaitlistEntry + W1 수요 계측 배선, 2026-07-15 갭분석 퀵윈) |
| **M11** | 반자동매매 | P13 | 사용자 승인 주문 + 증권사 API·Risk 사전체크 | M10 졸업 | 🚧 토대만(실주문 루프 미연동) |
| **M12** | 제한적 자동매매 | P14 | 검증 전략 한정 자동화 + Risk veto·Kill Switch | M11 | ⬜ 미착수 |
| **M13A-Lite** | 미국주식 알림 라이트 (상위 20 티커) | — | 상위 20 티커 공시(8-K 등) 알림만 — 풀 파이프라인 아님 | **M10 졸업 AND 수요 실증**(SearchMissLog·US_DEMAND_TAP 계측, 갭분석 W8) | ⬜ 미착수(수요 계측 가동 중) |
| **M13A** | 미국주식 확장 (풀) | — | US_STOCK 어댑터·SEC EDGAR 파이프라인·미국 모의투자 | **M12 안정 운영 3개월** (§M13A 상세와 동일 — 2026-07-16 게이트 정합) | ⬜ 미착수 |
| **M13B** | 코인 확장 | — | CRYPTO 24/7 수집·업비트/Binance 어댑터·코인 모의투자 | M13A 90일 검증 | ⬜ 미착수 |
| **M14** | 통합 멀티에셋 포트폴리오 | — | 자산군 통합 대시보드·비중 리밸런싱 | M13A + M13B | ⬜ 미착수 |

> **상태 열 근거:** [재개 계획 2026-07-02 §1-2](./cc-resume-plan-2026-07-02.md) 코드 근거 판정 매트릭스. 게이트 기준 자체는 불변(규범)이며 상태만 주석한다.
> **다자산 확장 상세:** [cc-multi-asset-expansion.md](./cc-multi-asset-expansion.md) 참조.
> **Persona 철학 엔진 편입:** M3 완성 후 P-A(철학 데이터 모델) 착수 → M5~M6 병행 P-B(Rule 스코어러) → M12 이후 P-D(철학별 모의투자). 상세: [cc-persona-philosophy-engine.md](./cc-persona-philosophy-engine.md)
> **게이트 백로그(착수 금지·조건 개방):** 에디션 웨이브 이후 8항목(아침 다이제스트·재무맥락 확장·트랙레코드 공개·레일B B-0·브로커 딥링크·이벤트 캘린더·콜드스타트 온보딩·원탭 모의매매)의 개방 조건·근거·리스크 정본은 [cc-gate-backlog-2026-07-17.md](./cc-gate-backlog-2026-07-17.md)(DAR-529). 앵커=M10 졸업 ≈8/5(구 `≈7/21`은 후속 PM 1주기 계획 §6에 의해 8/5로 확정·대체됨 — 위 M10 행 반영).

> **순서 판단 근거:**
> - **M4(시세)는 M2와 병행** 가능하다. 공시 파이프라인(M1→M2)과 시세 파이프라인(M4)은 독립적이라 자원이 되면 동시에 진행한다. 단 M5 진입 전 둘 다 완료돼야 한다.
> - **M5(Event Study)를 M6(Buy Score)보다 앞**에 둔다. Buy Score의 "과거 유사 공시 성과" 컴포넌트가 Event Study 산출물을 입력으로 쓰기 때문. (비전 6장)
> - **M9(백테스트)를 M10(모의투자)보다 앞**에 둔다. 90일 모의운용에 자원을 쏟기 전, 과거 데이터로 전략이 통계적으로 말이 되는지 먼저 거른다.
> - **M10이 MVP 졸업 게이트.** 여기서 "전 기능 정상 동작 + 모의투자 실비용 검증"을 통과해야 M11(실주문) 착수를 허가한다. (#3 원칙)

---

## 2. 마일스톤별 상세 + 회귀 체크포인트

각 마일스톤은 **[산출물] / [핵심 작업] / [↩︎ 이전 단계 재확인] / [✅ 다음 진입 게이트]** 로 구성한다.
↩︎ 항목이 이 로드맵의 핵심 — 매 단계 종료 시 직전까지의 단계를 함께 점검한다.

### M0 — 기준선 & 수집 안정화 (P0, P1)
- **산출물:** 확정된 분석 유니버스/공시 5종/Persona 4종, `DisclosureCollectionLog`, 수집 상태 조회 API
- **핵심 작업:** 수집 cron 재시도·백오프, 중복 방지 강화, 관심종목 필터, 공시 7분류→5종 게이트, 수집 실패 로깅
- **↩︎ 이전 단계 재확인:** (최초 단계) 대신 **현행 develop 자산 회귀** — 카카오 로그인·관심목록·알림·푸시/딥링크가 스키마 변경 후에도 동작하는지, 기존 마이그레이션 정합성
- **✅ 진입 게이트:** 수집 성공률 ≥ 95%(CollectionLog 기준) · 중복 저장 0 · 5종 공시가 관심종목 기준으로 필터링됨

### M1 — 공시 원문 파싱 (P2)
- **산출물:** `DisclosureDocument`(rawText/parsedJson/parseStatus), 원문 다운로드·표 추출 파이프라인, 정정공시 감지·diff
- **핵심 작업:** rcpNo 원문 fetch, HTML/XML/첨부 파싱, 표→key-value, 파싱 실패 재처리 큐
- **↩︎ 이전 단계 재확인 (M0):** 신규 공시가 수집 직후 파싱 큐에 누락 없이 들어오는지 · 수집 안정성 SLA 유지 · CollectionLog와 DisclosureDocument 건수 정합
- **✅ 진입 게이트:** 5종 공시 표본 100건 파싱 성공률 ≥ 90% · 정정공시 isAmendment 정확 판정

### M2 — 이벤트·수치 추출 (P3)
- **산출물:** `DisclosureEvent` + eventType enum, 이벤트별 수치 JSON(salesRatio·dilutionRate 등 파생값)
- **핵심 작업:** report_nm/본문→eventType 매핑, Rule/Parser 수치 추출, 추출 confidence·검증
- **↩︎ 이전 단계 재확인:**
  - (M1) 파싱 산출물(표·본문)이 수치 추출에 충분한가 — **표 누락이 추출 실패로 전파되는 비율** 측정 → 임계 초과 시 M1 파서 보강
  - (M0) 신규 공시 유형 변화가 5종 분류 게이트에 영향 없는지
- **✅ 진입 게이트:** 5종 이벤트 분류 정확도 ≥ 90%(100건 수동 검증) · 핵심 수치 추출 정확도 ≥ 85%

### M3 — AI Analyst + 비용 계측 토대 (P4, P11 부분)
- **산출물:** 4개 AI Task(Summary/EventClass/Persona/Thesis), `DisclosureAnalysis`·`PersonaAnalysis`, `AIUsageLog`, L0~L2 비용 게이트
- **핵심 작업:** 최소입력 프롬프트, JSON 스키마 강제·검증, rcpNo+task 멱등 캐시, 호출 래퍼에서 비용 자동 기록
- **Persona 철학 엔진 P-A 편입 (M3 완성 직후):** `InvestorPhilosophy` 모델 + 4종 철학 시드 구축. AI Task와 독립적으로 착수 가능. 상세: [cc-persona-philosophy-engine.md §4 P-A](./cc-persona-philosophy-engine.md)
- **↩︎ 이전 단계 재확인:**
  - (M2) AI의 이벤트 타입 **보정 결과 vs Rule 분류 불일치율** 추적 → 불일치 급증 시 M2 룰 재점검
  - (M1) **AI 입력 최소화 원칙 준수** — 원문 전문이 통째로 들어가지 않는지(토큰량 모니터), 들어가면 M1 추출 강화
  - L0(AI 미사용) 비율 ≥ 70% 유지되는지
- **✅ 진입 게이트:** AI 분석 10건+ JSON 정상 · JSON 파싱 실패 fallback 동작 · 공시 1건당 평균 비용 < $0.005

### M4 — 시세·시장 데이터 (P5, KRX 기준)
- **산출물:** `StockDailyPrice`·`StockMinutePrice`·`TechnicalIndicator`·종목상태·`MarketIndex`, 지표 배치, 차트 조회 API
- **핵심 작업:** **KRX 데이터마켓플레이스 일봉·지수 수집**, 지표 계산(MA/RSI/MACD/BB/ATR/VWAP/거래량/전고전저/선행상승률), 종목상태(거래정지·관리·투자주의)
- **↩︎ 이전 단계 재확인:**
  - (M0) **`Company.stockCode`/`market` 정확도** — 시세 매핑 실패율 측정, 빈 값/오매핑이면 seed 보완(feature-status의 시장구분 미완 항목 해소)
  - (M1) 공시 `rcpDt`와 가격 **거래일 캘린더 정합**(휴장일·장중/장후 보정)
- **✅ 진입 게이트:** 관심 50종목 일봉 결측률 < 2% · 지표 계산 결과 수기 검증 통과 · 공시 전 선행상승률 산출 정상

### M5 — Event Study (P9)
- **산출물:** `EventStudyResult`, 이벤트별 D+1/3/5/20 평균·상승확률·MDD·초과수익, 세분화 버킷
- **핵심 작업:** 과거 공시 라벨링, D0 지정, D-20~D+20 가격 연결, 시장·업종 대비 abnormal return, 표본·유의성 처리
- **↩︎ 이전 단계 재확인:**
  - (M4) **가격 데이터 결측이 통계 왜곡**을 일으키지 않는지 — 결측 종목 제외/보정 규칙
  - (M2/M3) **이벤트 라벨 정확도가 통계 신뢰도**에 미치는 영향 — 라벨 오류율 높은 이벤트는 표본 신뢰 강등
- **✅ 진입 게이트:** 5종 이벤트 각 표본 ≥ 50건 · D+5 통계 산출 + 표본수/분산 함께 기록(과신 방지)

### M6 — 매수 Signal Engine (P6)
- **산출물:** Buy Score(7컴포넌트 − 리스크패널티), `TradingSignal`, 신호 등급·진입조건, 매수 후보 리포트
- **핵심 작업:** 컴포넌트별 점수화·가중치 config화, 진입조건 평가, 리포트 생성 (**자동매수 금지**)
- **↩︎ 이전 단계 재확인:**
  - (M5) Event Study **통계가 점수에 실제 반영**되는지 + 표본 부족 이벤트의 가중 감쇠
  - (M3) **Persona 해석과 적합도 점수 정합** · AI polarity와 최종 점수 방향 일치
  - (M4) 차트/거래량 점수가 **최신 지표**를 참조하는지(지표 지연 점검)
- **✅ 진입 게이트:** 공시 발생 시 Buy Score 자동 계산·저장 · 등급 분포가 상식적(전부 80↑ 같은 쏠림 없음) · 가중치 변경이 config로 추적됨

### M7 — Position Thesis (P7)
- **산출물:** `PositionThesis`(진입사유·initialThesis·invalidConditions·청산룰·최대비중), 매수 후보→Thesis 자동 생성
- **핵심 작업:** TradingSignal·Disclosure 연결, thesis 생명주기(생성→추적→훼손판정) 정의
- **↩︎ 이전 단계 재확인:** (M6) BUY 신호와 **Thesis 자동연결 정합**(신호당 thesis 1:1) · invalidConditions가 M5 통계/M4 지표/M2 정정공시로 **평가 가능한 형태**인지(추상 문장 금지)
- **✅ 진입 게이트:** 매수 후보 생성 시 Thesis가 빠짐없이 자동 생성 · 모든 invalidConditions가 기계 평가 가능

### M8 — Portfolio & Exit Engine (P8)
- **산출물:** `Portfolio`·`Position`·`PositionDailySnapshot`·`ExitSignal`·`PortfolioRiskSnapshot`, Exit Score, 5액션(HOLD/WATCH/REDUCE/EXIT/BLOCK_REBUY), 하루 3회 점검
- **핵심 작업:** 매도 6종 트리거, Exit Score 공식, 리밸런싱, 09:00/13:00/16:30 점검 스케줄
- **↩︎ 이전 단계 재확인:**
  - (M7) **`PositionThesis.invalidConditions`가 실제로 Exit 점검에서 평가**되는지 — thesis-driven exit 동작 확인
  - (M4) 실시간/최신 지표로 **차트 훼손 감지**가 작동하는지
  - (M1) 하루 3회 점검이 **신규 정정공시(악재)** 를 반영하는지
- **✅ 진입 게이트:** 50포지션 Exit Score 일괄 점검 ≤ 60초 · 손절/논리훼손 트리거 시 액션 정상 발동 · thesis 훼손이 EXIT로 이어짐

### M9 — 백테스트 (P10)
- **산출물:** `BacktestRun`·`BacktestTrade`, 현실 제약 반영 엔진, 성과 지표(Sharpe/MDD/승률/손익비/최악10)
- **핵심 작업:** 공시시각·장중/장후, 다음거래일 시가 진입, 수수료·세금·슬리피지·거래정지·상하한가·유동성·부분체결·관리종목 제외, **lookahead bias 방지**
- **↩︎ 이전 단계 재확인:**
  - (M6/M8) **Signal·Exit 룰이 과거 시점 데이터만으로 재현**되는지 — 미래 정보 누수 감사
  - (M5) Event Study 통계와 **백테스트 성과의 일관성**(괴리 크면 한쪽 결함)
  - (M4) 과거 가격 데이터 **기간/품질 충분성**
- **✅ 진입 게이트:** 상승·하락·횡보 3구간 모두 테스트 · 비용 반영 후 수익 > 0 · MDD ≤ -15% · 한두 종목 의존 아님 · 이벤트별 표본 충분

### M10 — 모의투자 + 비용 거버넌스 완성 (P12, P11 완성) — ★ MVP 졸업 게이트
- **산출물:** `PaperTrade`, 실데이터 가상 주문·체결 시뮬, 가상 포트폴리오, L0~L3 게이트 완성, 비용 지표 대시보드
- **핵심 작업:** 실공시·실시세·실AI로 모의운용, 체결 시뮬(슬리피지/부분체결), 비용 지표(Cost per Disclosure/Signal/Trade, 비용/순익), 실결과 비교
- **↩︎ 이전 단계 재확인 (전 구간 end-to-end 회귀):**
  - **전체 파이프라인 통합 회귀** — 수집(M0)→파싱(M1)→이벤트(M2)→AI(M3)→시세(M4)→통계(M5)→매수(M6)→Thesis(M7)→Exit(M8)이 실시간으로 끊김 없이 연결
  - (M3) AI **추정 비용 vs 모의운용 실측 비용 일치** 검증
  - (M9) 백테스트 가정(체결가·슬리피지)과 **모의 실측의 괴리** 측정 → 큰 괴리는 M9 재보정
  - 누적 회귀 테스트 일괄 그린
- **✅ MVP 졸업 게이트(모두 충족 → M11 허가):** (참조: [cc-mvp-definition §9](./cc-mvp-definition.md))
  - 11개 MVP 기능 전부 **검증 가능한 품질**로 동작(얇은 구현 불가)
  - 30일+ 모의운용: 신호 적중률 ≥ 55% · 누적수익 > 0 · 수집성공률 ≥ 95% · Exit 정확도 ≥ 50%
  - **AI비용/모의순익 ≤ 20%** (실측)
  - AI 금지영역 침범 0(감사 로그 확인)

### M11 — 반자동매매 (P13)
- **산출물:** `OrderRequest`·`OrderExecution`·`TradingAuditLog`, 증권사 OpenAPI 연동, 승인 카드 UI, Risk 사전체크
- **핵심 작업:** 증권사 주문 API(인증/주문/체결조회), 멱등 주문키, 주문 전 Risk veto, 전 주문 audit
- **↩︎ 이전 단계 재확인:** (M10) **모의에서 검증된 신호·Exit 로직이 실주문 경로에서 동일하게 동작**하는지 · 모의 체결가 가정이 실체결과 얼마나 다른지 · Risk Engine이 AI 긍정 신호를 **거부할 수 있는지**(veto 우선)
- **✅ 진입 게이트:** 소액 실주문 멱등·정확 체결 · 모든 주문 audit 기록 · Risk 사전체크 6항목 통과 · AI는 주문 승인 불가 확인

### M12 — 제한적 자동매매 (P14)
- **산출물:** 이벤트 화이트리스트(6종)/블랙리스트(9종), 하드 리스크 룰, Kill Switch, 자동중단 조건
- **핵심 작업:** 검증 전략만 자동화, 1회 1~3%/단일 5~10%/1일 -2%/1주 -5% 한도, 연속손실·시장급락·API오류 자동중단
- **↩︎ 이전 단계 재확인:** (M11) 반자동에서 **승인 패턴이 안정적**이었던 전략만 자동화 후보 · (M9/M10) 해당 이벤트가 백테스트·모의 졸업 조건 충족 · Risk veto·Kill Switch 코드 검증
- **✅ 진입 게이트(자동매매 졸업, 참조 cc-mvp-definition §9):** 90일 모의 누적수익 > 0 · AI비용/순익 ≤ 10% · 백테스트 3구간 통과 · Exit 정확도 ≥ 55% · 점진 롤아웃(소액→확대) 게이트 통과

---

### M13A — 미국 주식(US_STOCK) 확장 (예정, M12 안정 운영 3개월 후)

> 상세 설계: [cc-multi-asset-expansion.md §7-1](./cc-multi-asset-expansion.md)
> **게이트 정합(2026-07-16)**: §1 표의 구 게이트 'M10 졸업 + KR 3개월 안정'과 이 절의 'M12 안정 운영 3개월'이 불일치했다 — **풀 M13A는 'M12 안정 운영 3개월'로 확정**한다. 대신 **M13A-Lite**(상위 20 티커 공시 알림만, 수집·분석 풀 파이프라인 없음)를 분리해 'M10 졸업 AND 수요 실증(SearchMissLog `US_DEMAND_TAP` 계측, 갭분석 W8)' 게이트로 선행 가능하게 병기한다. EDGAR 접근성 PoC: `scripts/edgar-poc.ts`.

- **산출물:** Polygon.io/SEC EDGAR 기반 미국 주식 분석 파이프라인, US_STOCK 자산 어댑터, 환율 변환 레이어
- **핵심 작업:**
  - Engine1: SEC EDGAR 8-K/10-Q 이벤트 파싱 어댑터 추가
  - Engine3: Polygon.io 일봉·현재가 어댑터 + NYSE 캘린더 어댑터
  - Engine4: `Portfolio.currency` 다통화 지원 (USD/KRW 혼용)
  - 공통: `assetClass: AssetClass` 도메인 필드 추가 (기존 모델 확장)
- **진입 조건:**
  - M10 MVP 졸업 + M12 안정 운영 3개월 이상
  - Polygon.io API 키 확보 및 데이터 품질 PoC 완료
  - SEC EDGAR 실적 이벤트 파이프라인 PoC 완료
- **초기 대상:** S&P 500 편입 유동성 대형주 30개, 분기 실적/M&A/FDA 이벤트 중심

### M13B — 암호화폐(CRYPTO) 확장 (예정, M13A 모의투자 90일 검증 후)

> 상세 설계: [cc-multi-asset-expansion.md §7-2](./cc-multi-asset-expansion.md)

- **산출물:** Binance API 기반 암호화폐 24/7 분석 파이프라인, CRYPTO 자산 어댑터
- **핵심 작업:**
  - Engine3: Binance REST/WebSocket 어댑터, 24/7 수집 Scheduler(Cron → 이벤트 구독)
  - Engine5: 변동성 대응 리스크 파라미터 분리 (KR/US 대비 포지션 한도 1/3)
  - 온체인 이벤트 분류 룰 (반감기·업그레이드·락업해제 등)
- **진입 조건:**
  - M13A 모의투자 90일 실비용 검증 완료
  - Binance API 24/7 수집 안정성 PoC
  - 가상자산 세금 계산 로직 검토 완료
- **초기 대상:** BTC·ETH·BNB (시가총액 상위 3개, KRW 마켓)

---

## 3. 전역 회귀 매트릭스 (매 마일스톤 공통 점검)

마일스톤 종료 시 아래 횡단 항목을 **항상** 함께 확인한다. (단계별 ↩︎ 항목과 별개)

| 횡단 항목 | 점검 내용 | 위반 시 |
|-----------|-----------|---------|
| **데이터 정합성** | 자연키 FK(rcpNo/corpCode) 무결성, 고아 레코드 0 | 마이그레이션/서비스 수정 |
| **마이그레이션 규율** | 신규 모델 마이그레이션 커밋·재현 가능(`migrate deploy`) | 누락 마이그레이션 보완 |
| **테스트 그린** | 직전까지 작성한 단위/통합 테스트 전부 통과(회귀). 취약 도메인 핵심 스위트 `npm run test:core` 그린 | 다음 단계 진입 보류 |
| **AI 비용 추적** | `AIUsageLog` 기록 누락 0, L0 비율·일 한도 준수 | 게이트 재조정/호출 축소 |
| **AI 금지영역** | 주문승인·하드룰·한도·수량·리스크우회에 AI 미개입 | 즉시 차단(설계 결함) |
| **보안/운영** | 시크릿 평문 미커밋, (실서비스 전) HTTPS 전환 | 배포 보류 |
| **문서 동기화** | 스키마·API 변경 시 해당 docs/ 갱신(CLAUDE.md 규칙) | 문서 갱신 후 머지 |

### 3-1. 회귀 테스트 안전망 (DAR-127)

누적 회귀("앞이 무너지면 뒤는 의미 없다")를 코드로 강제하기 위한 표준 검증 절차.

**표준 회귀 명령(백엔드):**

| 명령 | 범위 | 게이트 |
|------|------|--------|
| `cd backend && npx tsc --noEmit` | 전체 타입 정합 | 하드(에러 0) |
| `cd backend && npm run test:core` | 취약 도메인(신호·포트폴리오·페이퍼심·dedup) 핵심 스위트 | 하드(빠른 실패) |
| `cd backend && npm test` | 전체 단위 스위트 누적 회귀 | 하드(전부 그린) |
| `cd mobile && npm run typecheck && npm run bundle:android` | 모바일 타입체크 + Android 번들 | 하드 |

**취약 도메인 핵심 스위트 커버리지(순수 Rule, DB/AI 미개입 — 결정론적):**

| 도메인 | 핵심 순수 모듈 | 비고 |
|--------|----------------|------|
| 신호(engine3) | `buy-signal/scoring/*`(key-metric·risk-penalty·fundamental·persona-fit·chart 등), `event-study/utils/abnormal-return` | 임계값·가중·초과수익 단조성 고정 |
| 포트폴리오(engine4) | `domain/exit-score.calculator`(scoreToAction 5경계·DAR-94 내부자 대량순매도·공시 악재 가중) | 청산 트리거·하드플로어 불변 |
| 페이퍼심(engine5) | `simulation/domain/position-sizing·signal-funnel`, `domain/paper-portfolio·fill-simulator` | 수량·퍼널 분모0 보호·가중평균 진입가 |
| dedup(전 도메인) | `paper-simulation/simulation-entry·simulation-positions`(`dedupeCandidatesByCorpCode`·`dedupeOpenPositionRows`) | 동일 종목 1건만(DAR-122/125) |

**CI 강제(가동 중):** `.github/workflows/regression-ci.yml`이 PR·main push마다 위 게이트를 하드 강제한다(2026-07-02 확인) — 백엔드 `npm run build`(tsc 0) + `test:core` + 전체 jest, 모바일 `typecheck` + `lint` + `bundle:android`(expo export). 같은 ref의 중복 실행은 concurrency로 취소한다. ★`.github/workflows/*` 푸시는 GitHub OAuth `workflow` 스코프가 필요하므로, 워크플로 파일 변경은 스코프 보유 주체(사람/CI 봇)가 커밋한다(DAR-114/DAR-132 선례).

---

## 4. 병행 트랙 (마일스톤과 독립적으로 상시 진행)

| 트랙 | 내용 | 시작 시점 |
|------|------|-----------|
| **기술부채 해소** | 단위/통합 테스트 누적(현 백엔드 337 스위트·약 4,100 테스트 — 2026-07-17 감사 spec 파일 기준; 모바일 jest-expo 26 스위트), CI(`regression-ci.yml`) 하드 게이트 가동 중 — §3-1 | M0부터 점진(DAR-127 안전망 가동) |
| **보안 강화** | HTTPS 완료 — OCI prod에 Caddy + Let's Encrypt + nip.io 적용(`https://168.138.198.152.nip.io/api`, v0.1.1 라이브). CI 보안 잡 가동(npm audit allowlist 게이트 + gitleaks 시크릿 스캔 + dependabot — 갭분석 W17). 잔여: 시크릿 매니저 정리·JWT 로테이션(오너) | 실서비스(M10 이후) 전 필수 |
| **관측성** | 수집/AI/시세 배치 로그·메트릭·알림(실패 시 통지) + 제로런 감지·공개 `/status`(갭분석 W11/W12) | M0(CollectionLog)부터 확장 |
| **비용 모니터링** | KRX/DART/LLM 호출량·비용 대시보드 | M3(AIUsageLog)부터 |
| **C-트랙 (컴플라이언스)** | 데이터 라이선스 원장([docs/compliance/data-license-ledger.md](../compliance/data-license-ledger.md)) 상시 유지 · KRX 서면질의(초안 [krx-inquiry-draft-2026-07.md](../compliance/krx-inquiry-draft-2026-07.md) — 발송·회신 시 원장 판정 갱신, M10 졸업 게이트에 'KRX 라이선스 판정 종결' 연동 검토) · **유사투자자문업 신고 게이트**([체크리스트](../compliance/investment-advisory-registration-checklist.md)) — **과금(MZ) 활성화 전 필수 선행**. 역할·마일스톤별 컴플라이언스 계획 정본은 [roles/plan-policy.md](./roles/plan-policy.md)(M10 모의투자 고지·M11 실매매 약관·M12 자동매매 정책과 연결) | 상시(2026-07-15 갭분석 C-트랙 기동) — 과금·M11 진입 전 게이트화 |

---

## 5. 한눈에 보는 흐름

```
M0 수집안정화 ─┬─ M1 원문파싱 ─ M2 이벤트추출 ─ M3 AI분석+비용계측 ─┐
               │                                    └─ [P-A Persona철학 데이터 + P-C AI해석 결합]  ├─ M6 매수Signal ─ M7 Thesis ─ M8 Exit엔진 ─ M9 백테스트 ─ M10 모의투자+비용검증 ★MVP졸업
               └─ M4 시세데이터(KRX) ────────────── M5 EventStudy ───┘   [P-B 철학별 스코어러 결합]                                              │
                                                                                                                                          M11 반자동 ─ M12 제한적자동
                                                                                                                                                              │
                                                         [P-D 스타일별 모의 자동투자] ─ M13A 미국주식 확장 ─ M13B 코인 확장
        (병행 트랙: 테스트·CI / HTTPS·보안 / 관측성 / 비용 모니터링)
```

> **요약:** 분석 토대(M0~M5)를 먼저 **검증 가능한 품질**로 쌓고 → 판단 엔진(M6~M8)을 올린 뒤 → 백테스트(M9)로 전략을 거르고 → 모의투자(M10)로 **실비용까지 측정**해 MVP를 졸업한다. 이 게이트를 통과하기 전에는 실주문(M11)·자동매매(M12)로 넘어가지 않는다. M12 안정 운영 후 다자산 확장(M13A US_STOCK → M13B CRYPTO)으로 이행한다.

---

## 6. 확장 축 (M12 이후)

### 6-1. 다자산 확장 (M13A/M13B)

국내 주식 파이프라인이 M12까지 검증되면 미국 주식(US_STOCK) → 암호화폐(CRYPTO) 순으로 확장한다.
상세 설계: [cc-multi-asset-expansion.md](./cc-multi-asset-expansion.md)

### 6-2. Persona 철학 엔진 (P-A ~ P-D)

M3과 병행하여 투자 철학 데이터 모델(P-A)을 도입하고, M6 이후 철학별 스코어러(P-B), AI 해석 결합(P-C), M10 이후 스타일별 모의 자동투자(P-D)로 단계적으로 확장한다.
상세 설계: [cc-persona-philosophy-engine.md](./cc-persona-philosophy-engine.md)
