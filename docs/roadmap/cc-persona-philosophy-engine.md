> 상위 문서: [비전](./00-vision-and-principles.md) · [실행 로드맵](./01-execution-roadmap.md) · [엔진 아키텍처](./cc-engine-architecture.md) · 작성: Agent Team (DAR-47)

# Persona 철학 엔진 로드맵

> 작성일: 2026-06-06 · 상태: 로드맵 초안 · 관련 마일스톤: M3 확장 (P-A~P-D)

---

## 1. 목적 & 범위

### 목적

현행 Engine2 `PersonaInterpretationTask`가 **4종 추상 Persona**(가치·성장·모멘텀·이벤트드리븐)를 단순 해석 레이블로 출력하는 수준에서, **실제 유명 투자자 철학을 구조화·정량화**하여 "버핏처럼 보면 어떤가?", "그린블라트 매직포뮬러 기준으로 몇 점인가?"를 자동 계산하고, 철학별 모의투자 포트폴리오까지 운용하는 엔진으로 발전시킨다.

### 현행 상태 (M3 기준)

| 현황 | 설명 |
|---|---|
| `PersonaInterpretationTask` | Engine2 AI Task로 4 Persona 해석 JSON 출력 |
| 4종 Persona | `VALUE` · `GROWTH` · `MOMENTUM` · `EVENT_DRIVEN` |
| 출력 수준 | 공시 1건에 대한 Persona별 긍정/부정·해석 문장 |
| 미개발 | 유명 투자자 철학 데이터 · 철학→정량지표 매핑 · 철학별 종목 스코어러 · 스타일별 모의 자동투자 |

### 이 로드맵의 목표

1. **P-A**: 유명 투자자 철학을 구조화된 데이터 모델로 표현하고 시드 데이터를 구축한다.
2. **P-B**: 철학별 정량 스코어러(Rule Engine)를 설계하여 종목·공시에 자동 적용한다.
3. **P-C**: 기존 AI Persona 해석을 철학 스코어러 결과와 결합하여 더 정확한 해석을 만든다.
4. **P-D**: 철학 스타일별 모의 포트폴리오를 자동으로 운용하고 성과를 비교한다.

### 제외

- 실주문 실행 (M10 졸업 + Risk 게이트 통과 후)
- 철학 데이터의 상업적 저작권 전문 수집 (요약·공개 자료 기반으로 제한)
- 커스텀 Persona 생성 UI (별도 기획 필요)

---

## 2. 유명 투자자 철학 구조화 (시드 데이터)

### 2-1. 철학 데이터 모델

```typescript
interface InvestorPhilosophy {
  philosophyId: string;             // 고유 식별자 (예: 'BUFFETT', 'LYNCH')
  investorName: string;             // 유명 투자자 이름
  styleTags: PersonaType[];         // VALUE | GROWTH | MOMENTUM | EVENT_DRIVEN 매핑
  corePrinciples: string[];         // 핵심 원칙 요약 (3~7개)
  quantMetrics: PhilosophyMetric[]; // 정량 지표 매핑
  sources: PhilosophySource[];      // 출처 (공개 자료 기반)
  applicableAssets: AssetClass[];   // KR_STOCK | US_STOCK | CRYPTO
  checklistItems: string[];         // 투자 전 체크리스트
}

interface PhilosophyMetric {
  metricKey: string;                // 예: 'ROE', 'DEBT_RATIO', 'PER'
  operator: 'GT' | 'LT' | 'EQ' | 'RANGE';
  threshold: number | [number, number];
  weight: number;                   // 0~1, 해당 철학 내 합산 = 1
  description: string;
}

interface PhilosophySource {
  type: 'BOOK' | 'SHAREHOLDER_LETTER' | 'INTERVIEW' | 'PUBLIC_STATEMENT';
  title: string;
  year: number;
  url?: string;                     // 공개 URL (주주서한 등)
}
```

### 2-2. 초기 시드 철학 4종

#### 1) 워렌 버핏 (Warren Buffett) — 가치·해자·장기

| 항목 | 내용 |
|---|---|
| 스타일 태그 | `VALUE`, `MOAT`, `LONG_TERM` |
| 핵심 원칙 | 이해할 수 있는 사업 · 경제적 해자 · 뛰어난 경영진 · 합리적 가격 · 장기 보유 |
| 주요 출처 | 버크셔 해서웨이 주주서한 (1977~현재, berkshirehathaway.com 공개) |

| 정량 지표 (`metricKey`) | 기준 | 가중치 |
|---|---|---|
| `ROE` (자기자본이익률) | ≥ 15% (3년 평균) | 0.20 |
| `DEBT_RATIO` (부채비율 총부채/자기자본) | ≤ 50% | 0.20 |
| `PER` (주가수익비율) | ≤ 20 | 0.15 |
| `PBR` (주가순자산비율) | ≤ 2.0 | 0.10 |
| `OPERATING_MARGIN` (영업이익률) | ≥ 10% | 0.15 |
| `FCF_POSITIVE` (잉여현금흐름 연속 양수) | 3년 연속 양수 | 0.10 |
| `MOAT_SCORE` (해자 점수, AI 해석→0~10 환산) | ≥ 7점 | 0.10 |

```
버핏 스코어 (0~100) =
  ROE점수×20 + 부채비율점수×20 + PER점수×15 + PBR점수×10
  + 영업이익률점수×15 + FCF점수×10 + 해자점수×10
```

---

#### 2) 피터 린치 (Peter Lynch) — 성장·생활주·GARP

| 항목 | 내용 |
|---|---|
| 스타일 태그 | `GROWTH`, `GARP` |
| 핵심 원칙 | 아는 것에 투자 · 성장주를 합리적 가격에 · PEG 비율 기준 · 소비자가 아는 제품 · 소형~중형주 선호 |
| 주요 출처 | 《전설로 떠나는 월가의 영웅》(One Up on Wall Street, 1989) 공개 강연·인터뷰 |

| 정량 지표 | 기준 | 가중치 |
|---|---|---|
| `PEG` (PER / EPS 성장률) | ≤ 1.0 (최적) / ≤ 1.5 (허용) | 0.30 |
| `EPS_GROWTH_YOY` (EPS 성장률, YoY) | ≥ 20% | 0.25 |
| `PER` | ≤ 30 | 0.15 |
| `REVENUE_GROWTH_YOY` (매출 성장률) | ≥ 15% | 0.15 |
| `MARKET_CAP_TIER` (중소형주 가중) | ≤ 1조 원 (코스피 기준) | 0.15 |

```
린치 스코어 (0~100) =
  PEG점수×30 + EPS성장률점수×25 + PER점수×15
  + 매출성장률점수×15 + 시가총액점수×15
```

---

#### 3) 조엘 그린블라트 (Joel Greenblatt) — 매직포뮬러

| 항목 | 내용 |
|---|---|
| 스타일 태그 | `VALUE`, `QUANTITATIVE` |
| 핵심 원칙 | 좋은 기업을 싸게 산다 · ROC 순위 + 이익수익률(EY) 순위 합산 · 시스템적 접근 |
| 주요 출처 | 《주식시장을 이기는 작은 책》(The Little Book That Still Beats the Market, 2010) 공개 강연 |

| 정량 지표 | 기준 | 가중치 |
|---|---|---|
| `ROC` (EBIT / 순운전자본 + 순고정자산) | 유니버스 내 순위 상위 30% | 0.50 |
| `EARNINGS_YIELD` (EBIT / 기업가치 EV) | 유니버스 내 순위 상위 30% | 0.50 |

```
그린블라트 스코어 = 유니버스 전체 종목 대비 (ROC 순위 + EY 순위) 합산 → 0~100 정규화
— 순위 기반이므로 유니버스 내 상대 위치가 핵심. 최소 30종목 이상 유니버스 필요
```

> **유의사항**: 매직포뮬러는 단일 종목 절대 점수보다 **유니버스 내 상대 순위**가 핵심이다. 관심 50종목 단독 적용 시 의미가 제한되므로, 초기에는 절대점수 방식과 병행하고 유니버스 확장 후 순위 방식으로 전환한다.

---

#### 4) 스탠리 드러켄밀러 (Stanley Druckenmiller) — 매크로·모멘텀·집중투자

| 항목 | 내용 |
|---|---|
| 스타일 태그 | `MACRO`, `MOMENTUM` |
| 핵심 원칙 | 거시경제 사이클 선행 파악 · 유동성/금리/통화 환경 판단 · 모멘텀 확인 후 집중 투자 · 틀리면 빠르게 손절 |
| 주요 출처 | Sohn Conference 강연 (공개 영상/스크립트) · Bloomberg·CNBC 공개 인터뷰 |

| 정량 지표 | 기준 | 가중치 |
|---|---|---|
| `PRICE_NEAR_52W_HIGH` (52주 고점 근접도) | 52주 고점 대비 -10% 이내 | 0.20 |
| `RELATIVE_STRENGTH_1M` (1개월 상대강도) | 업종 대비 상대수익률 > 0% | 0.20 |
| `VOLUME_TREND` (거래량 추세) | 20일 평균 대비 150%↑ | 0.15 |
| `MACRO_ENV_SCORE` (매크로 환경, AI 해석→0~10) | ≥ 6점 | 0.30 |
| `INSTITUTIONAL_BUYING` (기관 수급) | 외국인·기관 5일 순매수 | 0.15 |

```
드러켄밀러 스코어 (0~100) =
  신고가근접×20 + 상대강도×20 + 거래량추세×15
  + 매크로점수×30 + 기관수급×15
```

---

## 3. 철학→공시 이벤트 적합도 매핑

각 공시 이벤트 타입이 어느 철학 기준에서 더 주목할 만한지를 사전 정의한다. (높음/중간/낮음)

| 이벤트 타입 | 버핏 | 린치 | 그린블라트 | 드러켄밀러 |
|---|---|---|---|---|
| `SUPPLY_CONTRACT` | 중 (해자 확인) | 높 (성장 신호) | 중 (이익 개선 기대) | 높 (모멘텀 촉매) |
| `SHARE_BUYBACK` | 높 (주주 가치·FCF) | 중 | 낮 | 낮 |
| `SHARE_CANCELLATION` | 높 | 중 | 낮 | 낮 |
| `DIVIDEND_INCREASE` | 높 (FCF 강함) | 중 | 중 | 낮 |
| `PAID_IN_CAPITAL_INCREASE` | 낮 (희석) | 낮~중 (성장 자금) | 낮 | 낮 |
| `CB_ISSUANCE` | 낮 (부채 증가) | 낮 | 낮 | 낮 |
| `EARNINGS_SURPRISE` | 중 (실적 확인) | 높 (PEG 재평가) | 높 (ROC 개선) | 높 (모멘텀) |

---

## 4. 단계화: P-A → P-D

### P-A — 철학 데이터 모델 & 시드 구축 (M3 완성 직후)

**착수 조건**: M3 AI Analyst 기본 4 Task 완성 후  
**산출물**:
- `InvestorPhilosophy` DB 모델 + 마이그레이션
- 4종 철학 시드 데이터 (위 2-2 기준)
- `PhilosophyMetric`, `PhilosophySource` 연관 모델
- `GET /philosophies` 엔드포인트

**완료 기준 (DoD)**:
- [ ] `InvestorPhilosophy` 테이블에 4종 철학 시드 삽입 완료
- [ ] 각 철학의 `PhilosophyMetric` 항목 정의 및 저장 확인
- [ ] API 엔드포인트로 철학 목록·상세 조회 가능
- [ ] 기존 `PersonaAnalysis` 출력에 `philosophyId` 연결 필드 추가 (nullable)

---

### P-B — 철학별 Rule 스코어러 구현 (M5~M6 병행)

**착수 조건**: P-A 완료 + M4 시세 데이터(Engine3) + 재무지표 수집 파이프라인 확보  
**산출물**:
- `PhilosophyScoreService`: corpCode + philosophyId → 점수(0~100) + 항목별 점수 상세
- `PhilosophyScore` 테이블: 종목별 철학 점수 주 1회 배치 스냅샷
- `MagicFormulaRank` 배치: 그린블라트 유니버스 순위 계산

**완료 기준 (DoD)**:
- [ ] 4종 철학 스코어 함수 구현 및 단위 테스트 통과
- [ ] 관심 50종목 × 4종 철학 점수 배치 계산 완료
- [ ] `GET /stocks/:corpCode/philosophy-scores` 엔드포인트 구현
- [ ] 그린블라트 매직포뮬러 유니버스 순위 배치 동작 확인 (로그 증거)

---

### P-C — AI 해석 결합 (M6 이후)

**착수 조건**: P-B 완료 + M3 AI Analyst 안정화 (비용 게이트 동작 확인)  
**산출물**:
- `PersonaInterpretationTask` 개선: 추상 Persona 해석 + 철학 점수 컨텍스트 결합
- `PhilosophyCommentaryTask` (신규): 철학 점수 기반 AI 자연어 해설 생성 (L2)
- 공시 발생 시 "버핏 관점에서 이 공시는 어떤 의미인가?" 자동 생성

**완료 기준 (DoD)**:
- [ ] 공시 1건 처리 시 철학 점수 + AI 해석 결합 JSON 저장 확인
- [ ] `PhilosophyCommentaryTask` 비용이 `AIUsageLog`에 `taskType: PHILOSOPHY_COMMENTARY`로 정확히 기록됨
- [ ] 기존 `PersonaAnalysis`와 신규 결과 간 중복 저장 없음 (멱등성 확인)

---

### P-D — 철학별 모의 자동투자 (M12 이후)

**착수 조건**: P-C 완료 + M10 MVP 졸업 + M12 기본 모의투자 30일 안정화  
**산출물**:
- `PhilosophyPaperPortfolio`: 철학별 독립 모의 포트폴리오 (버핏/린치/그린블라트/드러켄밀러 각각)
- 철학별 자동 모의 매수 조건: 철학 점수 ≥ 임계값 + Buy Score ≥ 60 동시 충족
- 철학별 30일 이상 운용 성과 비교 대시보드

**완료 기준 (DoD)**:
- [ ] 4종 철학별 독립 모의 포트폴리오 30일 이상 운용
- [ ] 철학별 신호 적중률·누적 수익률·AI 비용 비교 측정 가능
- [ ] 철학별 자동 모의 매수는 Engine5 Risk 게이트 통과 후에만 실행됨 (감사 로그 확인)

**실투자 착수 조건 (P-D 졸업 게이트, 모두 충족 시)**:
- [ ] 각 철학 포트폴리오 90일 모의투자 누적 수익 > 0%
- [ ] M10 MVP 졸업 게이트 통과
- [ ] Risk Engine 철학별 파라미터 코드 검증 완료
- [ ] AI 비용/모의순익 ≤ 20% (철학별 독립 측정)

---

## 5. 재무지표 수집 파이프라인

P-B 스코어러에 필요한 재무지표는 Engine1 파싱·Engine3 시세 파이프라인에서 공급받는다.

```
Engine1 공시 파싱 (Phase 2~3)
  → 분기 실적 공시 파싱 (EPS, 매출, EBIT, FCF, 자산·부채)
  → DisclosureEvent.metricsJson에 재무지표 포함

Engine3 시세 수집 (Phase 5 / M4)
  → KRX: 시가총액, 52주 고가, 거래량
  → 기관 수급: KRX 투자자별 매매 데이터
  → StockDailyPrice, TechnicalIndicator

P-B PhilosophyScoreService
  → DisclosureEvent.metricsJson + StockDailyPrice + TechnicalIndicator 결합
  → PhilosophyMetric 기준과 대조 → 철학 점수 계산 → PhilosophyScore 저장
```

| 지표 | 수집 경로 | 가용 시점 |
|---|---|---|
| ROE, 부채비율, PER, PBR, 영업이익률 | KRX 재무정보 + 공시 재무제표 파싱 | M4 이후 |
| EPS, EPS 성장률, 매출 성장률 | 분기 실적 공시 파싱 (Phase 3) | M2 이후 |
| PEG (EPS 성장률 기반) | EPS 2개년 차이 계산 | M4 이후 |
| EBIT, EV, ROC, EY | 재무제표 파싱 + 시가총액 결합 | M4 이후 |
| 52주 고가, 상대강도, 거래량 추세 | Engine3 StockDailyPrice + TechnicalIndicator | M4 이후 |
| 기관 수급 | KRX 투자자별 매매 | M4 이후 |
| 해자 점수, 매크로 점수 | Engine2 AI 해석 (L2, P-C 이후) | M3 + P-C |

---

## 6. Persona 철학 엔진 아키텍처 위치

Engine2 내부에 `philosophy/` 모듈을 신설한다.

```
engine2-ai-analyst/
  ├── tasks/
  │   ├── summary.task.ts                 (기존)
  │   ├── event-classification.task.ts    (기존)
  │   ├── persona-interpretation.task.ts  (기존 → P-C에서 확장)
  │   ├── position-thesis.task.ts         (기존)
  │   └── philosophy-commentary.task.ts   (P-C 신규: AI 철학 해설)
  ├── philosophy/
  │   ├── philosophy.seed.ts              (P-A: 4종 시드 데이터)
  │   ├── philosophy.service.ts           (P-A: 철학 CRUD + 메타데이터)
  │   ├── philosophy-scorer.service.ts    (P-B: Rule 기반 점수화)
  │   └── magic-formula-rank.service.ts   (P-B: 그린블라트 순위 배치)
  ├── cost-gate/
  │   └── ai-cost-gate.service.ts         (기존 + PHILOSOPHY_COMMENTARY 레벨 추가)
  └── ai-analyst.module.ts
```

**AI 금지 원칙 유지**: `PhilosophyScoreService` (P-B)는 Rule 기반 계산만 수행하며 AI를 호출하지 않는다. AI는 `PhilosophyCommentaryTask` (P-C)에서 해설 생성에만 사용한다. 철학 점수는 Engine5 Risk 게이트의 입력이 아니라 참고 지표이며, Risk Engine은 독립적으로 동작한다.

---

## 7. 기존 로드맵과의 연결

- [01-execution-roadmap.md](./01-execution-roadmap.md): M3 상세에 P-A, M5~M6에 P-B, M12 이후에 P-D 편입 표기
- [00-vision-and-principles.md](./00-vision-and-principles.md): §5 Phase 로드맵에 Persona 철학 엔진 확장 축 추가
- [cc-engine-architecture.md](./cc-engine-architecture.md): Engine2 §4-1 모듈 구조에 `philosophy/` 위치 반영, AI 배치 테이블에 `PhilosophyCommentaryTask` 추가
- [cc-multi-asset-expansion.md](./cc-multi-asset-expansion.md): 다자산 확장 시 동일 철학 엔진 재사용 (프롬프트 자산 타입 명시로 미국·코인 공시에도 적용)
