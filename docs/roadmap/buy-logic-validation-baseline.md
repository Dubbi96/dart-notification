# 매수 논리 검증 baseline — 2026-06-21 (쿼터 대기 중 내부 검증)

> 목적: 현재 보유 데이터(공시 1년치 247K·일봉 8.5M)로 "무엇을 사야 하는가" 논리를 실증 구축하고, 과거 데이터가 더 들어올 때마다 **재검증·확장**한다. 본 문서 = 고정 baseline + 재검증 프로토콜.

## 0. 데이터 기준점 (재검증 시 갱신)
- 공시: 247,766건 (rcpDt 20250619~20260619, 1년). frontier 20250619 → 목표 19990101 (DART 쿼터 대기).
- 문서 파싱 DONE: ~58,634 (드레인 점진).
- EventStudy: 1,331 events scanned → 1,113 observations, 22 groups, **15 READY** / 7 insufficient.
- 백테스트 baseline runId: `cmqnsqkbl02x92kr58dnzqq7r` (name=baseline-2026-06-21-quota-gap).

## 1. 백테스트 baseline (point-in-time, 2025-06-19~2026-06-19)
- **totalReturn -14.5%** · winRate 23.1% · profitFactor 0.36 · sharpe -1.79 · MDD -14.6% · 182 trades · avgHold 11.95d.
- 정직한 결과 = **현 매수논리는 아직 손실**. 이게 baseline. 논리 개선의 목표 = 이 곡선을 양으로.

## 2. ★발견된 결함 (검증이 잡아낸 것)

### 결함 A — EventStudy 평균이 이상치 오염 (거짓 매수신호 생성)
| bucket | n | avgArD20 | tStat | 모순 |
|---|---|---|---|---|
| SUPPLY_CONTRACT __ALL__ (ALL) | 886 | **+24.91%** | **-2.23** | 평균 양·t 음 |
| SUPPLY_CONTRACT amendment (KOSDAQ) | 420 | +57.04% | -2.32 | 동일 |
- 평균이 양인데 t통계량이 음 → 소수 극단 양 이상치(유동성 낮은 KOSDAQ 소형주 폭등)가 평균을 끌어올리고 **중앙값/전형은 음수**. avgArD5는 이미 -0.51(음).
- 백테스트가 SUPPLY_CONTRACT 154트레이드 **avgReturn -4.2%** 로 현실을 확인 → 평균 기반 신호는 가짜 edge.
- **고칠 것:** event_study_results에 medianAr·winsorizedMeanAr(5/95 clip) 추가, 신호 스코어링은 robust 통계 사용. mean↔tStat 부호 불일치(버그 가능성) 조사.

### 결함 B — 매수 등급 로직이 역예측 (anti-predictive)
| grade | n | d20 avgExcess | 유의 |
|---|---|---|---|
| BLOCKED(회피) | 76 | **+7.69%** | f |
| WATCH(관심) | 89 | -4.26% | t |
| NEUTRAL | 835 | -5.33% | t |
- 시스템이 **차단하는 신호가 실제 최고 수익**, 관심표시한 게 손실 → 스코어링이 수익과 역상관.
- 전체 신호 d20 avgExcess **-4.23%, 유의(p=0)**. 다수 이벤트 base score 미설정(null/HOLD) → calibration impliedScore만 존재.
- **고칠 것:** EVENT_BASE_SCORES를 calibration impliedScore/suggestedDelta로 보정, 등급↔수익 단조성 회복(높은등급→높은수익). 부호 역전 원인 조사.

#### ★DAR-410 규명·해소 (2026-06-22, live 실측 :3001 신규코드)
**근본원인 = 산술평균 이상치 오염 아티팩트(코드 부호버그 아님).** byGrade d20 을 평균이 아닌 **강건(median)·승률**로 보면 역전이 사라지고 등급 단조가 **이미 성립**한다:

| grade | rank | MEAN(오염) | **MEDIAN(robust)** | **winRate** |
|---|---|---|---|---|
| WATCH | 2(우수) | -4.26 | **-4.63** | **0.303** |
| NEUTRAL | 3 | -5.33 | **-6.71** | **0.220** |
| BLOCKED | 5(열위) | **+7.69**(거짓) | **-6.71** | **0.105** |

- BLOCKED 의 mean +7.69 는 표본 76건 중 소수 극단 폭등(win 10.5%뿐)이 끌어올린 거짓값. median/winRate 로는 BLOCKED 가 **정확히 최악** = 회피 룰은 제대로 작동 중(부호/조건 정상).
- 지표: `isMonotonic`(mean)=false·avgReturnRankCorr **-0.5** → **`isRobustMonotonic`(median)=true·robustReturnRankCorr +0.866·winRateRankCorr +1.0**.
- ★winsorizedMean(5/95)은 단일 극단치에 잔존(BLOCKED winsor -4.91 > NEUTRAL -5.76 → 위반)하므로 **median 을 권위 강건축으로 채택**(DAR-402 "median 이 진짜 강건" 일치).

**코드 수정(DAR-410, point-in-time 안전 — 진단/calibration 층, 백테스트 엔진·라이브 신호생성 무변경):**
1. `signal-accuracy.ts`: HorizonAccuracy·GradeMonotonicity 에 `robustExcessReturn`(=median)·`winsorizedMeanExcessReturn`·`robustReturnViolations`·`robustReturnRankCorrelation`·**`isRobustMonotonic`** 추가. 단조성 권위 판정을 robust 로.
2. `calibration.ts`: `impliedScore`/gap/delta 를 **robust(median) 기반**으로 전환. → 위험 이벤트 거짓 상향권고 제거:
   - `TRADING_SUSPENSION` impliedScore **+100(mean +34.71) → -67(median)** [base -100 상향 권고 차단]
   - `OWNERSHIP_DISCLOSURE` **+100 → -92**, `DELISTING_RISK` 완화권고(Δ+17)는 **n=12 윈도노이즈로 사람 게이트에서 거부(base -100 불변)**.
3. `EVENT_BASE_SCORES`(buy-signal.config): 미등재(base 0)였던 **희석·재무부담 이벤트 보강** — 도메인 1차원칙 + robust 음·유의 정렬:
   - `SECURITIES_OFFERING` -50 (median -30, n20 win0) · `CONVERTIBLE_EXERCISE` -35 (median -25, n16) · `DEBT_GUARANTEE` -30 (median -12, n25 win0.16).
   - ★curated 양(+) 촉매(SUPPLY_CONTRACT 70·EARNINGS_SURPRISE 75 등)는 robust 로 이 7개월 윈도 음수이나 **단일 장세 과적합 회피 위해 미반영**(§3-2 결론 일치). 백테스트 replay 는 **영속 buyScore** 를 읽어 base 재계산 안 함 → base 변경의 in-window 재검증은 신호 재생성(=in-sample)이 필요해 보류, 효과는 **전향적 라이브 개선**으로 평가.

**결론:** 보고된 "등급 역예측"은 **측정 오염**이 본질이며 **robust 측정으로 단조성 성립(해소)**. 회피 룰 부호/조건은 정상. base score 는 회피룰 공백(희석/distress)만 보수적 보강.

## 3. 재검증 프로토콜 (데이터 늘 때마다·주기적)
1. `POST /event-study/calculate` — 근거 재계산 (READY 수·관측수 갱신).
2. `POST /signals/generate` — 신호 재생성.
3. `POST /backtest/replay {startDate,endDate,name}` — point-in-time 백테스트.
4. `GET /backtest/signal-accuracy`·`/calibration`·`/feature-ab` — 등급↔실현 정합·calibration gap.
5. 본 문서 §0~2 갱신, baseline 대비 **totalReturn·grade 단조성·READY 수** 추이 기록.
- 합격선(논리 성립): grade 단조성 + 전체 d20 avgExcess 비음 + backtest totalReturn 우상향.

## 3-1. 전략 4종 비교 baseline (2026-06-22, DAR-404/405 머지 후)
4전략 point-in-time 백테스트(refresh, 2025-06-22~2026-06-22):
| 순위 | 전략 | 누적수익 | 트레이드 |
|---|---|---|---|
| 🥇 | 보수가치(고점수·소수집중·넓은손절) | **+9.5%** | 4 |
| 🥈 | 단기모멘텀 | +1.7% | 4 |
| 🥉 | 공격분산 | -14.0% | 179 |
| | 이벤트엣지 | -20.0% | 104 |
- **선별적·보수적 로직이 광범위·공격적을 이김**. 단 표본 극소(4트레이드) — 이벤트 추출이 ~7개월(2025-06~11+2026-06)에 국한.

## 3-2. ★결정적 발견 — 현재 데이터에 양(+) edge 이벤트 없음 (DAR-402 robust 적용 후)
robust median D20 기준 **모든 공시 이벤트유형이 음수**:
| 이벤트 | n | median | winsorized | 산술평균(거짓) |
|---|---|---|---|---|
| SHARE_BUYBACK KOSDAQ | 54 | -1.2 | +0.7 | +1.1 |
| THIRD_PARTY KOSDAQ | 31 | -3.1 | +0.4 | +3.7 |
| SUPPLY_CONTRACT ALL | 948 | -4.6 | -2.6 | +23.2 |
| SUPPLY_CONTRACT KOSPI | 249 | -6.4 | -5.9 | -4.7 |
- **공시→D+20 매수 edge가 현 7개월 윈도(주로 H2 2025)에 없음.** event-edge -20%의 근본 원인 = 살 양-edge 이벤트가 없는데 거짓 평균 추종. → **로직 수정 DAR-407**(robust 게이트, 양-edge 없으면 진입 0). 
- ★함의: edge는 장세 의존적일 수 있어 **더 긴 과거·다양한 장세 데이터(백필) 필수**. 현재 백필 frontier 2024-02 전진 중, 문서 드레인이 임계경로(쿼터).

## 3-3. event-edge robust 게이트 검증 (2026-06-22, DAR-408 머지 후)
- DAR-408은 event-edge eventTypes를 정적 `POSITIVE_CATALYST_EVENT_TYPES`로 정렬(런타임 robust 조회 없음). 검증: event-edge 여전히 **SUPPLY_CONTRACT 87/104 매수**(robust median -4.6%) → -18.5%. 거짓 양 이벤트 매수 0이라는 당초 DoD 미달.
- **그러나 point-in-time 엄격성상 동적 robust 게이트는 현재 불가**: 7개월 데이터에 학습/검증 분리 구간이 없어, 전체표본 EventStudy로 백테스트를 필터하면 미래정보 누수(테제 위반). → 정적 a-priori 촉매집합이 현 제약하 정직한 최선. **-18.5%는 "순진한 긍정촉매 추종이 이 장세에 통하지 않는다"는 정직한 검증 결과.**
- ★후속(데이터 충분 시): rolling/as-of EventStudy로 진입시점 직전 데이터만으로 robust 게이트 → point-in-time 유지하며 동적 선별. 백필로 다장세 history 확보가 선행조건.

## 4. 가설: 데이터가 더 들어오면
- 표본↑ → PRELIMINARY→READY 전환, 이상치 영향 희석(robust 통계로). 결함 A는 표본보다 **방법론(중앙값)** 문제라 데이터만으론 안 풀림 → 코드 수정 필요.
- 결함 B(등급 역전)는 calibration이 표본↑로 안정화되면 base score 보정 정밀도↑. 단 역전 자체는 로직 버그 가능성 → 코드 조사.
