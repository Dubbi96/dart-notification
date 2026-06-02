> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 9 — 과거 데이터 기반 Event Study

---

## 1. 목적 & 범위

### 목적
"감이 아니라 통계"로 매수·백테스트 의사결정을 지원한다.
과거 공시 이벤트에 대한 주가 반응을 체계적으로 분석해 **이벤트 타입별·세부 버킷별 평균 반응 통계**를 DB에 저장하고,
Phase 6 Buy Score 및 Phase 10 백테스트 엔진의 입력으로 제공한다.

### 포함
- 과거 공시 D0 지정 → D-20~D+20 주가 연결
- 시장(KOSPI/KOSDAQ)·업종 대비 초과수익(abnormal return) 계산
- 이벤트 타입별 + 세부 버킷별 평균 반응 집계 저장 (`EventStudyResult`)
- 표본 수 / t-통계 / p-값을 이용한 유의성 필터
- 집계 결과를 Buy Score의 "과거 유사 공시 성과" 항목에 연결
- 관리 API(수동 재계산 트리거, 버킷별 조회)

### 제외
- 실시간 신호 생성 (Phase 6)
- 백테스트 전략 실행 (Phase 10)
- 자동매매 판단 (Phase 13~14)
- 시세 데이터 직접 수집 (Phase 5에서 완료된 것을 소비)

---

## 2. 현재 코드베이스 연결점

| 계층 | 현존 자원 | 연결 방식 |
|------|-----------|-----------|
| DB | `Disclosure` (rcpNo PK), `Company` (corpCode PK) | EventStudyResult → rcpNo FK, corpCode FK |
| 백엔드 모듈 | `DisclosureModule`, `SchedulerModule` | EventStudyModule 신규 생성, Scheduler cron 추가 |
| Phase 3 의존 | `DisclosureEvent` (이벤트 타입·수치 JSON) | eventId FK 참조, eventType·bucketKey 파생 |
| Phase 5 의존 | `StockDailyPrice` (일봉·거래량) | D-20~D+20 주가 조인 |
| Phase 6 의존 | `TradingSignal.eventStudyScore` | 집계 결과를 점수화해 주입 |

---

## 3. 선행 조건 & 의존성

| 조건 | 설명 |
|------|------|
| **Phase 3 완료** | `DisclosureEvent` 테이블에 이벤트 타입·핵심 수치 JSON 저장되어 있어야 함 |
| **Phase 5 완료** | `StockDailyPrice` 테이블에 최소 2년치 일봉 데이터 수집되어 있어야 함 |
| **시장 지수 데이터** | KOSPI·KOSDAQ 지수 일봉 및 업종지수(GICS/KRX 업종) 저장 필요 |
| **공시 D0 규칙** | 공시 시각 기준 — 장중(09:00~15:20) = 당일 D0, 장후(15:20 이후)·장전·휴일 = 다음 거래일 D0 |
| **표본 최소치** | 버킷당 최소 30건 이상이어야 통계값 노출 (미달 시 `INSUFFICIENT` 상태) |

---

## 4. 상세 설계

### 4-1. Prisma 모델

```prisma
// 이벤트 Study 결과 (버킷 단위 집계)
model EventStudyResult {
  id              String   @id @default(cuid())

  // 집계 식별 키
  eventType       String   // DisclosureEvent.eventType enum 값
  bucketKey       String   // 버킷 식별자 (아래 버킷 규칙 참조)
  marketType      String   // "KOSPI" | "KOSDAQ" | "ALL"

  // 표본 정보
  sampleCount     Int      // 집계 표본 수
  isSignificant   Boolean  // p < 0.05 기준
  tStatistic      Float?   // t-통계량
  pValue          Float?   // p-값

  // D+N 평균 수익률 (시장 대비 초과수익 = AR)
  avgReturnD1     Float    // D0→D+1 단순 수익률 평균 (%)
  avgReturnD3     Float    // D0→D+3 누적 수익률 평균 (%)
  avgReturnD5     Float    // D0→D+5 누적 수익률 평균 (%)
  avgReturnD20    Float    // D0→D+20 누적 수익률 평균 (%)

  // 시장·업종 대비 초과수익 (Abnormal Return)
  avgArD1         Float    // D+1 평균 AR (종목수익률 - 시장수익률)
  avgArD3         Float    // D+3 누적 평균 AR
  avgArD5         Float    // D+5 누적 평균 AR
  avgArD20        Float    // D+20 누적 평균 AR

  // 분포 지표
  upProbD5        Float    // D+5 기준 상승 확률 (0~1)
  crashProbD5     Float    // D+5 기준 급락(-5% 이상) 확률 (0~1)
  avgMaxDrawdown  Float    // D0~D+20 평균 최대낙폭 MDD (%)

  // 거래량
  avgVolumeRatioD1 Float   // D+1 거래량 / D-5 평균거래량 배율
  avgVolumeRatioD3 Float   // D+3 평균

  // 원시 데이터 참조 (재계산용)
  rawEventIds     String[] // 집계에 포함된 DisclosureEvent.id 배열

  // 메타
  calculatedAt    DateTime @default(now())
  dataFromDate    String   // 집계 기간 시작 (YYYYMMDD)
  dataToDate      String   // 집계 기간 종료 (YYYYMMDD)
  status          String   @default("READY")
  // "READY" | "INSUFFICIENT" (표본 부족) | "CALCULATING" | "ERROR"

  @@unique([eventType, bucketKey, marketType])
  @@index([eventType])
  @@index([bucketKey])
  @@index([calculatedAt])
  @@map("event_study_results")
}

// 개별 이벤트 관측치 (집계 재현·디버깅용)
model EventStudyObservation {
  id              String   @id @default(cuid())
  eventId         String   // DisclosureEvent.id (FK)
  rcpNo           String   // Disclosure.rcpNo (FK)
  corpCode        String   // Company.corpCode (FK)
  eventType       String
  bucketKey       String
  d0Date          String   // 실제 D0 날짜 (YYYYMMDD)

  // D-5~D+20 일별 수익률 배열 (JSON: {"d-5":0.01, "d0":0.02, ...})
  dailyReturns    Json
  dailyAR         Json     // 일별 초과수익 (종목 - 시장)
  cumulativeAR    Json     // 누적 초과수익

  volumeRatios    Json     // {"d1":3.2, "d3":2.1}
  maxDrawdown     Float    // D0~D+20 최대낙폭 (%)
  isUpD5          Boolean  // D+5 기준 양수 수익 여부
  isCrashD5       Boolean  // D+5 기준 -5% 이하 여부

  createdAt       DateTime @default(now())

  @@index([eventType, bucketKey])
  @@index([rcpNo])
  @@index([corpCode])
  @@map("event_study_observations")
}
```

### 4-2. 버킷(Bucket) 규칙

버킷키는 `eventType__조건1__조건2` 형식 문자열.

#### 공급계약(SUPPLY_CONTRACT) 버킷
| bucketKey | 조건 |
|-----------|------|
| `SUPPLY_CONTRACT__ratio_lt5` | 계약금액/최근매출 < 5% |
| `SUPPLY_CONTRACT__ratio_5to20` | 5% ≤ 비율 < 20% |
| `SUPPLY_CONTRACT__ratio_gte20` | 비율 ≥ 20% |
| `SUPPLY_CONTRACT__amendment` | isAmendment = true (정정공시) |
| `SUPPLY_CONTRACT__cancellation` | 계약 취소 |
| `SUPPLY_CONTRACT__large_corp` | 상대방이 대기업(상호출자제한) |
| `SUPPLY_CONTRACT__overseas` | 해외 상대방 |
| `SUPPLY_CONTRACT__ratio_gte20__large_corp` | 복합: 비율 20%↑ + 대기업 |

#### 자기주식(SHARE_BUYBACK / SHARE_CANCELLATION)
| bucketKey | 조건 |
|-----------|------|
| `SHARE_BUYBACK__ratio_lt1` | 취득 규모 / 시총 < 1% |
| `SHARE_BUYBACK__ratio_1to3` | 1~3% |
| `SHARE_BUYBACK__ratio_gte3` | 3%↑ |
| `SHARE_CANCELLATION__all` | 전량 소각 |

#### 유상증자(PAID_IN_CAPITAL_INCREASE)
| bucketKey | 조건 |
|-----------|------|
| `PAID_IN_CAPITAL__third_party_lt10pct_dilution` | 제3자배정 희석률 < 10% |
| `PAID_IN_CAPITAL__third_party_gte10pct_dilution` | 희석률 ≥ 10% |
| `PAID_IN_CAPITAL__rights_offering` | 주주배정 |

#### CB/BW 발행
| bucketKey | 조건 |
|-----------|------|
| `CB_ISSUANCE__ratio_lt5` | 발행금액/시총 < 5% |
| `CB_ISSUANCE__ratio_gte5` | 5%↑ |
| `BW_ISSUANCE__all` | 전체 |

#### 배당(DIVIDEND_INCREASE / DIVIDEND_CUT)
| bucketKey | 조건 |
|-----------|------|
| `DIVIDEND_INCREASE__gte20pct_yoy` | 전년 대비 20%↑ |
| `DIVIDEND_INCREASE__lt20pct_yoy` | 20% 미만 증가 |
| `DIVIDEND_CUT__all` | 배당 감소/폐지 |

### 4-3. D0 지정 알고리즘

```typescript
function calcD0(disclosure: Disclosure): string /* YYYYMMDD */ {
  const rcpTime = parseRcpDt(disclosure.rcpDt); // DateTime
  const isTradeDay = isKRXTradeDay(rcpTime.date);
  const marketClose = setTime(rcpTime.date, 15, 20); // 15:20

  if (isTradeDay && rcpTime <= marketClose) {
    return formatDate(rcpTime.date); // 당일 D0
  } else {
    return formatDate(nextTradeDay(rcpTime.date)); // 다음 거래일
  }
}
```

### 4-4. 초과수익(AR) 계산 의사코드

```typescript
// 단일 관측치 AR 계산
function calcAR(
  stockReturns: number[],      // D-5~D+20 종목 일별 수익률 배열
  marketReturns: number[],     // 동일 기간 시장(KOSPI/KOSDAQ) 수익률
  sectorReturns: number[],     // 업종지수 수익률
): { dailyAR: number[]; cumulativeAR: number[] } {
  // 시장모델: AR_t = R_stock_t - R_market_t (단순 차분법)
  // 고급 옵션: 사전 추정 기간(D-120~D-21)으로 CAPM beta 추정 후 AR_t = R_t - (alpha + beta * R_m_t)
  const dailyAR = stockReturns.map((r, i) => r - marketReturns[i]);
  const cumulativeAR = dailyAR.reduce<number[]>((acc, ar, i) => {
    acc.push(i === 0 ? ar : acc[i - 1] + ar);
    return acc;
  }, []);
  return { dailyAR, cumulativeAR };
}

// 버킷별 집계
function aggregateBucket(observations: EventStudyObservation[]): EventStudyResult {
  const n = observations.length;
  if (n < 30) return { status: 'INSUFFICIENT', sampleCount: n };

  const arD1 = observations.map(o => o.cumulativeAR['d1']);
  const arD5 = observations.map(o => o.cumulativeAR['d5']);
  const arD20 = observations.map(o => o.cumulativeAR['d20']);

  const avgArD1 = mean(arD1);
  const stdErr = stdDev(arD1) / Math.sqrt(n);
  const tStat = avgArD1 / stdErr;
  const pValue = tDistPValue(tStat, n - 1); // t 분포 양측 검정

  return {
    sampleCount: n,
    avgArD1, avgArD3: mean(observations.map(o => o.cumulativeAR['d3'])),
    avgArD5: mean(arD5), avgArD20: mean(arD20),
    avgReturnD1: mean(observations.map(o => o.dailyReturns['d1'])),
    upProbD5: observations.filter(o => o.isUpD5).length / n,
    crashProbD5: observations.filter(o => o.isCrashD5).length / n,
    avgMaxDrawdown: mean(observations.map(o => o.maxDrawdown)),
    avgVolumeRatioD1: mean(observations.map(o => o.volumeRatios['d1'])),
    isSignificant: pValue < 0.05,
    tStatistic: tStat, pValue,
    status: 'READY',
  };
}
```

### 4-5. NestJS 모듈 구조

```
backend/src/
└── event-study/
    ├── event-study.module.ts
    ├── event-study.service.ts          // 집계·재계산 핵심 로직
    ├── event-study-observation.service.ts  // 관측치 생성·저장
    ├── event-study.controller.ts       // REST API
    ├── event-study.scheduler.ts        // 주기적 재집계 cron
    ├── dto/
    │   ├── query-event-study.dto.ts
    │   └── event-study-result.dto.ts
    └── utils/
        ├── d0-calculator.ts
        ├── abnormal-return.ts
        └── bucket-classifier.ts
```

### 4-6. API 엔드포인트

```typescript
// GET /event-study/results
// 쿼리: eventType, bucketKey, marketType, onlySignificant
queryResults(dto: QueryEventStudyDto): Promise<EventStudyResultDto[]>

// GET /event-study/results/:eventType/:bucketKey
// 특정 버킷 단일 조회
getResult(eventType: string, bucketKey: string): Promise<EventStudyResultDto>

// POST /event-study/recalculate (관리자 전용)
// Body: { eventType?, fromDate?, toDate? }
// 특정 이벤트 타입 또는 전체 재집계 트리거
triggerRecalculate(body: RecalculateDto): Promise<{ jobId: string }>

// GET /event-study/observations/:rcpNo
// 특정 공시의 관측치 조회 (디버깅)
getObservation(rcpNo: string): Promise<EventStudyObservationDto>

// GET /event-study/summary
// 이벤트 타입별 표본 수·유의성 현황 요약
getSummary(): Promise<EventStudySummaryDto>
```

### 4-7. Buy Score 연결 (Phase 6 인터페이스)

```typescript
// event-study.service.ts
async getEventStudyScore(
  eventType: string,
  bucketKey: string,
  marketType: 'KOSPI' | 'KOSDAQ',
): Promise<number> {
  // -20 ~ +20 점수 반환
  const result = await this.findResult(eventType, bucketKey, marketType);
  if (!result || !result.isSignificant) return 0; // 유의하지 않으면 0점

  let score = 0;
  // D+5 누적 AR 기반 기여점
  if (result.avgArD5 >= 5) score += 10;
  else if (result.avgArD5 >= 2) score += 5;
  else if (result.avgArD5 >= 0) score += 2;
  else if (result.avgArD5 < -2) score -= 5;
  else if (result.avgArD5 < -5) score -= 10;

  // 상승확률 보정
  if (result.upProbD5 >= 0.65) score += 5;
  else if (result.upProbD5 >= 0.55) score += 2;
  else if (result.upProbD5 < 0.40) score -= 5;

  // 급락확률 패널티
  if (result.crashProbD5 >= 0.20) score -= 5;
  return Math.max(-20, Math.min(20, score));
}
```

### 4-8. 집계 스케줄

| 주기 | 동작 |
|------|------|
| 매일 새벽 02:00 | 전일까지 D+20 확보된 신규 관측치를 모든 버킷에 추가 후 재집계 |
| 월 1회 (첫째 일요일 03:00) | 전체 버킷 완전 재계산 (가중치·이상치 제거 포함) |
| 수동 트리거 | `POST /event-study/recalculate` (관리자) |

---

## 5. 작업 분해

### 5-1. 기반 준비
- [ ] `EventStudyResult`, `EventStudyObservation` Prisma 모델 추가 및 마이그레이션 실행
- [ ] `StockDailyPrice`(Phase 5) 및 시장지수/업종지수 테이블 존재 확인
- [ ] `DisclosureEvent`(Phase 3) 테이블 구조 검증 — eventType, extractedData JSON 필드 확인
- [ ] KRX 거래일 캘린더 유틸 구현 (`isKRXTradeDay`, `nextTradeDay`)

### 5-2. 관측치 생성 파이프라인
- [ ] `D0Calculator` 구현 — rcpDt 파싱, 장중/장후 분기, 다음 거래일 계산
- [ ] `BucketClassifier` 구현 — eventType + extractedData JSON → bucketKey 문자열 결정
- [ ] `AbnormalReturnCalculator` 구현 — 단순 차분법, CAPM beta 옵션
- [ ] `EventStudyObservationService.createObservation()` — 단일 DisclosureEvent → 관측치 저장
- [ ] 배치 관측치 생성 스크립트 — 과거 전체 DisclosureEvent 처리

### 5-3. 집계 엔진
- [ ] `EventStudyService.aggregateBucket()` — 관측치 → t-통계·p-값·평균 계산
- [ ] 표본 부족(n < 30) 처리 — status=INSUFFICIENT, score=0 처리
- [ ] 이상치 제거 로직 — |AR| > 3σ 관측치 제외 후 재집계
- [ ] `EventStudyResult` upsert (eventType + bucketKey + marketType 기준)

### 5-4. API 및 모듈
- [ ] `EventStudyModule`, `EventStudyController` 생성
- [ ] REST 엔드포인트 5개 구현 (§4-6)
- [ ] `EventStudyScheduler` — cron 일별/월별 등록
- [ ] Swagger 문서 어노테이션 추가

### 5-5. Buy Score 연결
- [ ] `EventStudyService.getEventStudyScore()` 구현 (§4-7)
- [ ] Phase 6 `BuyScoreService`에서 `getEventStudyScore` 주입·호출
- [ ] 점수 연결 통합 테스트 — eventType/bucketKey별 점수 정합성 확인

### 5-6. 검증 및 문서
- [ ] 샘플 버킷(SUPPLY_CONTRACT__ratio_gte20) AR·t-통계 수동 검증
- [ ] `docs/database-schema.md` — 신규 모델 2개 추가
- [ ] `docs/api-specification.md` — event-study 엔드포인트 추가
- [ ] `PROJECT_STRUCTURE.md` — `backend/src/event-study/` 경로 추가
- [ ] `NEXT_STEPS.md` — Phase 9 완료 체크 표시

---

## 6. AI 사용 정책

Phase 9는 **통계 연산 중심**이므로 AI 사용 범위가 제한적이다.

| 항목 | 방침 |
|------|------|
| 버킷 분류 | **AI 금지** — Rule 기반 `BucketClassifier`만 사용. 수치 기반 조건이므로 AI 필요 없음 |
| AR 계산·t-통계 | **AI 금지** — 수식 기반 순수 연산 |
| 결과 요약 리포트 | **AI 보조 허용 (L2)** — 이벤트 타입별 통계 요약을 사용자에게 자연어로 설명할 때만 |
| 버킷 설계 확장 | **AI 보조 허용 (L1)** — 신규 이벤트 타입의 버킷 기준 초안 생성 시 |

**AI 금지 영역 (절대):**
- AR 통계값을 직접 투자 신호로 변환하는 최종 판단
- 손익 하드룰 설정 (MDD 임계값 등은 Rule Engine이 담당)
- 포트폴리오 비중 결정

---

## 7. 비용 & 성능 고려사항

| 항목 | 목표/제약 |
|------|-----------|
| **AI 비용** | Phase 9 자체 AI 호출 없음 (L2 리포트는 온디맨드, 월 수천 원 수준) |
| **집계 연산** | 버킷당 1,000건 × 40일치 수익률 → PostgreSQL 집계 쿼리 최적화, 필요 시 materialized view |
| **저장 용량** | 관측치 10,000건 × JSON 4KB ≒ 40MB, 문제 없음 |
| **일별 증분 집계** | 하루 평균 신규 관측치 10~50건 → 2초 이내 처리 목표 |
| **전체 재계산** | 10,000건 전체 → 월 1회, 5분 이내 완료 목표 |
| **인덱스 전략** | `(eventType, bucketKey, marketType)` 복합 UNIQUE, `eventType` 단일, `calculatedAt` — 조회 패턴 커버 |
| **시장 지수 캐싱** | 집계 시 `StockDailyPrice` 조인 비용 절감을 위해 계산 시작 전 지수 데이터 메모리 로드 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| **표본 부족** | 버킷당 n < 30 시 `status=INSUFFICIENT`, `getEventStudyScore()` 0점 반환. Buy Score에 영향 없음 |
| **서바이버십 편향** | 상장폐지·거래정지 종목도 관측치에 포함. 정지일 이후 수익률은 `-100%`로 기록하고 별도 집계에서 분리 플래그 표시 |
| **정정·취소공시 혼입** | isAmendment/isCancellation이 true인 이벤트는 별도 버킷으로 격리. 원공시 버킷에 포함 금지 |
| **장 기간 휴장 (추석·설)** | KRX 거래일 캘린더 미갱신 시 D0 오계산. 연 1회 캘린더 데이터 갱신 절차 필수 |
| **상·하한가 연속 체결 불가** | D+1 시가 진입 가정 시 상한가 갭업 후 미체결 가능성. 관측치에 `isLimitUp` 플래그 추가, 별도 집계 제공 |
| **업종지수 데이터 부재** | 업종 AR 계산 불가 시 시장 AR로 fallback. 차이를 결과 metadata에 표시 |
| **공시 시각 파싱 오류** | rcpDt가 YYYYMMDD 8자리만인 경우 시각 미상 → 보수적으로 다음 거래일을 D0로 지정 |
| **이벤트 타입 미분류** | DisclosureEvent.eventType이 null인 공시는 집계에서 제외, Phase 3 재처리 후 자동 추가됨 |
| **AR 이상치** | 시장 전체 급락일(코로나 등) 제거 없이 집계 시 편향. 시장 일별 수익률 |mktR| > 5% 날은 이상치 플래그 부여 후 선택적 제외 옵션 제공 |

---

## 9. 완료 기준 (DoD)

- [ ] `EventStudyResult`, `EventStudyObservation` Prisma 마이그레이션이 스테이징 DB에서 오류 없이 실행됨
- [ ] `BucketClassifier`가 공급계약(SUPPLY_CONTRACT) 이벤트 3개 이상 버킷에 정확히 분류됨 (단위테스트 통과)
- [ ] D0 계산 로직이 장중 공시·장후 공시·휴일 공시 3종 케이스 모두 정확한 거래일을 반환함 (단위테스트)
- [ ] `SUPPLY_CONTRACT__ratio_gte20` 버킷에 표본 30건 이상 집계 후 t-통계·p-값이 계산되어 저장됨
- [ ] `GET /event-study/results?eventType=SUPPLY_CONTRACT` 응답이 2초 이내 반환됨
- [ ] 서바이버십 편향 처리 — 거래정지 종목 관측치가 별도 플래그와 함께 저장됨
- [ ] `getEventStudyScore('SUPPLY_CONTRACT', 'SUPPLY_CONTRACT__ratio_gte20', 'KOSPI')` 가 Phase 6 BuyScoreService에서 정상 호출되고 −20~+20 범위의 값을 반환함
- [ ] 유의하지 않은 버킷(p ≥ 0.05) 또는 INSUFFICIENT 버킷의 점수는 0으로 Buy Score에 반영됨
- [ ] 일별 증분 집계 cron이 스테이징 환경에서 정상 실행되고 `calculatedAt`이 갱신됨
- [ ] `docs/database-schema.md`, `docs/api-specification.md`, `PROJECT_STRUCTURE.md`, `NEXT_STEPS.md` 업데이트 완료

---

*최종 수정일: 2026-06-02*
