> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 0 — 프로젝트 기준선 정리

> 작성일: 2026-06-02 · 상태: 확정

---

## 1. 목적 & 범위

### 목적

전체 투자 시스템을 처음부터 전부 만들려 하면 비용·복잡도가 통제 불가능한 수준이 된다.
Phase 0은 **"무엇을 하지 않을지"를 명확히 확정**하여 이후 모든 Phase의 전제 조건을 고정한다.

핵심 질문: **이 시스템이 AI 비용과 데이터 비용을 제하고도 실제 투자 판단 개선에 도움이 되는가?**
이 질문에 답하기 위한 최소 분석 대상·공시 유형·Persona·매매 범위를 확정한다.

### 범위 — 포함

- 분석 유니버스 선정 기준 (쿼리·필터 로직)
- 초기 공시 5종의 `Disclosure.reportName` 패턴 매핑
- Persona 4종 정의, 선호 이벤트, 점수 가중 성향
- 초기 매매 범위 (리포트 + 모의투자 중심, 자동매매 금지)
- 비용 대비 기대값 검증 접근법

### 범위 — 제외

- Phase 0에서는 실제 코드 구현 없음 (설계·기준선 문서만)
- AI 호출 없음 (L0 단계: 전면 미사용)
- 자동매매, 반자동매매, 증권사 API 연동
- 공시 원문 파싱 (Phase 2 시작)
- 백테스트, 모의투자 (Phase 10, 12에서 시작)

---

## 2. 현재 코드베이스 연결점

Phase 0은 구현이 아닌 기준선 문서이므로, 현재 코드베이스에서 **읽기 전용**으로 참조한다.

| 현재 존재하는 것 | Phase 0과의 연결 |
|-----------------|-----------------|
| `Company` 모델 (`corpCode` PK, `stockCode`, `market`) | 분석 유니버스 쿼리의 기준 테이블 |
| `WatchList` 모델 (`userId`, `corpCode`) | 보유/관심 종목 필터의 데이터 소스 |
| `Disclosure` 모델 (`rcpNo` PK, `reportName`, `disclosureType`) | 공시 5종 패턴 매핑 대상 |
| `NotificationSettings.disclosureTypes` | 7종 유형 분류 → 5종 이벤트 매핑의 현재 기반 |
| 공시 수집 스케줄러 (`DisclosureService`) | 향후 유니버스 필터 적용 위치 |

현재 `disclosureType`은 7종 대분류(REGULAR/MATERIAL/ISSUANCE/EQUITY/AUDIT/EXCHANGE/OTHER)로만 구분된다.
Phase 0에서 정의하는 **5종 이벤트 패턴**은 `reportName` 정규식 매핑으로 더 세분화된 분류 기반을 제공한다.

---

## 3. 선행 조건 & 의존성

| 의존 항목 | 상태 | 비고 |
|----------|------|------|
| DART 공시 수집 스케줄러 동작 | ✅ 완료 | `Disclosure` 테이블에 데이터 누적 중 |
| `Company` 마스터 데이터 | ✅ 완료 | corpCode/stockCode/market 보유 |
| `WatchList` 기능 | ✅ 완료 | 관심 종목 기반 필터의 전제 |
| Phase 0은 다른 Phase에 대한 의존성 없음 | — | 가장 먼저 확정되어야 하는 기준선 |

Phase 0이 확정되어야 Phase 1(수집 안정화)에서 어떤 종목에 집중할지 결정할 수 있고,
Phase 3(이벤트 추출)에서 어떤 이벤트 enum을 설계할지 결정할 수 있다.

---

## 4. 상세 설계

### 4-1. 분석 유니버스 선정

분석 유니버스는 **전체 상장사(약 2,600개)가 아닌** 다음 조건 중 하나 이상을 만족하는 종목으로 제한한다.

#### 4-1-1. 선정 기준 4개 버킷

| 버킷 | 설명 | 우선순위 |
|------|------|---------|
| A. 보유 종목 | 사용자 포트폴리오에 현재 보유 중인 종목 | 최우선 (Exit Signal 필요) |
| B. 관심 종목 | `WatchList`에 등록된 종목 | 높음 |
| C. 거래대금 임계치 | 최근 20거래일 평균 거래대금 ≥ 50억 원 | 중간 (유동성 보장) |
| D. 이벤트 트리거 종목 | 아래 5종 이벤트 공시 발생 종목 | 이벤트 발생 시 일시 편입 |

#### 4-1-2. 유니버스 쿼리 로직 (의사코드)

```typescript
// AnalysisUniverseService.getUniverse(userId: string): Promise<string[]>
async function getUniverse(userId: string): Promise<string[]> {
  // A. 보유 종목 (Phase 7 이후 Portfolio 테이블에서 조회)
  const holdingCorpCodes: string[] = await getHoldingCorpCodes(userId);

  // B. 관심 종목
  const watchlistCorpCodes: string[] = await prisma.watchList
    .findMany({ where: { userId }, select: { corpCode: true } })
    .then(r => r.map(x => x.corpCode));

  // C. 거래대금 임계치 종목 (Phase 5 StockDailyPrice 테이블 구축 후 활성화)
  // 초기에는 비활성화, 상위 200개 코스피/코스닥 종목 하드코딩으로 대체
  const volumeThresholdCorpCodes: string[] = await getHighVolumeCorpCodes({
    minAvgTurnover: 5_000_000_000, // 50억 원
    lookbackDays: 20,
  });

  // D. 이벤트 트리거 (공시 발생 시 자동 편입 — 아래 5종 패턴 매칭 시)
  const eventTriggeredCorpCodes: string[] = await getRecentEventCorpCodes({
    eventPatterns: INITIAL_DISCLOSURE_PATTERNS,
    withinHours: 48,
  });

  // 합집합, 최대 200개 제한 (초기 MVP)
  const universe = unique([
    ...holdingCorpCodes,
    ...watchlistCorpCodes,
    ...volumeThresholdCorpCodes,
    ...eventTriggeredCorpCodes,
  ]);

  // 분석 제외 필터 (Phase 0 안전 기준)
  return universe.filter(corpCode =>
    !isManagementIssue(corpCode) &&    // 관리종목 제외
    !isTradingSuspended(corpCode) &&   // 거래정지 제외
    !isDelistingRisk(corpCode)         // 상폐위험 제외
  ).slice(0, 200);
}
```

#### 4-1-3. 초기 유니버스 크기 목표

| 단계 | 목표 크기 | 비고 |
|------|----------|------|
| Phase 0 ~ 3 | 관심 종목 최대 50개 | 구현 검증용 최소 집합 |
| Phase 4 ~ 6 | 최대 100개 | AI 비용 제어를 위한 상한 |
| Phase 7 ~ 11 | 최대 200개 | 거래대금 버킷 추가 |
| Phase 12 이후 | 재평가 | 모의투자 성과 기반으로 결정 |

---

### 4-2. 초기 공시 5종 — DART reportName 패턴 매핑

아래 패턴은 `Disclosure.reportName` 필드(DART `report_nm`)에 대해 PostgreSQL `ILIKE` 또는 Node.js 정규식으로 적용한다.

#### 이벤트 enum 정의

```typescript
export enum InitialDisclosureEventType {
  SUPPLY_CONTRACT    = 'SUPPLY_CONTRACT',     // 단일판매·공급계약
  SHARE_BUYBACK      = 'SHARE_BUYBACK',       // 자기주식 취득
  SHARE_CANCELLATION = 'SHARE_CANCELLATION',  // 자기주식 소각
  DIVIDEND           = 'DIVIDEND',            // 현금·현물배당
  PAID_IN_CAPITAL    = 'PAID_IN_CAPITAL',     // 유상증자
  CB_BW              = 'CB_BW',              // CB·BW 발행
}
```

#### 패턴 매핑 테이블

| 이벤트 | DART report_nm 패턴 (정규식) | 투자 방향성 |
|--------|------------------------------|------------|
| **단일판매·공급계약** | `/단일판매[··]공급계약/` | 매출 성장 긍정, 규모/상대방 중요 |
| *(정정/취소 포함)* | `/단일판매[··]공급계약.*정정/`, `/단일판매[··]공급계약.*취소/` | 취소는 강한 부정 신호 |
| **자기주식 취득** | `/자기주식.*취득/`, `/자사주.*취득/` | 주가 방어·환원 긍정 |
| **자기주식 소각** | `/자기주식.*소각/`, `/자사주.*소각/` | 주당가치 제고 강한 긍정 |
| **현금배당** | `/현금.*배당/, /배당.*결정/` | 배당 성향 긍정, 배당컷은 부정 |
| **현물배당** | `/현물.*배당/` | 현물 종류 확인 필요 |
| **유상증자** | `/유상증자/` | 발행 목적·규모 따라 희석 부정 or 성장 긍정 |
| *(3자배정 구분)* | `/유상증자.*제3자/`, `/제3자.*배정/` | 상대방·조건 추가 분석 필요 |
| **CB 발행** | `/전환사채/, /CB 발행/i` | 희석 부정 요인, 규모·전환가 중요 |
| **BW 발행** | `/신주인수권부사채/, /BW 발행/i` | CB와 유사, 희석 부정 요인 |

#### 패턴 매핑 구현 스케치

```typescript
// backend/src/disclosure/constants/event-patterns.ts
export const INITIAL_DISCLOSURE_PATTERNS: DisclosurePattern[] = [
  {
    eventType: InitialDisclosureEventType.SUPPLY_CONTRACT,
    patterns: [/단일판매[··]공급계약/],
    negativePatterns: [/취소/, /해지/],
    correctionPattern: /정정/,
    priority: 1,
  },
  {
    eventType: InitialDisclosureEventType.SHARE_BUYBACK,
    patterns: [/자기주식.{0,10}취득/, /자사주.{0,10}취득/],
    priority: 2,
  },
  {
    eventType: InitialDisclosureEventType.SHARE_CANCELLATION,
    patterns: [/자기주식.{0,10}소각/, /자사주.{0,10}소각/],
    priority: 2,
  },
  {
    eventType: InitialDisclosureEventType.DIVIDEND,
    patterns: [/현금.{0,5}배당/, /현물.{0,5}배당/, /배당.{0,5}결정/],
    priority: 3,
  },
  {
    eventType: InitialDisclosureEventType.PAID_IN_CAPITAL,
    patterns: [/유상증자/],
    subPatterns: { THIRD_PARTY: /제3자.{0,5}배정/ },
    priority: 4,
  },
  {
    eventType: InitialDisclosureEventType.CB_BW,
    patterns: [/전환사채/, /신주인수권부사채/],
    priority: 5,
  },
];

// 분류 함수 시그니처
function classifyDisclosureEvent(
  reportName: string,
  patterns: DisclosurePattern[]
): { eventType: InitialDisclosureEventType | null; isAmendment: boolean; isCancellation: boolean }
```

---

### 4-3. Persona 4종 정의

#### Persona 정의표

| Persona | 코드 | 핵심 성향 | 선호 이벤트 | 기피 이벤트 | 보유 기간 |
|---------|------|----------|------------|------------|----------|
| 가치투자형 | `VALUE` | 저평가 기업, 배당/환원 중시, 안정성 우선 | 자사주 취득·소각, 배당 확대, 공급계약(안정적 대기업 상대방) | 유상증자, CB/BW(희석), 계약 취소 | 6개월~2년 |
| 성장주형 | `GROWTH` | 매출 성장률, 신시장 진출, 탑라인 확대 | 공급계약(대규모·신규), 3자 배정 유상증자(전략적 파트너), CB(성장 투자 목적) | 배당 삭감, 자사주 소각만(성장 미활용), 계약 취소 | 3~12개월 |
| 모멘텀형 | `MOMENTUM` | 단기 가격·거래량 급등, 추세 추종 | 공급계약(대형·신규 이슈), 자사주 소각(서프라이즈), 유상증자 후 거래량 폭발 | 이미 급등 후 공시, 거래량 없는 이벤트 | 1~8주 |
| 이벤트드리븐형 | `EVENT_DRIVEN` | 공시 이벤트 자체의 단기 주가 반응 포착 | 모든 5종 이벤트 (단, 규모 임계치 이상), 정정·취소 (역방향 포함) | 이벤트 선행 급등 후 공시, 유동성 부족 | 1~10 거래일 |

#### Persona별 점수 가중 성향

```typescript
// 각 Persona의 항목별 가중치 (합산 기준 점수에 곱해지는 배수)
export const PERSONA_WEIGHTS: Record<PersonaCode, PersonaWeightConfig> = {
  VALUE: {
    disclosureEventScore: 0.8,   // 이벤트 자체보다 수치·펀더멘털
    fundamentalScore: 1.5,       // 배당성향, PBR, 부채비율
    chartScore: 0.5,             // 차트 비중 낮음
    volumeScore: 0.4,            // 거래량 덜 중요
    riskPenaltyMultiplier: 1.4,  // 리스크 패널티 더 강하게
    dilutionPenalty: 2.0,        // 희석 패널티 강화
  },
  GROWTH: {
    disclosureEventScore: 1.3,
    fundamentalScore: 0.7,
    chartScore: 0.8,
    volumeScore: 1.0,
    riskPenaltyMultiplier: 1.0,
    dilutionPenalty: 0.6,        // 성장 목적 증자는 덜 페널티
    contractSizeBonus: 1.5,      // 계약금액/매출 비율 보너스
  },
  MOMENTUM: {
    disclosureEventScore: 1.0,
    fundamentalScore: 0.3,
    chartScore: 1.8,             // 차트·추세 비중 매우 높음
    volumeScore: 1.8,            // 거래량 폭증 매우 중요
    riskPenaltyMultiplier: 0.8,  // 추세장에서 리스크 패널티 완화
    priorRunupPenalty: 2.0,      // 공시 전 선행 급등 강한 패널티
  },
  EVENT_DRIVEN: {
    disclosureEventScore: 1.5,   // 이벤트 자체 비중 최대
    fundamentalScore: 0.4,
    chartScore: 1.0,
    volumeScore: 1.3,
    riskPenaltyMultiplier: 1.0,
    eventSizeThreshold: 1.8,     // 임계치 미달 이벤트 패널티
    cancellationBonus: 1.5,      // 취소·정정도 역방향 신호로 활용
  },
};
```

#### Persona × 이벤트 기본 점수 매트릭스

| 이벤트 | VALUE | GROWTH | MOMENTUM | EVENT_DRIVEN |
|--------|-------|--------|----------|-------------|
| 공급계약 (매출 20%↑) | +20 | +30 | +25 | +30 |
| 공급계약 (매출 5% 미만) | +5 | +10 | +5 | -5 |
| 공급계약 취소 | -30 | -25 | -35 | -30 |
| 자사주 취득 | +25 | +10 | +20 | +20 |
| 자사주 소각 | +30 | +15 | +25 | +25 |
| 배당 확대 | +30 | +5 | +10 | +15 |
| 배당 삭감 | -35 | -20 | -30 | -25 |
| 유상증자 (운영자금) | -20 | -10 | -25 | -20 |
| 3자 배정 (전략) | -5 | +15 | +10 | +10 |
| CB 발행 | -15 | -5 | -20 | -15 |
| BW 발행 | -15 | -5 | -20 | -15 |

---

### 4-4. 초기 매매 범위

#### 자동매매 전면 금지 (Phase 0 ~ 11)

> **AI 금지 영역 명시:** Phase 0 ~ 11 기간 중 AI는 최종 주문 승인, 손절·익절 하드 룰, 포트폴리오 한도, 주문 수량 결정, 리스크 룰 우회에 관여하지 않는다. 이 금지는 Phase 14에서도 Risk Engine이 거부하면 변경되지 않는다.

| 기능 | Phase 0~6 | Phase 7~11 | Phase 12~13 | Phase 14 |
|------|-----------|-----------|------------|---------|
| 분석 리포트 생성 | ✅ | ✅ | ✅ | ✅ |
| Buy Score 계산 | ❌ | ✅ | ✅ | ✅ |
| Exit Score 계산 | ❌ | ✅ | ✅ | ✅ |
| 모의투자 | ❌ | ❌ | ✅ | ✅ |
| 사용자 승인 후 주문 | ❌ | ❌ | ❌ | ✅(반자동) |
| 자동 주문 | ❌ | ❌ | ❌ | ✅(제한적) |

#### 초기 산출물 정의

1. **공시 분석 리포트**: 이벤트 분류 + 핵심 수치 + AI 정성 해석 + Persona별 해석
2. **매수 후보 알림**: Buy Score ≥ 60 종목, 진입 조건 포함
3. **보유 종목 모니터링**: Exit Score 주 1회 계산 → 위험 알림
4. **모의투자 성과 보고**: 월간 수익률, 이벤트별 성과, AI 비용 요약

---

### 4-5. 비용 대비 기대값 검증 접근법

#### 검증 지표 (Phase 0에서 확정, Phase 4~11에서 측정)

```typescript
// 검증 지표 구조체
interface ValueValidationMetrics {
  // 비용 지표
  aiCostPerDisclosure: number;       // 공시 1건당 AI 비용 (원)
  aiCostPerSignal: number;           // 신호 1건당 AI 비용
  aiCostPerAnalysisReport: number;   // 리포트 1건당 AI 비용

  // 가치 지표
  signalAccuracyRate: number;        // 신호 적중률 (모의투자 기준)
  falsePositiveRate: number;         // 오탐률
  avgReturnPerSignal: number;        // 신호당 평균 수익률 (모의투자)
  avoidedLossEstimate: number;       // Exit Signal로 회피한 추정 손실액

  // 판단 기준
  aiCostToGrossProfitRatio: number;  // AI 비용 / 모의투자 총수익 (< 20% 목표)
  aiCostToNetProfitRatio: number;    // AI 비용 / 순수익 (< 10% 목표)
}
```

#### 단계별 검증 게이트

| 게이트 | 확인 시점 | 통과 기준 | 실패 시 조치 |
|-------|----------|----------|------------|
| G1 파싱 가치 | Phase 3 완료 | 5종 이벤트 패턴 매칭 정확도 ≥ 90% | 패턴 보완 후 재측정 |
| G2 AI 비용 | Phase 4 완료 2주 후 | AI비용/공시건수 < 100원, 월 AI비용 < 10만 원 | AI 호출 범위 축소 |
| G3 신호 가치 | Phase 6 완료 1개월 후 | Buy Score ≥ 60 신호의 D+5 수익률 > 0% (모의) | 점수 가중치 재조정 |
| G4 투자판단 개선 | Phase 12 완료 3개월 후 | 모의투자 수익률 > 코스피 벤치마크, AI비용/순수익 < 20% | Phase 13 진입 불허 |

---

### 4-6. DB 스키마 스케치 (Phase 0 신규 추가 모델)

Phase 0에서 분석 유니버스와 이벤트 패턴 관리를 위해 추가하는 모델.

```prisma
// 분석 유니버스 등록 (버킷 A~D 관리)
model AnalysisUniverse {
  id        String   @id @default(cuid())
  corpCode  String                        // FK → Company.corpCode
  bucket    String                        // "HOLDING" | "WATCHLIST" | "VOLUME" | "EVENT"
  addedAt   DateTime @default(now())
  expiresAt DateTime?                     // EVENT 버킷은 48시간 TTL
  isActive  Boolean  @default(true)

  company   Company  @relation(fields: [corpCode], references: [corpCode])

  @@unique([corpCode, bucket])
  @@index([isActive, bucket])
  @@index([expiresAt])
  @@map("analysis_universe")
}

// 이벤트 패턴 매핑 결과 캐시 (Disclosure 분류 결과 저장)
model DisclosureEventClassification {
  rcpNo        String  @id               // FK → Disclosure.rcpNo
  eventType    String?                   // InitialDisclosureEventType enum
  isAmendment  Boolean @default(false)
  isCancellation Boolean @default(false)
  matchedPattern String?                 // 매칭된 패턴 (디버깅용)
  classifiedAt DateTime @default(now())

  disclosure   Disclosure @relation(fields: [rcpNo], references: [rcpNo])

  @@index([eventType])
  @@index([classifiedAt])
  @@map("disclosure_event_classifications")
}
```

---

## 5. 작업 분해

### Phase 0 체크리스트

#### 기준선 문서 확정

- [ ] 분석 유니버스 4개 버킷 기준 확정 (이 문서로 완료)
- [ ] 공시 5종 DART reportName 패턴 검증 — 실 데이터 100건 이상 샘플로 정규식 정확도 측정
- [ ] Persona 4종 정의 및 가중치 1차 확정 (이 문서로 완료, Phase 6에서 조정)
- [ ] 초기 유니버스 크기 상한 결정 (Phase 0~3: 50개, Phase 4~6: 100개)

#### 코드 기반 작업 (Phase 1 착수 전 준비)

- [ ] `backend/src/disclosure/constants/event-patterns.ts` 파일 생성 (패턴 상수 정의)
- [ ] `InitialDisclosureEventType` enum 생성 (`backend/src/common/enums/disclosure-event-type.enum.ts`)
- [ ] `classifyDisclosureEvent()` 유틸 함수 작성 및 단위 테스트
- [ ] 기존 `Disclosure` 테이블 샘플 데이터 100건에 대해 패턴 매칭 검증 스크립트 실행
- [ ] Persona 가중치 상수 파일 생성 (`backend/src/common/constants/persona-weights.ts`)

#### DB 준비

- [ ] `AnalysisUniverse` 테이블 마이그레이션 작성
- [ ] `DisclosureEventClassification` 테이블 마이그레이션 작성
- [ ] `Company` 테이블의 `market` 필드 데이터 품질 확인 (KOSPI/KOSDAQ 구분 누락 건수 파악)

#### 검증 게이트 G1 준비

- [ ] 패턴 매칭 정확도 측정 스크립트 작성 (`scripts/validate-event-patterns.ts`)
- [ ] 실 데이터 100건 샘플 추출 → 수동 라벨링 → 자동 분류 비교
- [ ] 오분류 패턴 분석 및 정규식 보완

---

## 6. AI 사용 정책

**Phase 0: AI 전면 미사용 (Level 0)**

| 항목 | 내용 |
|------|------|
| AI 호출 여부 | 없음 |
| 이유 | Phase 0은 코드 구현이 아닌 기준선 문서 확정 단계. 패턴 매핑은 Rule 기반 정규식으로 충분 |
| 비용 | 0원 |
| Phase 0 이후 AI 도입 시점 | Phase 4 (AI Analyst Engine) |

**AI 금지 영역 (전 Phase 공통 명시)**

다음 항목은 Phase 14 자동매매 단계에서도 AI에 위임하지 않는다:

- 최종 주문 승인 (사람 또는 하드 룰만)
- 손절·익절 가격 하드 룰 (퍼센트 수치 자체)
- 포트폴리오 종목·섹터 비중 한도
- 주문 수량·금액 결정
- Risk Engine의 거부 결정 우회

---

## 7. 비용·성능 고려사항

| 항목 | 초기 목표치 | 비고 |
|------|------------|------|
| 분석 유니버스 크기 | 최대 50개 (Phase 0~3) | 비용 제어를 위한 절대 상한 |
| 패턴 매칭 처리 시간 | < 10ms / 공시 1건 | 정규식 기반, DB 조회 없음 |
| 유니버스 갱신 주기 | 1일 1회 (자정 배치) | EVENT 버킷은 공시 발생 즉시 |
| `AnalysisUniverse` 테이블 크기 | < 1,000 행 | 만료된 항목 정기 정리 |
| Phase 4 AI 도입 시 월 상한 | 10만 원 | 초과 시 호출 범위 자동 축소 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 발생 조건 | 대응 |
|--------|----------|------|
| 패턴 오분류 | DART report_nm 표기 변경, 비정형 제목 | 미분류(`eventType: null`) 처리 후 수동 보완, 월 1회 오분류 리뷰 |
| 유니버스 공백 | 관심 종목이 0개인 신규 사용자 | 코스피 시총 상위 50개 기본 유니버스 fallback |
| 거래대금 데이터 부재 | Phase 5 이전 `StockDailyPrice` 미구축 | 버킷 C 비활성화, 버킷 A+B만 운영 |
| 관리종목 편입 | 유니버스 등재 후 관리종목 지정 | 매일 자정 상태 재확인, 자동 제외 + 보유 포지션이면 Exit 경보 |
| 공시 제목 정정 | DART 공시 제목 자체가 정정되는 경우 | `Disclosure.reportName` 변경 감지 → 재분류 트리거 |
| Persona 미등록 사용자 | 사용자가 Persona를 선택하지 않음 | 기본값 `EVENT_DRIVEN` 적용 (가장 이벤트 중립적) |
| 계약 취소 공시 오탐 | "취소" 포함 비관련 공시 (예: "투자유의 해제") | 부정 패턴 매칭은 이벤트 타입 확정 후 적용, 단독 키워드 매칭 금지 |

---

## 9. 완료 기준 (DoD)

Phase 0은 구현 단계가 아닌 **기준선 확정 단계**이므로, DoD는 문서와 검증 스크립트 중심이다.

### 필수 완료 조건

- [ ] 공시 5종 DART `report_nm` 정규식 패턴 — 실 데이터 100건 이상 기준 정확도 ≥ 90%
- [ ] Persona 4종 정의, 선호 이벤트, 가중치 팀 합의 완료
- [ ] 분석 유니버스 버킷 A~D 기준 팀 합의 완료
- [ ] `InitialDisclosureEventType` enum 코드 파일 존재 (테스트 통과)
- [ ] `classifyDisclosureEvent()` 유틸 함수 단위 테스트 통과
- [ ] `AnalysisUniverse`, `DisclosureEventClassification` 마이그레이션 파일 작성 완료
- [ ] 비용 검증 게이트 G1~G4 기준 팀 합의 문서화

### 허용 미완료 조건 (Phase 1에서 처리)

- 버킷 C (거래대금) 실제 쿼리 구현 → Phase 5 StockDailyPrice 구축 후
- Persona 가중치 수치 최적화 → Phase 6 Buy Score 구현 후 실데이터로 조정
- 유니버스 갱신 배치 스케줄러 → Phase 1 스케줄러 안정화와 함께

---

*다음 Phase: [Phase 1 — DART 공시 수집 안정화](./phase-01-disclosure-collection.md)*
