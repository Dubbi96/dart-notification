> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# 데이터·Quant 역할 정의서

> 작성일: 2026-06-02 · 담당 파트: DQ (데이터·Quant)

---

## 1. 역할 정의 & 책임 범위

### 이 파트가 소유하는 것

**점수 공식과 가중치의 단일 소유자(SSOT).** 데이터·Quant 파트는 시스템에서 생성되는 모든 점수(Buy Score, Exit Score)의 공식·가중치·판정 임계값을 정의하고 유지한다. 어떤 파트도 DQ의 승인 없이 이 수치를 변경할 수 없다.

| 소유 영역 | 설명 |
|-----------|------|
| 이벤트별 수치 추출 규칙 | `salesRatio`, `dilutionRate` 등 파생값 계산 공식 (M2) |
| 시세·지표 파이프라인 | KRX 일봉·기술지표 계산 로직 전체 (M4) |
| Event Study 방법론 | D-20~D+20 AR 계산, 세분화 버킷, 표본·유의성 기준 (M5) |
| Buy Score 공식 | 7컴포넌트 공식, 가중치 config, 등급 임계값 (M6) |
| Exit Score 공식 | 6트리거 공식, 판정 임계값, 5액션 매핑 (M8) |
| 백테스트 로직 | 현실 제약 시뮬레이션, 성과지표 공식, Gate 기준 6개 (M9) |
| 체결 시뮬레이션 가정 | 슬리피지·부분체결·유동성 기준 (M10 협업) |
| 전략 통계 검증 | 자동매매 전략 졸업 기준 협의 (M12 협업) |

### 다른 파트와의 경계

| 구분 | 경계 |
|------|------|
| **DQ ↔ BE** | DQ는 공식·알고리즘 설계를 제공하고, BE는 NestJS 서비스로 구현한다. 구현 코드(`*.service.ts`)는 BE 소유지만 로직의 정확성 검증은 DQ 책임이다. |
| **DQ ↔ AI** | AI가 출력한 정성 해석(`polarity`, `personaViews`)은 DQ 점수 공식의 **입력**에 불과하다. AI가 점수를 직접 결정하거나 가중치를 제안하는 구조는 금지. DQ가 AI 출력을 Rule로 변환하는 어댑터 로직을 설계한다. |
| **DQ ↔ 화면/시나리오** | DQ는 Score 값과 컴포넌트 breakdown을 JSON으로 제공한다. 화면에 어떻게 표시할지는 FE·화면 기획 파트의 영역이다. |
| **DQ ↔ QA** | M9 회귀 체크포인트에서 QA와 lookahead bias 감사를 공동 수행한다. DQ가 점수 공식·데이터 쿼리 설계를, QA가 감사 게이트 운영을 담당한다. |
| **DQ ↔ 정책** | 손절·익절 하드 룰 수치(%, 기간)는 DQ가 공식으로 제안하고, 정책 파트가 리스크 고지 및 약관 반영 여부를 검토한다. 최종 수치는 정책 파트 동의 후 확정. |

---

## 2. 마일스톤별 업무 (M0~M12)

---

### M0 — 기준선 & 수집 안정화 | **해당 없음 (·)**

해당 없음(다른 파트 산출물 대기). M0는 BE·화면·시나리오·정책 파트가 주담당이다.

**DQ가 이 단계에서 확인할 점:**
- 분석 대상 공시 5종(단일판매·공급계약 / 자기주식 취득·소각 / 현금·현물배당 / 유상증자 / CB·BW)이 확정되는 범위 문서를 검토하여, 각 이벤트에 필요한 수치 추출 항목 초안을 내부 작성한다.
- `Company.stockCode`, `Company.market` 필드의 현재 완성도를 확인한다(M4 시세 매핑 기반). feature-status에서 `market` 컬럼이 불완전하다고 표기됨 — M4 착수 전 보완 계획 확인 필요.

---

### M1 — 공시 원문 파싱 | **협업 C**

**역할:** 파싱 결과물이 M2 수치 추출에 충분한지 검토한다.

- [ ] `DisclosureDocument.parsedJson`의 표 구조가 이벤트별 수치 추출에 적합한지 샘플 검토 (5종 이벤트 각 3건 이상)
- [ ] 표 파싱 실패 케이스(파싱 실패 시 수치 추출 불가) 패턴을 BE에 피드백하여 파서 보강 요청
- [ ] `salesRatio`, `dilutionRate` 계산에 필요한 필드(최근 매출액, 발행주식수, 기준주가 등)가 `parsedJson`에 포함되는지 확인
- [ ] 파생값 계산 공식 초안 작성 (단위 정규화 규칙 포함: 억원/원/백만원 → 원 통일)

**받는 것:** BE의 `DisclosureDocument` 스키마 확정본, 파서 샘플 출력 JSON

---

### M2 — 이벤트·수치 추출 | **주담당 R**

**역할:** 이벤트별 수치 추출 Rule과 파생값 공식을 정의하고, BE 구현을 검증한다.

- [ ] `EventType` enum 15종 확정 — SUPPLY_CONTRACT / CONTRACT_CANCELLATION / SHARE_BUYBACK / SHARE_CANCELLATION / DIVIDEND_INCREASE / DIVIDEND_CUT / PAID_IN_CAPITAL_INCREASE / THIRD_PARTY_ALLOTMENT / CB_ISSUANCE / BW_ISSUANCE / EARNINGS_SURPRISE / EARNINGS_SHOCK / MAJOR_SHAREHOLDER_CHANGE / LAWSUIT / AUDIT_OPINION_RISK / TRADING_SUSPENSION / DELISTING_RISK
- [ ] 이벤트별 `extractedData` JSON 스키마 확정 (8종 이벤트 타입별 필드 목록)
- [ ] 파생값 계산 공식 확정 및 문서화:
  - `salesRatio = (contractAmount / recentSales) * 100`
  - `dilutionRate = (newShares / existingShares) * 100`
  - `discountRate = ((referencePrice - issuePrice) / referencePrice) * 100`
  - `maxDilutionRate = (maxDilutionShares / existingShares) * 100` (CB/BW)
  - `changeRate` (배당 YoY 성장률): `(current - previous) / previous * 100`
  - `claimAmountToAssets = (claimAmount / totalAssets) * 100`
- [ ] 단위 정규화 규칙 문서화 (억원·백만원·원 혼재 처리)
- [ ] `confidence` 임계값 기준 정의: Rule confidence ≥ 0.85 → AI 미사용, 0.60~0.85 → AI L1 보조, < 0.60 → NEEDS_REVIEW
- [ ] 재무 데이터(매출액, 발행주식수) 미확보 시 null 처리 및 `derivedDataMissing: true` 플래그 정책 수립
- [ ] 샘플 100건 파싱 결과에 대해 수치 추출 정확도 수동 검증 (5종 이벤트 타입별 최소 10건)
- [ ] `extractedData` JSON 최대 크기 기준 정의 (목표: 이벤트당 평균 2KB 이하)

**↩︎ M1 회귀 확인:** `parsedJson` 표 누락이 수치 추출 실패로 전파되는 비율이 임계치(목표: 10% 이하) 초과 시 M1 파서 보강 요청.

**넘기는 것:** 이벤트별 수치 JSON 스키마 명세서, 파생값 계산 공식 문서 → BE(구현), AI(L1 보조 기준)

---

### M3 — AI Analyst + 비용계측 토대 | **해당 없음 (·)**

해당 없음(다른 파트 산출물 대기). AI·BE 파트 주담당.

**DQ가 이 단계에서 확인할 점:**
- AI의 `eventType` 보정 결과가 DQ가 정의한 M2 Rule 분류와 불일치하는 비율을 모니터링한다. 불일치율 급증 시 M2 매핑 Rule 재점검 트리거.
- AI가 출력하는 `polarity` 및 `personaViews` JSON 스키마가 M6 Buy Score의 C1(polarity 보정), C3(Persona 적합도) 컴포넌트 입력 형식과 호환되는지 확인. 불일치 시 AI 파트에 스키마 수정 요청.
- L0 비율(AI 미사용) ≥ 70% 유지 여부 관찰 — 과도한 AI 호출이 발생하면 M2 Rule 정확도 문제일 수 있음.

---

### M4 — 시세·시장 데이터 | **주담당 R**

**역할:** KRX 일봉 기반 기술지표 계산 로직 전체를 설계하고 BE 구현을 검증한다.

#### 데이터 모델 설계
- [ ] `StockDailyPrice` 필드 정의 (stockCode, tradeDate, openPrice, highPrice, lowPrice, closePrice, volume, tradingValue, changeRate)
- [ ] `TechnicalIndicator` 필드 정의 — 이하 지표 전체 포함:
  - 이동평균: MA5, MA20, MA60, MA120
  - 모멘텀: RSI14 (Wilder 스무딩), MACD Line/Signal/Histogram (12/26/9 EMA)
  - 변동성: Bollinger Upper/Middle/Lower (20, 2σ), ATR14 (Wilder 스무딩)
  - 수급: VWAP (당일 분봉 기반), volRatio20 (20일 평균 거래량 대비 배수), valRatio20 (거래대금 비율)
  - 가격 위치: highBreak52w, lowBreak52w, prevHighBreak (최근 60일), prevLowBreak (최근 60일)
  - 공시 전 선행상승률: preDisclosureReturn (D-5 ~ D-1, 직전 5거래일 수익률)
- [ ] `StockStatus` 필드 정의 (isTradingSuspended, isManagement, isInvestmentCaution, isAbnormalSurge)
- [ ] `MarketIndex` 필드 정의 (indexCode, indexName, tradeDate, closeValue, changeRate)

#### 지표 계산 공식 확정 및 문서화
- [ ] **MA**: 단순이동평균 `sum(closes[-N:]) / N`
- [ ] **RSI (Wilder 스무딩)**: 초기 평균 단순평균, 이후 `avgGain = (prevAvgGain * 13 + gain) / 14`, `RSI = 100 - (100 / (1 + avgGain/avgLoss))`
- [ ] **MACD**: EMA12 - EMA26, 시그널 = EMA9(MACD), 히스토그램 = MACD - 시그널. EMA 초기값 = 단순평균, 이후 `k = 2/(n+1)` 지수가중
- [ ] **Bollinger Bands**: MA20 ± 2 × 표본표준편차(closes[-20:])
- [ ] **ATR (Wilder)**: TR = max(high-low, |high-prevClose|, |low-prevClose|), Wilder 스무딩 14일
- [ ] **VWAP**: `sum(closePrice[i] * volume[i]) / sum(volume[i])` (당일 분봉)
- [ ] **거래량 비율**: `volRatio20 = todayVolume / mean(volume[-20:])`, `valRatio20 = todayTradingValue / mean(tradingValue[-20:])`
- [ ] **전고/전저 돌파**: `prevHighBreak = todayHigh > max(recent60High)`, `prevLowBreak = todayLow < min(recent60Low)` (오늘 제외)
- [ ] **52주 신고가/신저가**: 직전 252거래일 기준
- [ ] **공시 전 선행상승률**: `preDisclosureReturn = (priceD_1 - priceD_6) / priceD_6 * 100` (rcpDt 기준 직전 거래일=D-1, 6번째 직전 거래일=D-6)

#### 검증
- [ ] MA20, RSI14, MACD 값을 외부 참조(네이버 금융 또는 KRX 공식 데이터)와 오차 1% 이내 비교 검증 (임의 3종목 × 최소 10일)
- [ ] 선행상승률 임의 공시 3건에 대해 수동 계산 값과 비교 검증
- [ ] null 안전성: 신규 상장(데이터 250일 미달) 종목 요청 시 해당 지표 null 반환, 에러 없음 확인
- [ ] 지표 계산 배치(19:00 cron) 3거래일 연속 정상 실행 + `TechnicalIndicator` 저장 확인

**↩︎ M0 회귀 확인:** `Company.stockCode` / `market` 오매핑 비율 측정. 빈 값·오매핑이 시세 수집 실패로 이어지는 비율 임계 초과 시 seed 데이터 보완 요청.

**넘기는 것:** 지표 계산 공식 명세서 → BE(구현), M5(Event Study 입력), M6(Buy Score 입력)

---

### M5 — Event Study | **주담당 R**

**역할:** 과거 공시 이벤트에 대한 주가 반응 통계 방법론 전체를 설계하고 산출물을 검증한다.

#### 방법론 설계
- [ ] **D0 지정 알고리즘** 확정:
  - 장중 공시(09:00~15:20): 당일 D0
  - 장마감 후·장전·휴일: 다음 거래일 D0
  - `rcpDt`가 YYYYMMDD 8자리만인 경우(시각 불명): 보수적으로 다음 거래일 D0
- [ ] **관측 윈도우**: D-20 ~ D+20 (총 41거래일)
- [ ] **초과수익(AR) 계산 방법** 확정:
  - 1차: 단순 차분법 `AR_t = R_stock_t - R_market_t`
  - 고급 옵션(추후): 사전 추정 기간(D-120 ~ D-21) CAPM beta 추정 후 AR
- [ ] **누적 초과수익(CAR)**: D+1, D+3, D+5, D+20 누적 합산
- [ ] **통계 검정**: 표본 t-검정(단측/양측), `p < 0.05` 유의 기준, 표본 수 n 반드시 함께 기록
- [ ] **이상치 제거**: |AR| > 3σ 관측치 제외 후 재집계, 시장 급락일(|mktReturn| > 5%) 이상치 플래그

#### 세분화 버킷 설계 (5종 이벤트)
- [ ] **SUPPLY_CONTRACT**: `ratio_lt5` (< 5%) / `ratio_5to20` (5~20%) / `ratio_gte20` (≥ 20%) / `amendment` / `cancellation` / `large_corp` / `overseas` / `ratio_gte20__large_corp` (복합)
- [ ] **SHARE_BUYBACK**: `ratio_lt1` / `ratio_1to3` / `ratio_gte3` (취득규모/시총 기준)
- [ ] **SHARE_CANCELLATION**: `all`
- [ ] **PAID_IN_CAPITAL_INCREASE**: `third_party_lt10pct_dilution` / `third_party_gte10pct_dilution` / `rights_offering`
- [ ] **CB_ISSUANCE**: `ratio_lt5` / `ratio_gte5` (발행금액/시총 기준)
- [ ] **BW_ISSUANCE**: `all`
- [ ] **DIVIDEND_INCREASE**: `gte20pct_yoy` / `lt20pct_yoy`
- [ ] **DIVIDEND_CUT**: `all`

#### 표본·유의성 기준
- [ ] 버킷당 최소 표본 n ≥ 30건 → `status = READY`, 미달 → `status = INSUFFICIENT` (점수 기여 0)
- [ ] M6 연결 점수화: `avgArD5 ≥ 5%` → +10점, `2~5%` → +5점, `upProbD5 ≥ 0.65` → +5점 추가, `crashProbD5 ≥ 0.20` → -5점 패널티. 유의하지 않은 버킷 → 0점
- [ ] 서바이버십 편향 처리: 상장폐지·거래정지 종목 관측치 포함, 정지일 이후 수익률 `-100%` 기록, 별도 집계 분리 플래그

#### 산출물 저장 확인
- [ ] `EventStudyResult` 모델 — eventType, bucketKey, marketType, sampleCount, isSignificant, tStatistic, pValue, avgArD1/D3/D5/D20, avgReturnD1/D3/D5/D20, upProbD5, crashProbD5, avgMaxDrawdown, avgVolumeRatioD1/D3
- [ ] `EventStudyObservation` 모델 — 관측치별 dailyReturns, dailyAR, cumulativeAR, volumeRatios, maxDrawdown 저장
- [ ] `SUPPLY_CONTRACT__ratio_gte20` 버킷 표본 30건 이상 집계, t-통계·p-값 계산 확인

**↩︎ M4 회귀 확인:** 가격 데이터 결측이 통계 왜곡을 일으키지 않는지 — 결측 종목 제외/보정 규칙 적용. `StockDailyPrice` 결측률 < 2% 기준 유지.

**↩︎ M2/M3 회귀 확인:** 이벤트 라벨 오류율이 높은 이벤트는 버킷 통계 신뢰 강등(표본 수 공개 + 신뢰도 경고 추가).

**넘기는 것:** `EventStudyResult` DB 산출물, `getEventStudyScore()` 인터페이스 → BE(M6 BuyScoreService 주입), M9(백테스트 성과 비교)

---

### M6 — 매수 Signal Engine | **주담당 R**

**역할:** Buy Score 7컴포넌트 공식과 가중치를 확정하고, 신호 등급·진입 조건 기준을 정의한다.

#### Buy Score 공식 확정 및 문서화
```
Buy Score = W1 × DisclosureEventScore  (이벤트 기본 점수 + polarity 보정)
          + W2 × KeyMetricScore         (파생값 기반 수치 점수)
          + W3 × PersonaFitScore        (AI personaViews → Rule 변환)
          + W4 × HistoricalEventScore   (EventStudyResult 기반 D+5 AR 점수)
          + W5 × ChartScore             (TechnicalIndicator 기반 조건 점수)
          + W6 × VolumeLiquidityScore   (거래량·거래대금 비율 점수)
          + W7 × MarketSectorScore      (시장·업종 지수 방향 점수)
          − RiskPenalty                 (위험 패널티, 양수 값)
```

#### 가중치 config 확정 (`buy-signal.config.ts`)
- [ ] 기본 가중치 정의: W1=0.25, W2=0.20, W3=0.15, W4=0.10, W5=0.15, W6=0.10, W7=0.05
- [ ] Phase 9 미완료 시 W4=0 & 나머지에 비례 재배분 로직 정의
- [ ] 가중치 합 검증 규칙: 서버 시작 시 합 = 1.0 ± 0.001 범위 이탈 시 시작 실패
- [ ] 환경변수 기반 config 오버라이드 지원 (`BUY_SIGNAL_W1` 등)

#### 컴포넌트별 점수화 규칙 설계
- [ ] **C1 DisclosureEventScore**: 이벤트 타입 기본 점수 맵 확정 (SUPPLY_CONTRACT=70, SHARE_CANCELLATION=80, AUDIT_OPINION_RISK=-90, TRADING_SUSPENSION=-100 등), polarity 보정 계수 (NEGATIVE=0.5, MIXED=0.7, POSITIVE=1.0)
- [ ] **C2 KeyMetricScore**: 이벤트 타입별 수치 구간 → 점수 테이블 확정:
  - SUPPLY_CONTRACT: salesRatio ≥ 30% → 100, 20~30% → 80, 10~20% → 60, 5~10% → 40, 1~5% → 20, < 1% → 0
  - PAID_IN_CAPITAL_INCREASE: dilutionRate ≥ 30% → -100, 20~30% → -80, 10~20% → -60, 5~10% → -40, < 5% → -20
  - SHARE_CANCELLATION: cancellationRatio ≥ 5% → 100, 3~5% → 80, 1~3% → 60, < 1% → 30
  - DIVIDEND_INCREASE: yoyGrowth ≥ 50% → 100, 20~50% → 70, 5~20% → 40, < 5% → 10
  - CB_ISSUANCE: fundingAmount/marketCap ≥ 20% → -80, 10~20% → -50, < 10% → -20
  - EARNINGS_SURPRISE: surpriseRate ≥ 30% → 100, 15~30% → 70, 5~15% → 40, < 5% → 10
- [ ] **C3 PersonaFitScore**: AI personaViews 변환 Rule (POSITIVE=100, WATCH=40, NEUTRAL=0, NEGATIVE=-60)
- [ ] **C4 HistoricalEventScore**: EventStudyResult D+5 AR 기반 점수 테이블 (≥10%→100, 5~10%→70, 2~5%→40, 0~2%→10, -3~0%→-30, <-3%→-70)
- [ ] **C5 ChartScore**: CHART_RULES 가중 체크리스트 확정 (20일선 위=+20, 60일선 위=+15, RSI<70=+10, RSI>30=+10, MACD 골든크로스=+15, BB 중심선 위=+10, 5일선 아래=-20, 선행상승 5일 15%↑=-30)
- [ ] **C6 VolumeLiquidityScore**: 거래대금 < 10억 → -100(하드 차단), volRatio ≥ 5 → 100, ≥ 3 → 70, ≥ 2 → 40, ≥ 1 → 10, < 1 → -20
- [ ] **C7 MarketSectorScore**: 시장 1일 등락 기준 점수 테이블, VIX 등가 > 30 → -30 패널티

#### RiskPenalty 기준 확정
- [ ] BLOCKED 조건 (점수 무관 신호 차단): 거래정지, 관리종목, 투자주의, 상폐위험, AUDIT_OPINION_RISK, TRADING_SUSPENSION
- [ ] 누적 패널티: 5일 20%↑ 급등 → +40, 10%↑ → +20, isAmendment → +15, 희석률 15%↑ 유상증자 → +30, 저유동성(20일 평균 10만주 미만) → +20

#### 신호 등급 임계값 확정
- [ ] STRONG_BUY_CANDIDATE: 80 이상
- [ ] BUY_CANDIDATE: 60~79
- [ ] WATCH: 30~59
- [ ] NEUTRAL: -29~29
- [ ] AVOID: -30 이하
- [ ] BLOCKED: 하드 차단 조건

#### 진입 조건 체크리스트 확정
- [ ] 필수 조건: 현재가 > MA20, RSI < 70, 거래대금 ≥ 10억
- [ ] 선택 조건: 거래량 20일 평균 대비 300%↑, 전일 고가 돌파

**↩︎ M5 회귀 확인:** Event Study 통계가 C4 점수에 실제 반영되는지, 표본 부족 이벤트의 가중 감쇠(W4 재배분)가 동작하는지 확인.

**↩︎ M3 회귀 확인:** AI polarity 방향과 최종 Buy Score 방향의 일치율 측정. 불일치율 > 20% 시 C1 polarity 보정 계수 재검토.

**넘기는 것:** `buy-signal.config.ts` (가중치·임계값 config 파일) → BE(구현), 화면(점수 분해 표시 명세), M9(백테스트 파라미터)

---

### M7 — Position Thesis | **협업 C**

**역할:** `invalidConditions` 항목이 기계 평가 가능한 형태인지를 Quant 관점에서 검토한다.

- [ ] `PositionThesis.invalidConditions` 배열 항목이 M4 지표(MA5/MA20, ATR, VWAP), M2 이벤트(CONTRACT_CANCELLATION, PAID_IN_CAPITAL_INCREASE), M5 통계(초과수익 부재)로 **기계 평가 가능한 형태**로 작성되었는지 검토
- [ ] 추상 문장("시장 분위기 악화") 포함 시 M8 Exit 평가 불가 → 수치화 가능한 조건으로 수정 요청 (예: "KOSPI -3% 이상 하락 3일 연속")
- [ ] `stopLossPct`, `takeProfitPct`, `trailingStopPct` 기본값 제안 (DQ 설계 기반): 손절 -7%, 익절 +12%, 트레일링 -6%

**받는 것:** BE의 `PositionThesis` 스키마 확정본

---

### M8 — Portfolio & Exit Engine | **주담당 R**

**역할:** Exit Score 6트리거 공식과 판정 임계값을 확정하고 BE 구현을 검증한다.

#### Exit Score 공식 확정
```
Exit Score = lossRiskScore       (0~20)
           + thesisBreakScore    (0~20)
           + chartBreakScore     (0~20)
           + disclosureRiskScore (0~20)
           + overweightScore     (0~10)
           + timeExceededScore   (0~10)
           − positiveMomentumBonus (0~20)
범위: -20 ~ 100
```

#### 판정 임계값 확정
- [ ] 0~29 → HOLD
- [ ] 30~49 → WATCH
- [ ] 50~69 → REDUCE (25~50% 매도 제안)
- [ ] 70~89 → EXIT
- [ ] 90~100 → EXIT + BLOCK_REBUY (즉시 리스크 매도)

#### 6트리거 점수화 규칙 확정 및 문서화
- [ ] **트리거 1 (lossRiskScore)**: 하드스탑(`stopLossPct` 도달) → 즉시 20점; ATR 기반 이탈(1.5×ATR 이하) → 15점; 트레일링 스탑(고점 대비 -6%, 수익권에서만) → 12점; 포트폴리오 일손실 한도 초과 → +10점(20 캡)
- [ ] **트리거 2 (수익 실현)**: Exit Score 상승 없음. `pnlPct ≥ takeProfitPct` → REDUCE 직접 제안 (점수 무관 별도 처리)
- [ ] **트리거 3 (thesisBreakScore)**: 훼손 조건 3개↑ → 20점, 2개 → 14점, 1개 → 8점; 핵심 훼손 단독 → 최소 16점 보장
- [ ] **트리거 4 (timeExceededScore)**: `maxHoldDays` 초과 → 8점; D+5 초과수익 없음 → 4점; 거래량 급감(D+3~5 평균이 D0~2 대비 50% 미만) → 2점
- [ ] **트리거 5 (chartBreakScore)**: MA5 이탈 → 6점, MA20 이탈 → 10점, VWAP 이탈 → 4점, 전저점 이탈(20일 저점) → 8점, 장대음봉(종가-시가)/시가 < -3% → 6점
- [ ] **트리거 6 (overweightScore)**: 단일 종목 비중 초과분 2%당 +2점(최대 8점), 섹터 초과 → +2점
- [ ] **positiveMomentumBonus**: 5일 초과수익 > 5% → -8점, > 2% → -4점; 3일 거래량 비율 > 1.5 → -6점; MA20 위 상승 추세 유지 → -4점; 3일 내 긍정 공시 → -2점 (최대 -20)

#### 하드룰 수치 확정 (AI 금지 영역)
- [ ] `Portfolio.maxSinglePositionPct` 기본값: 10.0%
- [ ] `Portfolio.maxSectorPct` 기본값: 30.0%
- [ ] `Portfolio.maxDailyLossPct` 기본값: 2.0%
- [ ] `Portfolio.maxWeeklyLossPct` 기본값: 5.0%
- [ ] `Portfolio.stopLossGlobalPct` 기본값: 15.0%
- [ ] 이 수치들은 사용자 입력으로만 변경 가능. AI가 변경하는 코드 경로 차단 확인.

- [ ] 완성된 Exit Score 공식으로 샘플 포지션 5건 수동 계산, BE 구현 값과 오차 0점 비교 검증
- [ ] 50포지션 Exit Score 일괄 점검 ≤ 60초 성능 목표 달성 확인

**↩︎ M7 회귀 확인:** `PositionThesis.invalidConditions`가 실제 Exit 점검에서 평가되는지(thesis-driven exit) 동작 확인.

**넘기는 것:** Exit Score 공식 명세서, 하드룰 수치 기본값 → BE(구현), 정책(리스크 고지 약관)

---

### M9 — 백테스트 | **주담당 R**

**역할:** 백테스트 로직(현실 제약 시뮬레이션, 성과지표 공식, Gate 기준)을 설계하고, lookahead bias 방지를 QA와 공동 감사한다.

#### 현실 제약 시뮬레이션 설계
- [ ] 공시 시각 판정 알고리즘 확정:
  - 장중(09:00~15:29): 당일 종가 진입 OR 다음 거래일 시가 진입 (전략 파라미터로 선택)
  - 장마감 후(15:30~): 다음 거래일 시가 진입 (보수적 기본값)
  - `rcpDt` 시각 미상(8자리): 다음 거래일 시가 진입
- [ ] 슬리피지 적용 기준: 진입 시 +slippagePct, 매도 시 -slippagePct (기본값: 0.3%)
- [ ] 수수료 기준: 0.015%, 세금: 0.18% (증권거래세 + 농특세 포함)
- [ ] 상한가/하한가 처리: 상한가 당일 진입 불가 → 다음날 재시도, 최대 3일 후에도 불가 시 건너뜀; 하한가 매도 → 하한가 저가 기준 강제 체결
- [ ] 부분체결 시뮬레이션: 목표 거래금액 > 일 거래대금 × 1% → `fillRate = min(1, 일거래대금 × 1% / targetValue)`, `actualShares = floor(targetShares × fillRate)`
- [ ] 거래정지·관리종목: 진입 차단 + `wasTradingSuspended/wasAdminStock = true` 기록; 보유 중 지정 시 `THESIS_BREAK` 즉시 매도
- [ ] 유동성 부족 경고: `lowLiquidityFlag = true` (거래대금 10억 미만)
- [ ] 데이터 공백: 연속 5일 이상 일봉 없음 → `FORCE_EXIT`

#### lookahead bias 방지 규칙 정의
- [ ] 모든 DB 쿼리에 `asOf` 조건 강제:
  - `TradingSignal`: `createdAt <= disclosure.rcpDt`
  - `StockDailyPrice`: `date < entryDate` (전날까지 지표만)
  - `EventStudyResult`: 현재 `rcpNo` 제외한 과거 사례만
  - `TechnicalIndicator`: `calculatedAt <= disclosureAt`
- [ ] QA와 공동 감사: 시뮬레이션 루프 내 모든 DB 쿼리가 `asOf` 조건 포함하는지 코드 레벨 전수 점검

#### 성과지표 공식 확정
- [ ] 총수익률: `(최종자산 - 초기자산) / 초기자산 * 100`
- [ ] 연환산수익률: `((1 + totalReturn/100)^(365/실제일수) - 1) * 100`
- [ ] 승률: `수익거래 수 / 전체거래 수 * 100`
- [ ] 손익비(profitFactor): `(avgWin × winCount) / |avgLoss × lossCount|`
- [ ] MDD: equity curve 기준 `max((peak - trough) / peak * 100)` across all peaks
- [ ] Sharpe: `(월평균수익률 - 무위험이자율월환산) / 월수익률표준편차 * sqrt(12)`, 무위험이자율 기본값 3.5%/year → 0.29%/month

#### 보수적 실전 투입 기준(Gate) 6개 확정
- [ ] Gate 1: 상승·하락·횡보장(각 최소 6개월 구간) 모두 수익 > 0
- [ ] Gate 2: 수수료·세금·슬리피지 반영 후 총수익률 > 5%
- [ ] Gate 3: 단일 종목/이벤트 기여 비율 < 60% (다각화)
- [ ] Gate 4: 이벤트 타입별 거래 표본 ≥ 30건, 전체 ≥ 50건
- [ ] Gate 5: MDD ≤ 20%
- [ ] Gate 6: 최근 1년 수익률 ≥ 전체 연환산수익률의 50%

**↩︎ M6/M8 회귀 확인:** Signal·Exit 룰이 과거 시점 데이터만으로 재현되는지 미래 정보 누수 감사 (QA와 공동).

**↩︎ M5 회귀 확인:** Event Study 통계와 백테스트 성과의 일관성 비교 — 큰 괴리(Event Study 상위권 이벤트가 백테스트 하위권) 시 한쪽 결함 재점검.

**넘기는 것:** 백테스트 엔진 로직 명세서, Gate 기준 6개 확정값 → BE(구현), QA(Gate 검증), M10(모의투자 진입 기준)

---

### M10 — 모의투자 + 비용 거버넌스 완성 | **협업 C**

**역할:** 체결 시뮬레이션 가정을 정의하고, 백테스트 가정 대비 모의 실측 괴리를 측정·분석한다.

- [ ] 모의투자 체결 시뮬레이션 가정 확정: 슬리피지 범위, 부분체결 조건, 체결가 기준(시가 vs 현재가 기반)을 BE·인프라 파트와 협의 후 명세화
- [ ] 백테스트 체결 가정(진입: 다음거래일 시가 + slippage)과 모의투자 실측 체결가 괴리율 산정 기준 정의
- [ ] 괴리율 임계치 설정: 평균 괴리 > 1.0% 시 M9 백테스트 슬리피지 재보정 요청 트리거
- [ ] 30일 이상 모의운용 기간 동안 신호 적중률(D+5 기준 수익 비율) ≥ 55% 목표값 설정 기준 확인

**받는 것:** BE의 `PaperTrade` 체결 결과 데이터, 모의운용 성과 집계

---

### M11 — 반자동매매 | **협업 C**

해당 없음에 가깝지만 DQ 관점 확인 사항 존재.

- [ ] M10에서 검증된 Buy Score·Exit Score 로직이 반자동매매 경로(`OrderRequest` 생성 전 신호 평가)에서 동일한 공식으로 동작하는지 BE 코드 검토
- [ ] 주문 수량 결정 로직이 DQ 공식과 무관하게 Risk Engine(포트폴리오 비중 기준)에서만 산출되는지 확인

---

### M12 — 제한적 자동매매 | **협업 C**

**역할:** 자동매매 전략의 통계 졸업 기준 검증에 협업한다.

- [ ] 자동매매 화이트리스트 6종(자기주식 취득·소각, 대규모 공급계약, 배당 확대, 실적 서프라이즈, 명확한 악재 해소) 각각에 대해 M9 Gate 6개 + M10 모의투자 30일 졸업 조건 충족 여부를 수치로 확인
- [ ] 화이트리스트 진입 기준 수치 제안: M9 백테스트 `passedGate = true` + M10 모의 신호 적중률 ≥ 55% + 모의 누적수익 > 0 + Exit 정확도 ≥ 55%
- [ ] 하드 리스크 룰(1회 1~3%, 단일 5~10%, 일 -2%, 주 -5%)이 DQ가 설계한 Exit Score 공식 및 Portfolio 한도와 일관성 있는지 검토

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### DQ → BE (넘기는 것)

| 산출물 | 시점 | 형식 |
|--------|------|------|
| 이벤트별 `extractedData` JSON 스키마 명세 | M2 착수 전 | 문서 (§4-3 수준 JSON 예시 포함) |
| 파생값 계산 공식 + 단위 정규화 규칙 | M2 착수 전 | 문서 (수식 + 경계 케이스) |
| 지표 계산 공식 명세 (MA/RSI/MACD/BB/ATR/VWAP 등) | M4 착수 전 | 문서 (§4-5 수준 의사코드 포함) |
| Buy Score 공식 + 가중치 config | M6 착수 전 | `buy-signal.config.ts` 초안 |
| Exit Score 공식 + 판정 임계값 | M8 착수 전 | 의사코드 수준 명세 |
| 백테스트 현실 제약 시뮬레이션 로직 | M9 착수 전 | 의사코드 + 파라미터 기본값 |
| Gate 기준 6개 수치 확정 | M9 착수 전 | 문서 (§4-7 수준) |

### DQ ← BE (받는 것)

| 입력 | 시점 |
|------|------|
| `DisclosureDocument.parsedJson` 샘플 출력 | M1 완료 후 |
| `DisclosureEvent` 구현 단위 테스트 결과 | M2 완료 후 |
| `TechnicalIndicator` 계산 구현 코드 | M4 완료 후 |
| `EventStudyResult` 집계 결과 쿼리 출력 | M5 완료 후 |
| `TradingSignal` 점수 분해(`scoreBreakdown`) 샘플 | M6 완료 후 |

### DQ → AI (넘기는 것)

| 계약 | 내용 |
|------|------|
| AI 출력 스키마 요구사항 | `polarity` 값: POSITIVE/NEGATIVE/MIXED/UNKNOWN. `personaViews`: `{ persona, view: POSITIVE/NEUTRAL/WATCH/NEGATIVE, reason }` 배열 형식. DQ C1·C3 점수화에서 이 형식을 그대로 입력으로 사용함. 스키마 변경 시 사전 협의 필수. |

### DQ ← AI (받는 것)

| 입력 | 용도 |
|------|------|
| `DisclosureAnalysis.polarity` | C1 DisclosureEventScore polarity 보정 입력 |
| `DisclosureAnalysis.personaViews[]` | C3 PersonaFitScore Rule 변환 입력 |

### DQ ↔ QA (공동 작업)

| 체크포인트 | DQ 역할 | QA 역할 |
|-----------|---------|---------|
| M9 백테스트 lookahead bias 감사 | 쿼리 설계 기준 제공, `asOf` 조건 목록 작성 | 코드 전수 검토, 감사 체크리스트 운영 |
| M10 전 구간 회귀 점검 | 점수 공식 정확성 검증 항목 정의 | 통합 회귀 테스트 게이트 운영 |
| M12 전략 졸업 기준 수치 검증 | 통계 졸업 기준 수치 제공 | 수치 달성 여부 게이트 판정 |

### 회귀 체크포인트(↩︎)에서 DQ가 재확인할 항목

| 마일스톤 | DQ 재확인 항목 |
|----------|--------------|
| M2 종료 시 | M1 parsedJson 품질이 수치 추출 실패율 10% 이하인지 |
| M5 종료 시 | 가격 데이터 결측이 통계 왜곡을 일으키지 않는지; 이벤트 라벨 오류율 높은 버킷에 신뢰 강등 표시 |
| M6 종료 시 | Event Study 통계가 C4 점수에 실제 반영되는지; AI polarity 방향과 최종 점수 방향 불일치율 |
| M8 종료 시 | invalidConditions thesis-driven exit 동작 여부; 차트 지표 최신성(지연 없음) |
| M9 종료 시 | lookahead bias 누수 0 (QA 공동); M5 통계와 백테스트 성과 일관성 |
| M10 종료 시 | 백테스트 체결 가정 vs 모의 실측 괴리 < 1.0% |

---

## 4. 산출물 목록

| 산출물 | 종류 | 생성 마일스톤 |
|--------|------|-------------|
| 이벤트별 `extractedData` JSON 스키마 명세서 | 설계 문서 | M2 |
| 파생값 계산 공식 + 단위 정규화 규칙 문서 | 설계 문서 | M2 |
| 지표 계산 공식 명세서 (MA/RSI/MACD/BB/ATR/VWAP 등 의사코드) | 설계 문서 | M4 |
| 공시 전 선행상승률 계산 공식 | 설계 문서 | M4 |
| Event Study 방법론 문서 (D0 알고리즘, AR 계산, 버킷 규칙, 유의성 기준) | 설계 문서 | M5 |
| `EventStudyResult` DB 산출물 (버킷별 통계) | DB 데이터 | M5 |
| `buy-signal.config.ts` 가중치·점수 config 파일 (초안) | 코드 파일(초안) | M6 |
| Buy Score 7컴포넌트 공식 명세서 | 설계 문서 | M6 |
| 신호 등급 임계값 + 진입 조건 체크리스트 | 설계 문서 | M6 |
| Exit Score 6트리거 공식 명세서 + 판정 임계값 | 설계 문서 | M8 |
| 포트폴리오 하드룰 기본값 문서 | 설계 문서 | M8 |
| 백테스트 현실 제약 시뮬레이션 로직 명세서 | 설계 문서 | M9 |
| 성과지표 계산 공식 명세서 (MDD, Sharpe, profitFactor 등) | 설계 문서 | M9 |
| 보수적 실전 투입 Gate 기준 6개 확정 문서 | 정책 문서 | M9 |
| M9 lookahead bias 감사 체크리스트 | 품질 문서 | M9 |

---

## 5. 역할 특화 표준·체크리스트

### 5-1. AI 금지영역 적용 — DQ 관점

**DQ가 설계하는 공식에서 AI가 개입할 수 없는 영역:**

| 항목 | 이유 | 강제 방법 |
|------|------|-----------|
| Buy Score 최종 산출값 결정 | AI가 점수를 생성하면 재현 불가, 감사 불가 | 공식은 순수 Rule 함수. AI는 입력(polarity, personaViews)만 제공 |
| 가중치(W1~W7) 동적 변경 | 과적합 위험, 투명성 침해 | config 파일 + 환경변수로만 변경. AI 코드 경로에 write 권한 없음 |
| 손절·익절 % 결정 | 하드룰 영역 — 비전 §4 AI 금지 | `stopLossPct`는 사용자 입력값. AI에서 이 필드를 쓰는 코드 경로 금지 |
| 포트폴리오 한도(maxSinglePositionPct 등) 변경 | 하드룰 영역 | `Portfolio` 모델 limit 필드는 사용자 PATCH 경로만 허용 |
| Gate 기준 번복 | 백테스트 거버넌스 침해 | `passedGate` 값 AI 오버라이드 코드 경로 금지 |
| 주문 수량 결정 | 하드룰 영역 | Phase 13 이전 주문 수량 산출 코드 없음 |

### 5-2. 데이터 소스 원칙

- **1차 소스: KRX 데이터마켓플레이스(공기업)** — 일봉 OHLCV, 시장/업종 지수, 종목 상태, 상장 메타
- **보완 소스: 증권사 OpenAPI(KIS)** — KRX가 제공하지 않는 실시간 현재가, 분봉, 주문 체결
- M5 Event Study 및 M9 백테스트 과거 데이터는 **KRX와 동일한 1차 소스** 사용 (운용 데이터와 백테스트 데이터의 소스 불일치 금지)

### 5-3. 점수 공식 변경 절차

1. DQ가 변경 사유·영향 분석을 문서화
2. QA와 영향받는 테스트 케이스 사전 확인
3. `buy-signal.config.ts` 또는 명세서 업데이트
4. BE가 구현 후 DQ가 산출 값 재검증
5. M9 백테스트 재실행으로 성과 비교 (공식 변경 전후 비교 필수)

### 5-4. 통계 품질 게이트 (M5 이후)

- 유의하지 않은 버킷(p ≥ 0.05) 또는 표본 부족(n < 30) 버킷의 점수 기여는 반드시 0
- 통계 결과 보고 시 **표본 수와 신뢰구간을 항상 함께** 기재 (과신 방지)
- 서바이버십 편향: 상장폐지·거래정지 종목 포함 집계 의무

### 5-5. 계산 검증 표준

| 지표 | 검증 기준 | 방법 |
|------|-----------|------|
| MA, RSI, MACD | 외부 참조 대비 오차 1% 이내 | 임의 3종목 × 10일 수동 비교 |
| Buy Score | 샘플 5건 수동 계산값과 시스템 값 일치 | 엔지니어 리뷰 |
| Exit Score | 샘플 5건 수동 계산값과 시스템 값 일치 | 단위 테스트 |
| Event Study AR | SUPPLY_CONTRACT__ratio_gte20 버킷 AR 수동 계산 비교 | 스프레드시트 검증 |
| 백테스트 성과지표 | MDD·Sharpe를 수기 equity curve 계산값과 비교 | 엔지니어 리뷰 |

### 5-6. lookahead bias 방지 표준 체크리스트 (M9 전용)

- [ ] `BacktestRunnerService` 내 모든 DB 쿼리에 `asOf` 파라미터 존재
- [ ] `getTradingSignalAsOf`: `createdAt <= disclosure.rcpDt` 조건 하드코딩
- [ ] `getDailyPrice` 시리즈 조회: `date < entryDate` 조건 서비스 레이어 강제
- [ ] `EventStudyResult` 조회: 현재 `rcpNo` 제외 구현 확인
- [ ] `TechnicalIndicator`: `calculatedAt` 필드 기록 및 `calculatedAt <= disclosureAt` 조회
- [ ] 위 항목 전수 코드 리뷰 완료 (QA·DQ 공동 서명)
