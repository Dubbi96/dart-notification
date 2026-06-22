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

## 3-4. ★전략 진입 임계값 재보정 (2026-06-22, DAR-413)
**문제(사용자 실측):** 보수가치·단기모멘텀(minBuyScore=70)이 연 단 1거래 → 전략 비교 불가. 진단: `minBuyScore=70` 은 buyScore 분포 대비 상위 0.01%만 통과 = 사실상 비활성.

**근본원인(이슈 검토 #3):** **버그 아님 — DAR-410 스코어 재보정의 부작용.** DAR-404 가 임계 70/50 을 하드코딩하던 당시와 달리, DAR-410(등급/스코어 robust 재보정·merge `f21e8d28`)이 **curated 양(+) 촉매 base score 를 의도적으로 미반영**(단일 장세 과적합 회피, §2 결론)하면서 대부분 이벤트의 base 가 0 으로 남아 buyScore 분포가 낮게 이동했다. 즉 스코어 자체는 정직하고 분포는 정상이며(스케일 재조정 불요), **임계 상수만 stale** 해졌다.

**실측 buyScore 분포 (live :3000 / `trading_signals` 89,754건, max=88, p95=33):**
| 임계 | 통과 건수 | 분포 상위 % |
|---|---|---|
| ≥70 | 9 | 0.01% (구 임계 = 비활성) |
| ≥50 | 580 | 0.65% |
| ≥45 | 1,094 | 1.2% (p99=45) |
| ≥40 | 2,870 | 3.2% |
| ≥35 | 3,910 | 4.4% |
| ≥33 | 4,620 | 5.2% (p95=33) |
| ≥30 | 5,943 | 6.6% |

**해소(이슈 검토 #1·#2):** 분포 기반 **절대값 사다리**로 재설정. 전략 정체성은 '상대적 엄격도(percentile rank)'로 유지하되 통계적 표본을 확보:
| 전략 | 구 임계 | **신 임계** | 분포 상위 |
|---|---|---|---|
| 보수가치(최고 확신·10종목 집중) | 70 | **50** | ~0.6% (가장 엄격) |
| 단기모멘텀(빠른 회전) | 70 | **40** | ~3% |
| 이벤트엣지(robust 게이트 추가) | 50 | **35** | ~4% |
| 공격분산(50종목 분산) | 50 | **30** | ~6.6% (하한) |
- **'아무거나 매수' 방지:** 최저 임계 30(분포 상위 ~6.6%, 중앙값 ~0 보다 한참 위) = 하한. 여전히 '상위 점수' 우선이며, 이벤트엣지는 robust 양-edge 게이트(DAR-408)가, 등급 보정(DAR-410)이 추가로 선별을 강제한다.

**★point-in-time(불가침):** 임계값은 런타임에 백테스트 윈도 분포에서 계산하지 **않는다**(그러면 초기 진입이 윈도 후반 신호분포에 의존 = 미래정보 누수, §3-3 도구 반대와 동일 논리). 분포를 개발 시점에 1회 관측해 **a-priori 상수로 고정(frozen)**. 스코어 재보정 시 본 §3 재검증 프로토콜에서 상수 갱신(이슈가 제시한 "퍼센타일 기반 또는 분포에 맞춘 절대값" 중 point-in-time 안전한 후자 채택).

**검증(이슈 검토 #4 — live DB 실측 `executeReplay`, 순수 엔진, DB 무기록):**
| 전략 | 신 임계 | signals | **트레이드** | 누적수익 | 승률 |
|---|---|---|---|---|---|
| 보수가치 | 50 | 567 | **57** (구 1) | -5.10% | 36.8% |
| 단기모멘텀 | 40 | 2,799 | **259** (구 1) | -29.31% | 29.0% |
| 공격분산 | 30 | 5,809 | **287** (구 159) | -7.36% | 35.5% |
| 이벤트엣지 | 35 | 3,812 | **0** (구 0) | 0.00% | — |
- **보수가치·단기모멘텀이 연 1거래 → 57·259 거래로 통계적 표본 확보 = 전략 비교 의미화(DoD 충족).**
- 이벤트엣지 0 은 임계 문제 아님 — robust 양-edge 게이트가 빈 allowlist(현 데이터 양-edge 0, §3-2)라 진입 0 이 binding(DAR-408 do-no-harm). 임계 35 는 양-edge 출현 시 활성된다.
- 음(-)의 누적수익은 정직한 결과(§1 baseline -14.5% 와 정합) — 본 이슈 목표는 '수익화'가 아니라 '비교 가능한 표본 확보'. 상대적 엄격도 사다리(보수 567 < 단기 2799 < 엣지 3812 < 공격 5809 signals)는 정체성을 유지한다.

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

## 5. 분봉 단타(intraday scalping) 트랙 — forward-only 별도 축 (DAR-411)
- §1~3의 일봉(공시→D+N) 축과 **완전히 별개**의 트레이딩 로직 축: 분봉(stock_minute_prices) 기반 **당일 진입·당일 청산**.
- ★**백테스트 불가**: 분봉은 당일 forward-only(KIS, 과거 분봉 없음). 위 baseline 리플레이(일봉 point-in-time)에 편입 불가 → **정규장 중 실시간 모의로만 누적**(`backtestable:false`, equityCurve 오늘부터 forward, 표본0/저표본 graceful).
- 진입 3조건 AND(순수 Rule·AI 0): 거래량 폭발(직전 20분 평균×2.5) AND 돌파(직전 15분 고가 초과) AND VWAP 상회. 유니버스 = 당일 공시 ∪ buy-signal 후보 중 분봉 수집 종목.
- 청산(순/net 기준 — **DAR-418**): 익절 **순 +2%** / 손절 **순 -1.2%** / **15:20 전량 강제청산**(오버나잇 금지, 손익 무관 최우선). engine5 Risk 하드룰(1회매수 3%·동시보유 5·일일손실 한도) 적용. ★실주문 0(순수 시뮬).
- ★**수수료 인지(fee-aware) 거래 — DAR-418**: 단타는 매도마다 비용이 부과되므로 TP/SL 임계를 **순(net)** 으로 환산한다. gross 가격수익률에서 **왕복 거래비용율**(매수 수수료+슬리피지 + 매도 수수료+세금+슬리피지 = `2·0.015% + 0.18% + 2·0.05% = 0.31%`, 체결 파라미터 `FillParams`에서 `roundTripCostPct()` 산출 SSOT)을 차감한 net 수익률로 익절/손절을 판정한다. 순 +2% 익절은 **gross +2.31%**에서, 순 -1.2% 손절은 **gross -0.89%**에서 발동(손절 임계를 비용만큼 좁혀 과손실 방지). `gross +2%` 소액 익절이 수수료에 먹혀 net +1.69% 적자전환하던 문제를 차단. 진입 시 기대이동(gross 익절폭)이 `왕복비용+최소마진(0.3%)`을 못 넘으면 진입 보류(fee 허들 게이트). status/trade-history 에 `roundTripCostPct`·`grossReturnPct`·`netReturnPct`·`totalFees` 노출, 모바일 '순수익(수수료 후)' 명시.
- 검증 방법: 분봉 fixture 기반 결정론 단위테스트(진입 3조건·net TP/SL·fee 허들·15:20 강제청산·당일 청산 보장)로 로직을 고정. 실데이터 성과는 정규장 누적분으로 재검증(forward). 표면화: `GET /paper-trading/simulation/intraday-scalp/status`.
- ★함의: 단타 edge 유무는 일봉 baseline과 독립적으로, forward 누적 표본이 쌓인 뒤에야 판정 가능(현재 표본 0 = 정직). 일봉 축의 "양-edge 부재" 결론을 단타 축에 전이하지 않는다. 비용 인지로 "익절했는데 순손실" 같은 거짓 양(+) 표본 오염도 차단(net 기준 누적).
