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

## 4. 가설: 데이터가 더 들어오면
- 표본↑ → PRELIMINARY→READY 전환, 이상치 영향 희석(robust 통계로). 결함 A는 표본보다 **방법론(중앙값)** 문제라 데이터만으론 안 풀림 → 코드 수정 필요.
- 결함 B(등급 역전)는 calibration이 표본↑로 안정화되면 base score 보정 정밀도↑. 단 역전 자체는 로직 버그 가능성 → 코드 조사.

## 3-3. event-edge robust 선별 적용 (DAR-408, 2026-06-22)
§3-2 의 진단(거짓 평균 추종)을 코드로 고정. event-edge 의 매수 이벤트 선별을 **하드코딩 6종 → EventStudy robust 통계 주도**로 전환했다.

**선별 규칙(`EventEdgeSelectorService`, engine3 backtest/strategies):**
- robust 지표 = `winsorizedMeanArD20 ?? medianArD20` (DAR-402 컬럼). 오염 가능한 산술평균 `avgArD20` 은 폴백조차 안 함.
- eventType별 대표 버킷 = coarse(`__ALL__`) 우선 → 표본 최다 fine 버킷(`EventStudyQueryService.findRobustEdges`, marketType=ALL).
- 매수 조건: `robust > POSITIVE_EDGE_THRESHOLD_PCT`(=0, 양수) **AND** `sampleCount >= MIN_EDGE_SAMPLE_COUNT`(=20, 소표본 노이즈 배제).
- 양-edge 그룹이 0이면 빈 allowlist → 러너가 진입 0(**do-no-harm**). `eventTypes: []` = 허용 0종 의미로 러너 필터를 정정(undefined=무제한, []=진입 0).

**현재 데이터 결과:** §3-2 대로 모든 이벤트 robust median/winsorized D20 ≤ 0 → event-edge 매수 0종. SUPPLY_CONTRACT(산술평균 +23%지만 winsorized -2.6) 등 **거짓 양 이벤트 매수 0**. 손실 회피 달성.

**점진 확장(사용자 테제):** 백필로 데이터·장세가 늘어 진짜 양-edge 이벤트(robust>0, n≥20)가 생기면 refresh 시 자동으로 매수 대상에 편입된다. 코드 변경 없이 데이터 주도로 활성.

**범위:** event-edge 만 robust 게이트. short-momentum·conservative-value·aggressive-diversified 3전략은 무변경. minBuyScore·exitRules 유지.

**검증:** tsc0 · nest build0 · jest engine3 backtest+event-study 357/357(신규: 선별기 6·runner allowlist 3·query 3·track 2·preset 1). 결정론 단위 증거 — winsorized<0 거짓 양 제외, median 폴백, 소표본 배제, 전부 음수 → 진입 0.
