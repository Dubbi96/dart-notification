# DAR-134 [진단] 신호 등급 분포 — 전부 관망(WATCH) 원인 규명 + 정직 보정

> 결론 요약: **임계값 버그도, 점수 계산 버그도 아니다.** Buy Score 엔진과 등급 임계는
> 구조적으로 건강하다. 원인은 **데이터 충실도** — 특히 `historicalEvent`(Event Study)
> 버킷이 라이브에서 영구 결측이라, 통계적 근거가 결합되지 못해 *진짜로 긍정적인* 공시조차
> **55~59점(임계 60 바로 아래)** 에 정체된다. ★임계를 낮추지 않고, 결측의 근본(=Event
> Study 산출 cron 부재)을 메워 자연 상향시키는 정직 보정만 적용했다.

## 1. 증상

앱 '오늘의 투자판단'·신호탭에서 BUY 등급(STRONG_BUY_CANDIDATE / BUY_CANDIDATE)이 0건,
전부 관망(WATCH)으로 표시 → 실질 추천 부재.

## 2. 점수 모델 (코드 기준)

- 공식: `BuyScore = Σ(Wi × Ci) − RiskPenalty`, clamp(-100,100) 정수.
  (`buy-signal/buy-signal.service.ts`)
- 9 버킷 가중치 `BUY_SCORE_WEIGHTS` (`buy-signal/config/buy-signal.config.ts`):
  disclosureEvent 0.228 · keyMetric 0.182 · personaFit 0.137 · historicalEvent 0.091 ·
  chart 0.137 · volumeLiquidity 0.091 · marketSector 0.046 · insider 0.048 · fundamental 0.050.
- 등급 임계 `SIGNAL_GRADE_THRESHOLDS`: STRONG_BUY≥80 · **BUY≥60** · WATCH≥30 · NEUTRAL≥-29 · AVOID<-29.
- **결측 버킷 재정규화(DAR-49, `scoring/bucket-renormalization.ts`)**: 데이터 소스가
  통째로 부재한 버킷은 분모에서 제외하고 가용 버킷 가중치를 합=1.0 으로 재정규화한다.
  임계값은 불변.

## 3. 진단 방법 — 결정론적 재현

DB 없이도 결론을 격리하기 위해, 실제 `BuySignalService` 를 라이브 데이터-가용 상태별로
구동하는 진단 하네스를 추가했다:
`backend/src/engine3-quant-market/buy-signal/buy-signal-distribution.diagnostic.spec.ts`
(jest 그린, 표는 console 출력).

라이브 입력 배선은 코드로 확인:
- **polarity**: `engine1 event-classifier.ts` 가 **룰**로 부여(AI 아님). 강한 양(+) 이벤트는
  POSITIVE, 미분류는 `OTHER`+`UNKNOWN`(base 0). → AI(M3 미가동)와 무관하게 polarity 는 정상.
- **personaViews**: `signal-generation/persona-view.rule.ts` 가 (eventType,polarity,impact)로
  파생(AI 아님). → personaFit 도 라이브에서 정상 평가.
- **historicalEvent**: `EventStudyResult` 가 있어야 평가. 없으면 `avgArD5=null` → 결측(omit).
- **chart/volumeLiquidity/marketSector**: TechnicalIndicator/지수 산출 여부에 따라 가용/결측.

## 4. 핵심 발견 — 분포표 (현실적 '보통' 기술적 상태, EventStudy 결측 = 라이브 추정)

```
임계: STRONG≥80 BUY≥60 WATCH≥30 NEUTRAL≥-29
  score grade           disc keyM pers hist chrt vol  mkt | omitted
    64 BUY_CANDIDATE      70  100  100    0   25   10   10 | historicalEvent,insider,fundamental  [SUPPLY_CONTRACT salesRatio=35 (강)]
    55 WATCH              70   60  100    0   25   10   10 | historicalEvent,…                     [SUPPLY_CONTRACT salesRatio=12 (중)]
    59 WATCH              75   70  100    0   25   10   10 | historicalEvent,…                     [EARNINGS_SURPRISE surprise=20]
    63 BUY_CANDIDATE      80   80  100    0   25   10   10 | historicalEvent,…                     [SHARE_CANCELLATION ratio=4]
    41 WATCH              65    0  100    0   25   10   10 | historicalEvent,…                     [SHARE_BUYBACK (keyMetric 룰無)]
    55 WATCH              60   70  100    0   25   10   10 | historicalEvent,…                     [DIVIDEND_INCREASE yoy=30]
     6 NEUTRAL             0    0    0    0   25   10   10 | historicalEvent,…                     [OTHER (미분류·UNKNOWN, base 0)]
  집계: BUY_CANDIDATE=2, WATCH=4, NEUTRAL=1
```

해석:
1. **임계/계산은 정상.** 모든 버킷이 가용한 이상 상태(S4)나, 매우 강한 공시(salesRatio=35,
   SHARE_CANCELLATION)는 임계 인하 없이 BUY 에 도달한다. → "임계가 너무 높다" 가설 기각.
2. **진짜로 긍정적인 공시(EARNINGS_SURPRISE 20%, DIVIDEND +30%, 중간 규모 공급계약)가
   55~59 에 정체** → BUY(60) 바로 아래에서 WATCH 로 떨어진다. 이 군집이 "전부 관망"의 실체.
3. **공통 원인 = `historicalEvent` 영구 결측.** 이 버킷(과거 유사 공시의 통계적 D+5 초과수익)이
   이들을 임계 위로 올려줄 *유일한 근거 기반 양(+) 신호*인데, 라이브에서 비어 있다. chart/
   volume/market 은 보통주 기준 중립(25/10/10)이라 60 위로 밀어줄 힘이 없다.
4. OTHER(미분류) 공시는 base 0 → 정당하게 NEUTRAL. 거짓 BUY 아님(정직).

## 5. `historicalEvent` 가 비어 있는 근본 원인

- `EventStudyCalculationService`(DAR-133, PR#88 merged)가 `EventStudyResult` 를 산출하는
  경로는 존재하나, **호출 트리거가 수동 `POST /event-study/calculate` 뿐 — cron 부재**였다.
  (`grep -rn "@Cron" event-study/` → 0건)
- 따라서 무인 운영에서는 `EventStudyResult` 가 채워지지 않고, `loadEventStudyMap()` 이 빈
  맵을 반환 → `historicalEvent` 가 영구 omit → §4의 55~59 정체가 고착.

## 6. 적용한 정직 보정 (PR)

이슈가 명시한 정당 보정 경로 — "Event Study 입력 결합 후 자연스러운 등급 상향" — 을 그대로 따른다.
**임계값/가중치/점수 공식은 일절 손대지 않았다.**

- 신규 `EventStudyCalculationScheduler` (`event-study/event-study-calculation.scheduler.ts`):
  주간(토 04:00, off-hours) `EventStudyCalculationService.run()` 으로 baseline 재산출 →
  `EventStudyResult(READY)` 영속. 멱등 upsert, throw 흡수(cron 유지), D+20 미성숙 자동 제외.
- `CronRunRecorderService` 래핑(itemCount=readyCount) + `CRON_JOB_KEYS.EVENT_STUDY_CALC`
  freshness 사양 추가(주간 카덴스, stale 10일) → 신선도 모니터에 노출(DAR-110 연계).
- 모듈 등록: `EventStudyModule.providers`.

효과: 표본≥30·통계적 유의 버킷이 채워지면, 평일 19:00 신호 생성이 이를 `historicalEvent`
입력으로 결합 → §4의 55~59 군집 중 **과거 실적이 실제로 양(+)·유의한** 이벤트만 자연히 60 위로
상향된다. 근거 없는(=과거 초과수익이 음(-)/무의미) 이벤트는 그대로 WATCH 유지 → 정직 원칙 보존.

## 7. 의도적으로 *하지 않은* 것 (정직 원칙)

- ❌ 임계값 인하(60→하향) — 추천을 '만들기' 위한 조작. 거부.
- ❌ 가중치 임의 상향 — 근거 없는 BUY 양산. 거부.
- ❌ `keyMetric`/`personaFit` 의 "가용-그러나-0점" 버킷을 결측 처리로 바꿔 강제 상향 —
  검토했으나 기각. keyMetric 의 데이터 소스(extractedData)는 *존재*하며, 룰 부재로 인한 0은
  "측정 안 됨"이라기보다 보수적 중립에 가깝다. 이를 omit 하면 **더 적은 데이터로 더 높은
  확신**을 주게 되어 오히려 비정직. (관련 후속: SHARE_BUYBACK 등 key-metric 룰 부재 이벤트에
  *실제 수치 기반* 점수 룰 추가는 별도 피처 이슈로 분리 권장.)

## 8. 후속 권장 (별도 이슈)

1. **EventStudy 최초 backfill 1회 실행** (운영): 신규 cron 은 토요일에 첫 동작하므로, 즉시
   효과를 보려면 `POST /event-study/calculate` 를 1회 수동 호출해 baseline 을 선적재.
   (단, ≥30 표본·D+20 성숙 충족 버킷만 READY — 데이터 누적이 전제.)
2. **key-metric 룰 커버리지 확대**: SHARE_BUYBACK·MAJOR_SHAREHOLDER_CHANGE 등 base>0 인데
   keyMetric 룰이 없는 이벤트에 수치 기반 점수 룰 추가(추출값 존재 전제).
3. **AI Phase4 polarity 정밀화(M3)**: 현재 룰 polarity 는 보수적. AI 가동 시 MIXED/강도 변별이
   personaFit·disclosureEvent 를 더 정밀화.

## 9. 검증 증거 (harness/VERIFICATION.md 6대)

1. 테스트: `jest` 전체 **1777 passed / 131 suites** (기존 1771 + 신규 6).
2. 타입체크: `tsc --noEmit` 에러 0.
3. 린트: backend 린트=tsc 게이트(0). (flat eslint config 부재 — backend 규약상 tsc 가 게이트)
4. 동작 재현: `buy-signal-distribution.diagnostic.spec.ts` 분포표 + `event-study-calculation.scheduler.spec.ts`
   (recorder 래핑·readyCount·throw 흡수) 결정론 그린.
5. 회귀: 기존 1771 전부 green, 점수 공식·임계·가중치 미변경(소스 0 수정) → 회귀 0.
6. 수용 기준: §아래 1:1.

### 수용 기준 1:1
- R1 "원인 진단(데이터 vs 계산 vs 임계)" → §4·§5: **데이터(historicalEvent 영구 결측)**. 계산/임계 정상 입증.
- R2 "Buy Score 분포·컴포넌트별 기여 로깅" → §4 분포표(버킷별 기여·omitted).
- R3 "등급 임계 검토" → §2·§4-1: 임계 정상, 인하 거부(§7).
- R4 "데이터 충실도 점검" → §5: EventStudy cron 부재 식별.
- R5 "결론 문서화" → 본 문서.
- R6 "정당한 보정만 PR / 근거 없는 BUY 금지" → §6 EventStudy cron(임계 불변), §7 거부 목록.
- R7 "be tsc0·jest 그린" → §9-1,2.
