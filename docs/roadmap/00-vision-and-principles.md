# 시스템 비전 및 설계 원칙 (마스터 문서)

> 작성일: 2026-06-02 · 상태: 확장 계획 기준선(SSOT)
> 이 문서는 전체 로드맵의 **단일 진실 공급원(Single Source of Truth)** 이다.
> 각 Phase / 횡단 영역의 상세 준비 문서는 이 문서를 기준으로 작성된다. (인덱스: [README.md](./README.md))

---

## 0. 한 문장 정의

> 공시 알림 앱을 먼저 안정화한 뒤, **공시 원문 파싱 → 이벤트 수치화 → AI 정성 분석 → Persona별 투자 해석 → 주가/차트 결합 → 매수 Signal → Position Thesis 저장 → Exit Signal → 백테스트 → 모의투자 → 반자동매매 → 제한적 자동매매** 순서로 확장한다.

현재 프로젝트는 이 흐름 중 **1번(Disclosure Intelligence)의 초입 = 공시 알림 MVP**에 해당한다. 앞으로 "알림"에서 "투자판단 및 포지션 관리"로 확장한다.

---

## 1. 전체 흐름

```
DART 공시 수집
→ 공시 원문 파싱
→ 이벤트 타입/핵심 수치 추출
→ AI 기반 정성 분석
→ 투자 Persona별 해석
→ 과거 유사 공시 반응 분석
→ 현재가/차트/수급 결합
→ 매수 후보 생성
→ Position Thesis 저장
→ 포트폴리오 지속 Tracking
→ 매도/축소/보유 판단
→ 백테스트
→ 모의투자
→ 반자동매매
→ 제한적 자동매매
```

---

## 2. 5개 엔진 구조

| # | 엔진 | 책임 |
|---|------|------|
| 1 | **Disclosure Intelligence Engine** | DART 공시 수집, 원문 파싱, 이벤트 분류, 핵심 수치 추출 |
| 2 | **AI Analyst Engine** | 공시 의미 해석, 긍정/부정 요인 추출, Persona별 분석, 투자 Thesis 생성 |
| 3 | **Quant & Market Engine** | 과거 유사 공시 반응, 현재가, 차트, 거래량, 시장/업종 지표 분석 |
| 4 | **Portfolio & Exit Engine** | 보유 종목 추적, 매도 점수, 리밸런싱, 손절/익절/논리 훼손 판단 |
| 5 | **Trading & Risk Engine** | 주문 생성, 주문 전 리스크 체크, 모의투자, 반자동매매, 제한적 자동매매 |

**역할 분담 원칙:**
- **AI = 애널리스트** (정성 해석)
- **Quant/Rule Engine = 판단 점수화**
- **Risk Engine = 주문 통제**
- **Execution Engine = 기계적 실행**

---

## 3. 3대 설계 원칙 (절대 원칙)

1. **AI는 모든 공시에 쓰지 않는다.** — 비용 대비 기대값이 있는 공시에만 사용한다.
2. **매수보다 매도·포트폴리오 추적을 먼저 안전하게 설계한다.** — `PositionThesis`와 `ExitSignal`이 핵심.
3. **자동매매는 마지막 단계다.** — 백테스트와 모의투자를 통과한 전략만 제한적으로 허용한다.

---

## 4. AI 적용 위치 (최종)

**AI 필수**
- 공시 원문 의미 해석 / 정성적 리스크 추출 / 이벤트 타입 보정 / Persona별 해석 / Position Thesis 생성 / 매수·매도 리포트 작성

**AI 보조**
- 유사 공시 검색 / 차트 상태 설명 / 정정공시 변경사항 요약 / 보유 논리 유지 여부 설명

**AI 금지 (절대)**
- 최종 주문 승인 / 손절·익절 하드 룰 / 포트폴리오 한도 / 주문 수량 결정 / 리스크 룰 우회

---

## 5. Phase 로드맵 요약 (0~14)

| Phase | 제목 | 핵심 산출물 |
|-------|------|-------------|
| 0 | 프로젝트 기준선 정리 | 초기 범위 제한(대상/공시 5종/Persona 4종/매매범위) |
| 1 | DART 공시 수집 안정화 | Scheduler 안정화, `DisclosureCollectionLog` |
| 2 | 공시 원문 파싱·구조화 | `DisclosureDocument`, 본문/표/key-value 추출 |
| 3 | 이벤트 타입·핵심 수치 추출 | `DisclosureEvent`, 이벤트 enum, 수치 JSON |
| 4 | AI Analyst Engine 도입 | 4개 AI Task, JSON 출력 저장 |
| 5 | 시세·차트·시장 데이터 결합 | 일/분봉, 기술지표, 종목 상태 |
| 6 | 매수 Signal Engine | `TradingSignal`, Buy Score |
| 7 | Position Thesis 저장 | `PositionThesis` (진입 사유·훼손 조건·청산 룰) |
| 8 | Portfolio Tracking & Exit Engine | `ExitSignal`, Exit Score, 6종 매도 기준 |
| 9 | 과거 데이터 기반 Event Study | `EventStudyResult`, 이벤트별 통계 반응 |
| 10 | 백테스트 엔진 | `BacktestRun`/`BacktestTrade`, 보수적 실전 기준 |
| 11 | AI 비용 통제 구조 | Level 0~3 게이트, `AIUsageLog`, 비용 지표 |
| 12 | 모의투자 | `PaperTrade`, 실시간 공시 기반 가상 주문 |
| 13 | 반자동매매 | `OrderRequest`/`OrderExecution`, 사용자 승인 흐름 |
| 14 | 제한적 자동매매 | 검증 전략만 허용, 하드 리스크 룰, Kill Switch |

> 각 Phase의 **상세 준비 문서**는 `docs/roadmap/phase-NN-*.md`에 별도 작성된다.

### 후속 확장 축 (M10 MVP 졸업 이후)

국내주식(KR_STOCK) 기반 시스템이 M10 MVP 졸업 게이트를 통과한 후, 아래 두 축으로 확장한다.

| 축 | 마일스톤 | 한 줄 목표 | 상세 문서 |
|---|---|---|---|
| **다자산 확장** | M13A (미국주식) → M13B (코인) → M14 (통합) | 검증된 5엔진을 자산 추상화 후 US_STOCK·CRYPTO로 단계 확장 | [cc-multi-asset-expansion.md](./cc-multi-asset-expansion.md) |
| **Persona 철학 엔진** | P-A (M3 후) → P-B (M5~M6 병행) → P-C → P-D (M12 후) | 유명 투자자 철학(버핏·린치·그린블라트·드러켄밀러) 구조화 + 철학별 스코어러 + 모의 자동투자 | [cc-persona-philosophy-engine.md](./cc-persona-philosophy-engine.md) |

---

## 6. Phase 상세 (요약 스펙)

### Phase 0 — 프로젝트 기준선 정리
범위를 좁힌다. 전체 상장사/전체 공시/전체 자동매매를 처음부터 목표하면 비용·복잡도가 폭증한다.
- **초기 분석 대상:** 보유 종목, 관심 종목, 거래대금 충분한 종목, 주요 이벤트 공시
- **초기 공시 유형(5종):** 단일판매·공급계약 / 자기주식 취득·소각 / 현금·현물배당 / 유상증자 / 전환사채·신주인수권부사채(CB/BW)
- **초기 Persona(4종):** 가치투자형 / 성장주형 / 모멘텀형 / 이벤트드리븐형
- **초기 매매 범위:** 자동매매 금지, 분석 리포트 + 모의투자 중심
- **목표:** 기술적 가능성이 아니라 **비용 대비 기대값**이 있는 시스템인지 검증

### Phase 1 — DART 공시 수집 안정화
1. 수집 Scheduler 안정화 2. 중복 저장 방지 3. 수집 실행 로그 저장 4. API 실패/재시도 5. 수집 상태 대시보드 6. 관심 종목 기준 필터링 7. 공시 유형 1차 분류 고도화
- 신규 테이블 `DisclosureCollectionLog`: 실행 시각 / 수집 대상 기간 / 수집 건수 / 신규 저장 건수 / 실패 건수 / 에러 메시지 / 실행 상태
- **AI 미사용.** Rule 기반. 목표 = 안정적 수집 파이프라인.

### Phase 2 — 공시 원문 파싱 및 구조화
제목만으로 주가 영향 분석 불가 → 원문 필요.
1. rcpNo 기준 원문 다운로드 2. HTML/XML/첨부 파싱 3. 본문 텍스트 추출 4. 표 데이터 추출 5. 핵심 항목 key-value 변환 6. 정정공시 여부 판단 7. 원공시·정정공시 비교 구조
- 신규 모델 `DisclosureDocument`: rcpNo / rawFilePath / rawText / parsedJson / parseStatus / fetchedAt
- **원칙:** 공시 전문 전체를 AI에 넣지 말 것. 먼저 표·수치를 추출해 AI에 **최소 입력만** 전달 → 비용 통제.

### Phase 3 — 이벤트 타입 및 핵심 수치 추출
정기/주요사항/발행 수준 분류로는 투자판단 불가 → **이벤트 단위**로 쪼갠다.
- 이벤트 enum(예): `SUPPLY_CONTRACT`, `CONTRACT_CANCELLATION`, `SHARE_BUYBACK`, `SHARE_CANCELLATION`, `DIVIDEND_INCREASE`, `DIVIDEND_CUT`, `PAID_IN_CAPITAL_INCREASE`, `THIRD_PARTY_ALLOTMENT`, `CB_ISSUANCE`, `BW_ISSUANCE`, `EARNINGS_SURPRISE`, `EARNINGS_SHOCK`, `MAJOR_SHAREHOLDER_CHANGE`, `LAWSUIT`, `AUDIT_OPINION_RISK`, `TRADING_SUSPENSION`, `DELISTING_RISK`
- 공급계약 예시:
```json
{ "eventType":"SUPPLY_CONTRACT", "contractAmount":120000000000, "recentSales":500000000000,
  "salesRatio":24.0, "counterparty":"거래상대방", "contractStartDate":"2026-06-01",
  "contractEndDate":"2027-05-31", "isAmendment":false }
```
- 유상증자 예시:
```json
{ "eventType":"PAID_IN_CAPITAL_INCREASE", "issueType":"THIRD_PARTY_ALLOTMENT",
  "fundingAmount":50000000000, "purpose":["운영자금","시설자금"], "newShares":10000000,
  "existingShares":50000000, "dilutionRate":20.0, "discountRate":10.0 }
```
- **핵심:** 숫자는 Rule/Parser로, 의미 해석은 AI로 보조.

### Phase 4 — AI Analyst Engine 도입
AI 필수 영역: 공시 의미 해석 / 이벤트 타입 보정 / 긍정·부정 요인 / 리스크 문장 추출 / Persona별 해석 / 매수·보유·매도 Thesis / 사용자 리포트.
- 초기 AI Task 4개:
  1. **Disclosure Summary AI** — 공시 요약, 핵심 포인트, 리스크 요인
  2. **Event Classification AI** — 이벤트 타입/하위 타입/긍정·부정·혼재
  3. **Persona Interpretation AI** — 4 Persona 해석
  4. **Position Thesis AI** — 왜 매수 후보인지, 무엇이 깨지면 매도인지
- 출력은 반드시 JSON 저장:
```json
{ "summary":"대규모 공급계약 체결 공시입니다.", "eventType":"SUPPLY_CONTRACT", "polarity":"POSITIVE",
  "positiveFactors":["계약금액이 최근 매출 대비 24% 수준","계약 기간이 명확함"],
  "negativeFactors":["최근 주가가 이미 단기 급등"],
  "personaViews":[
    {"persona":"GROWTH","view":"POSITIVE","reason":"매출 성장 기여 가능성이 높음"},
    {"persona":"MOMENTUM","view":"WATCH","reason":"거래량 확인 후 진입 필요"}]}
```

### Phase 5 — 시세·차트·시장 데이터 결합
공시가 좋아도 가격이 이미 반영됐거나 시장이 무너지면 매수 금지.
- 필요 데이터: 일봉 / 분봉 / 현재가 / 거래량 / 거래대금 / 시장지수 / 업종지수 / 종목상태(거래정지·관리종목·투자주의)
- 지표: MA5/20/60/120, RSI, MACD, Bollinger, ATR, VWAP, 거래량·거래대금 증가율, 전고점 돌파, 전저점 이탈, 신고가/신저가, 공시 전 선행 상승률
- **차트는 예언 도구가 아니다.** 좋은 용도: 진입 가격 위치 확인 / 과열 판단 / 손익 기준 설정 / 추세 훼손 감지. 나쁜 용도: AI에게 차트만으로 등락 단독 예측.

### Phase 6 — 매수 Signal Engine
```
Buy Score = 공시 이벤트 점수 + 핵심 수치 점수 + Persona 적합도
          + 과거 유사 공시 성과 + 현재 차트 점수 + 거래량/수급 점수
          + 시장/업종 분위기 점수 − 리스크 패널티
```
- 신호 등급: 80↑ 강한 매수후보 / 60~79 매수후보 / 30~59 관심·관망 / −29~29 중립 / −30↓ 회피
- 예시:
```json
{ "stockCode":"123456","eventType":"SUPPLY_CONTRACT","persona":"GROWTH_MOMENTUM",
  "buyScore":78,"signal":"BUY_CANDIDATE",
  "entryCondition":["현재가가 20일선 위","공시 후 거래량 20일평균 대비 300%↑","전일 고가 돌파"],
  "riskFactors":["최근 5거래일 +18%","단기 과열 가능성"] }
```
- **자동매수 금지.** 백테스트·모의투자로 검증 먼저.

### Phase 7 — Position Thesis 저장
매수 신호 발생 시 반드시 "왜 샀는지"를 저장해야 매도 판단이 가능하다.
- `PositionThesis`: 진입 사유 / 관련 공시 / 적용 Persona / 핵심 매수 논리 / 논리 훼손 조건 / 목표 보유 기간 / 손절·익절·트레일링 스탑 기준 / 최대 비중
```json
{ "entryReason":"대규모 공급계약 공시","persona":"GROWTH_MOMENTUM",
  "initialThesis":["계약금액 최근 매출 대비 24%","거래상대방 안정적","공시 후 거래량 급증","20일선 위 추세 유지"],
  "invalidConditions":["계약금액 축소 정정공시","계약 해지","공시 후 5거래일 내 거래량 급감","20일선 종가 이탈","시장 대비 초과수익 부재"],
  "takeProfitRule":{"partialSell":"+12%","trailingStop":"-6% from high"},
  "stopLossRule":{"hardStop":"-7%","thesisStop":"핵심 매수 논리 훼손"} }
```

### Phase 8 — Portfolio Tracking & Exit Engine (매수보다 중요)
매도 기준 6종: 1) 손실 제한(하드스탑/ATR/포트폴리오 손실한도) 2) 수익 실현(분할익절/트레일링) 3) 투자논리 훼손(정정/취소/실적 미반영/증자 악화) 4) 시간 제한(반응 없음/거래량 감소/초과수익 부재) 5) 차트 훼손(5·20일선 이탈/VWAP 이탈/전저점 이탈/장대음봉) 6) 리밸런싱(종목·섹터·이벤트 비중 초과)
```
Exit Score = 손실리스크 + 투자논리훼손 + 차트훼손 + 공시악화 + 과다비중 + 시간초과 − 긍정모멘텀 유지
```
- 0~29 보유 / 30~49 주의 / 50~69 일부 축소 / 70↑ 전량 매도후보 / 90↑ 즉시 리스크 매도
- 액션 5종: `HOLD` / `WATCH` / `REDUCE` / `EXIT` / `BLOCK_REBUY`
- 보유 포지션 하루 3회 점검(장 시작 전 / 장중 / 장 마감 후)

### Phase 9 — 과거 데이터 기반 Event Study
자동매매로 가려면 감이 아니라 통계.
1. 과거 공시 수집 2. 이벤트 라벨링 3. D0 지정 4. D-20~D+20 주가 연결 5. 시장 대비 초과수익 6. 업종 대비 초과수익 7. 이벤트 타입별 평균 반응 저장
- 지표: D+1/D+3/D+5/D+20 평균수익, 상승확률, 급락확률, 평균 최대낙폭, 거래량 증가율, 시장·업종 대비 초과수익
- 세분화 예(공급계약): 계약금액/최근매출 5%미만 · 5~20% · 20%이상 · 정정 · 취소 · 대기업 상대방 · 해외 상대방

### Phase 10 — 백테스트 엔진
반영 필수: 공시 시각, 장중/장마감 후 구분, 다음 거래일 시가 진입, 수수료, 세금, 슬리피지, 거래정지, 상·하한가, 유동성 부족, 부분 체결, 관리종목 제외.
- 성과 지표: 총·연환산 수익률, 승률, 평균 수익/손실, 손익비, MDD, Sharpe, 거래 횟수, 월별 수익, 이벤트·Persona별 성과, 최악 거래 10개
- 실전 투입 기준(보수적): 상승/하락/횡보장 모두 테스트 / 수수료·세금·슬리피지 반영 후 수익 유지 / 한두 종목 의존 금지 / 이벤트별 표본 충분 / MDD 감당 가능 / 최근 구간 성과 유지

### Phase 11 — AI 비용 통제 구조 (생존 조건)
AI를 모든 공시에 쓰지 말고 **돈 쓸 가치 있는 공시에만**.
- 비용 게이트 4단계:
  - **L0 미사용:** 단순 정기공시, 관심 외 기업, 거래대금 부족, 관리종목/투자위험, 매매 관련성 낮음
  - **L1 저비용:** 매매 관련 공시 판별, 이벤트 대략 분류, 상세 분석 필요 여부
  - **L2 중간급:** 요약, 긍정·부정 요인, Persona 해석, Thesis 생성
  - **L3 고성능:** 실제 주문 후보, 보유종목 악재, 복잡한 증자/CB/BW, 정정공시 비교, 손실 종목 매도 판단
- 초기엔 GPU 서버 임대 X → 외부 API + 호출량·비용·성과 기록. 이후 자체 서빙 검토.
- `AIUsageLog` + 지표: AI Cost Per Disclosure/Signal/Executed Trade, AI Cost/Gross·Net Profit, Avoided Loss, False Positive/Negative Cost
- 운영 기준: AI비용/순수익 < 10% 목표(초기 검증 20%까지 허용), 초과 시 호출 범위 축소

### Phase 12 — 모의투자
실제 시장 데이터로 가상 주문. 1. 실제 공시 2. 실제 현재가 3. 실제 AI 분석 4. 시그널 생성 5. 가상 주문 6. 가상 체결 7. 가상 포트폴리오 8. 실제 결과 비교
- 검증: 수집 지연, 파싱 실패율, AI 비용, 시그널 속도, 현재가 API 지연, 체결 가능성, 손절·익절 작동, 매도 정확도, 리스크 관리
- 모의투자 손실은 실패가 아니라 실전 전 약점 발굴.

### Phase 13 — 반자동매매
1. 공시 2. 분석 3. Buy/Exit Signal 4. **Risk Engine 검토** 5. 사용자에게 주문안 제시 6. 사용자 승인 7. 증권사 API 주문 8. 체결 저장 9. 포트폴리오 반영
- 매수/매도 카드 UI(Score, 근거, 리스크, 주문 제안, [승인][거절][관망]).

### Phase 14 — 제한적 자동매매 (마지막)
검증된 일부 이벤트에만 제한 적용.
- 자동화 검토 가능: 자기주식 취득·소각 / 대규모 공급계약 / 배당 확대 / 실적 서프라이즈 / 명확한 악재 해소
- 자동매매 금지: 유상증자 / CB / 감사의견 / 거래정지·상폐 / 소송·횡령·배임 / 관리종목 / 초저유동성 / 정치·테마 급등주
- 하드 리스크 룰: 1회 주문 최대 1~3% / 단일종목 최대 5~10% / 1일 최대손실 −2% / 1주 최대손실 −5% / 재진입 제한 / 연속손실 N회 자동중단 / 시장 급락 시 신규매수 중단 / API 오류 시 주문 중단 / 수동 Kill Switch
- **Risk Engine이 거부하면 AI가 아무리 긍정적이어도 주문 금지.**

---

## 6-2. 이후 확장 축 (Phase 14 이후, 예정)

> 아래 두 축은 국내 MVP(M10) 졸업 이후 착수한다. 상세 설계 문서를 참조할 것.

### 다자산 확장 (M13A/B, 예정)

국내 주식 파이프라인이 M12까지 검증되면 미국 주식 → 암호화폐 순으로 확장한다.

| 단계 | 자산군 | 착수 조건 |
|------|--------|---------|
| M13A | US_STOCK (미국 주식) | M12 안정 운영 3개월 + Polygon.io PoC |
| M13B | CRYPTO (암호화폐) | M13A 모의투자 90일 검증 완료 |

설계 원칙: 5엔진 재사용 + 자산별 어댑터 교체(헥사고날 포트 확장). 환율 변환, 24/7 캘린더, 자산군별 세금·리스크 파라미터를 별도 구현.

> 상세: [cc-multi-asset-expansion.md](./cc-multi-asset-expansion.md)

### Persona 철학 엔진 (P-A~P-D, M3 이후 점진, 예정)

현행 4개 Persona(가치·성장·모멘텀·이벤트드리븐) 해석을 **유명 투자자 철학 데이터 모델**로 구조화하고, 철학별 정량 스코어러(Rule) + AI 해석 결합 + 스타일별 모의 자동투자로 확장한다.

| 단계 | 내용 | 착수 시점 |
|------|------|---------|
| P-A | 철학 데이터 모델·시드 (버핏·린치·그린블랫·드러켄밀러·사이먼스) | M3 완료 후 |
| P-B | 철학별 정량 스코어러 (ROE·PEG·마법공식 등, Rule 기반) | M6 완료 후 |
| P-C | AI 해석과 철학 결합 (공시별 스타일 관점 해석문) | P-A + M3 완료 후 |
| P-D | 스타일별 모의 자동투자 | M10 완료 후 |

> 상세: [cc-persona-philosophy-engine.md](./cc-persona-philosophy-engine.md)

---

## 7. DB 확장 방향

**기존:** Disclosure, Company, WatchList, NotificationHistory (+ User, Device, NotificationSettings, SavedDisclosure, CompanyOverview)

**추가 필요:**
`DisclosureDocument`, `DisclosureEvent`, `DisclosureAnalysis`, `InvestorPersona`, `PersonaAnalysis`, `StockDailyPrice`, `StockMinutePrice`, `TechnicalIndicator`, `EventStudyResult`, `TradingSignal`, `Portfolio`, `Position`, `PositionThesis`, `PositionDailySnapshot`, `ExitSignal`, `PortfolioRiskSnapshot`, `BacktestRun`, `BacktestTrade`, `PaperTrade`, `OrderRequest`, `OrderExecution`, `TradingAuditLog`, `AIUsageLog`

**가장 중요한 9개 착수 단위:**
1. `DisclosureDocument` 2. `DisclosureEvent` 3. `AIUsageLog` 4. `StockDailyPrice` 5. `TradingSignal` 6. `Portfolio` 7. `Position` 8. `PositionThesis` 9. `ExitSignal`

---

## 8. 개발 우선순위

1. **공시 분석 기반** — DART 수집 안정화 / 원문 다운로드 / `DisclosureDocument` / 주요 공시 5종 파싱 / `DisclosureEvent`
2. **AI 분석 최소 도입** — 공시 요약 / 이벤트 분류 / 긍정·부정 / Persona 해석 / `AIUsageLog`
3. **시세 데이터 결합** — 일봉 / 현재가 / 거래량·거래대금 / 기본 차트 지표 / 공시 전후 수익률
4. **매수 Signal Engine** — Buy/Persona/Chart Score, Risk Penalty, 매수 후보 리포트
5. **포트폴리오/매도 시스템** — Portfolio / Position / PositionThesis / ExitSignal / Exit Score / 분할매도·손절·트레일링
6. **백테스트** — 이벤트·Persona별 성과, 매도 룰 검증, AI 사용 여부별 비교
7. **모의투자** — 실시간 공시 기반 가상 주문, 성과·AI 비용 측정
8. **반자동매매** — 주문안 생성, 승인, 증권사 API, 체결·리스크 로그
9. **제한적 자동매매** — 검증 전략만, 소액·소비중, 강한 리스크 룰, Kill Switch

---

## 9. 가장 현실적인 MVP

**목표:** 공시 기반 투자 리포트 + 모의투자 시스템
**범위:** 관심 종목 50개 이하 / 주요 공시 5종 / Persona 4개 / 매수·매도 후보 생성 / 실제 주문 없음
**기능:** 1 공시 수집 2 원문 파싱 3 이벤트 분류 4 AI 요약 5 Persona 해석 6 현재가·차트 결합 7 Buy Score 8 Exit Score 9 포트폴리오 Tracking 10 Paper Trading 11 AI 비용 로그

**검증 질문 (단 하나):**
> 이 시스템이 AI 비용과 데이터 비용을 제하고도 실제로 투자 판단 개선에 도움이 되는가?

이 답이 나오기 전까지 자동매매는 붙이지 않는다.
