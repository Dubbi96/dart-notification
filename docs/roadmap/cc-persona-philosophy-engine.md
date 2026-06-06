> 상위 문서: [비전](./00-vision-and-principles.md) · [실행 로드맵](./01-execution-roadmap.md) · 작성: Agent Team

# 횡단 설계: Persona 철학 엔진 로드맵

> 작성일: 2026-06-06 · 상태: 설계 방향 초안

---

## 1. 목적 & 범위

### 현행 상태

Engine2에 4개 Persona(GROWTH·VALUE·MOMENTUM·EVENT_DRIVEN)가 `PersonaInterpretationTask`로 구현되어 있다. 현재는 공시별로 Persona 해석(정성 의견)만 생성한다.

### 목표

유명 투자자의 **철학·원칙을 구조화 데이터로 축적**하고, 각 철학에 맞는 **정량 스코어러(Rule)**와 **AI 해석 매핑**을 추가하여 **스타일별 모의 자동투자** 기능으로 확장한다.

### 포함

- 유명 투자자 철학 데이터 모델 설계
- 철학 → 정량 지표 매핑 및 스코어러(Rule)
- AI 해석과의 결합 방식
- Persona별 모의 자동투자 전략
- 단계별 착수 기준

### 제외

- 실제 자동매매 (M12 제한적 자동매매 이후)
- 법적·세무 투자 조언 (시스템은 참고정보만 제공)
- 투자자 저작권 보호 콘텐츠 복제 (요약·참조만 허용)

---

## 2. 유명 투자자 철학 구조화

### 2-1. 초기 대상 투자 스타일 (5종)

| 스타일 ID | 대표 투자자 | 핵심 철학 요약 |
|-----------|-----------|-------------|
| `BUFFETT_VALUE` | 워런 버핏 | 가치·해자·장기보유. ROE 15%+, 부채비율 낮음, 독점적 브랜드/기술 |
| `LYNCH_GROWTH_LIFE` | 피터 린치 | 생활 속 성장주 발굴. PEG < 1, 일상 경험으로 검증 가능한 제품 |
| `GREENBLATT_MAGIC` | 조엘 그린블랫 | 마법공식. 수익률(EBIT/EV) 상위 + 자본수익률(EBIT/IC) 상위 조합 |
| `DRUCKENMILLER_MACRO` | 스탠리 드러켄밀러 | 매크로 주도 포지션. 금리·환율·유동성 방향에 따른 집중 베팅 |
| `SIMONS_QUANT` | 짐 사이먼스 | 통계적 패턴·수치 기반. 감이 아닌 데이터·백테스트로만 판단 |

### 2-2. 데이터 수집 출처 (저작권 안전 범위)

| 유형 | 예시 출처 | 허용 방식 |
|------|---------|---------|
| 주주서한·연간보고서 | 버크셔 해서웨이 Annual Letter (공개) | 원칙·기준 요약만, 원문 복사 금지 |
| 공개 인터뷰·강연 | 버핏·린치 CNBC, 유튜브 공개 강연 | 핵심 원칙 인용·구조화 |
| 도서 (출판) | 피터 린치 《One Up on Wall Street》 | 원칙 요약만, 인용은 저작권법 허용 범위 |
| 학술 논문 | 그린블랫 마법공식 논문 (공개) | 공식·수치 그대로 사용 가능 |
| SEC 13F 포지션 | EDGAR 13F 공개 파일링 | 포트폴리오 구성 참조 가능 |

---

## 3. 철학 데이터 모델

### 3-1. InvestorPhilosophy 모델 (신규, Phase P-A)

```typescript
interface InvestorPhilosophy {
  id: string;                   // CUID
  styleId: string;              // 'BUFFETT_VALUE' 등
  styleName: string;            // '버핏 가치투자'
  description: string;          // 철학 1~2문장 요약
  coreMetrics: PhilosophyMetric[];  // 정량 지표 기준
  checklistItems: string[];     // 정성 체크리스트
  typicalHoldDays: number;      // 평균 보유 기간 (일)
  assetFocus: AssetClass[];     // KR_STOCK | US_STOCK | CRYPTO
  sources: PhilosophySource[];  // 출처 목록
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface PhilosophyMetric {
  metricName: string;   // 'roe' | 'per' | 'peg' | 'debtRatio' | 'ebitEv' | ...
  operator: 'gte' | 'lte' | 'between';
  threshold: number | [number, number];
  weight: number;       // 0~1, 이 지표의 스코어 기여 가중치
  description: string;  // 지표 설명
}

interface PhilosophySource {
  type: 'BOOK' | 'LETTER' | 'SPEECH' | 'PAPER' | 'FILING';
  title: string;
  year?: number;
  url?: string;
}
```

### 3-2. 스타일별 핵심 지표 매핑 초안

**BUFFETT_VALUE**
| 지표 | 조건 | 가중치 |
|------|------|-------|
| ROE (최근 3년 평균) | ≥ 15% | 0.25 |
| 부채비율 (총부채/자본) | ≤ 0.5 | 0.20 |
| PER | ≤ 25 (업종 평균 이하) | 0.15 |
| 영업이익 성장률 (5년) | ≥ 8%/년 | 0.20 |
| 해자 여부 | 체크리스트: 브랜드·특허·전환비용·네트워크효과 | 0.20 |

**LYNCH_GROWTH_LIFE**
| 지표 | 조건 | 가중치 |
|------|------|-------|
| PEG (PER / EPS 성장률) | ≤ 1.0 | 0.35 |
| 매출 성장률 (3년 CAGR) | ≥ 15% | 0.25 |
| 영업이익률 추이 | 개선 중 | 0.20 |
| 생활 밀착도 | 체크리스트: 일반 소비자가 이용하는 제품·서비스 | 0.20 |

**GREENBLATT_MAGIC**
| 지표 | 조건 | 가중치 |
|------|------|-------|
| EBIT/EV (수익수익률) | 상위 25% | 0.50 |
| EBIT/IC (자본수익률 ROCE) | 상위 25% | 0.50 |

> **구현 주의**: 마법공식은 종목 단독 점수가 아닌 **전체 유니버스 내 상대 순위**가 기준이다. 적어도 관심 유니버스 50종목 이상 대상으로 계산해야 의미 있다.

**DRUCKENMILLER_MACRO**
| 지표 | 조건 | 가중치 |
|------|------|-------|
| 기준금리 방향 | 인하 사이클 → 성장주 유리 | 0.30 |
| 원달러 환율 방향 | 수출주·달러 강세 수혜 | 0.25 |
| 업종 상대강도 | 최근 3개월 KOSPI 대비 초과수익 | 0.25 |
| 포지션 집중도 | 확신 종목 10% 이상 허용 (기존 5% 상한 우선적용) | 0.20 |

**SIMONS_QUANT**
| 지표 | 조건 | 가중치 |
|------|------|-------|
| Buy Score (Engine3) | ≥ 75 | 0.30 |
| Event Study 통계 유의성 | p < 0.05 | 0.30 |
| 백테스트 Sharpe | ≥ 1.0 (동일 이벤트·페르소나 구간) | 0.25 |
| 모의투자 승률 | ≥ 55% (최근 30건) | 0.15 |

---

## 4. 단계별 구현 계획

### P-A — 철학 데이터 모델·시드 (M3 확장, 예정)

**목표**: 투자 철학 5종을 구조화 데이터로 저장하고 Engine2 Persona와 연결한다.

**작업**:
1. `InvestorPhilosophy` 모델 DB 추가 (Prisma 마이그레이션)
2. 5종 철학 시드 데이터 작성 (`prisma/seed/philosophy-seed.ts`)
3. 기존 `PersonaInterpretationTask`에서 4종 → 5종 확장 매핑
4. Engine2 AI 프롬프트에 `philosophyId` 전달, 해당 원칙에 근거한 해석 요청

**진입 게이트**: M3 (AI Analyst Engine) 완료 후 착수

### P-B — 철학별 스코어러 (Rule 기반, M6 확장, 예정)

**목표**: 각 철학의 정량 지표로 `PhilosophyScore` (0~100)를 계산한다.

**작업**:
1. `PhilosophyScorer` 서비스 구현 (Engine3 내부 또는 Engine4 보조)
2. 스타일별 지표(ROE·PER·PEG·마법공식 등) DB 연동
3. `TradingSignal`에 `philosophyScores: Record<styleId, number>` 필드 추가
4. 시그널 상세 화면에 스타일별 적합도 표시

**데이터 필요**: 재무 데이터(ROE·부채비율·EBIT 등) — 초기 후보:
- KRX 데이터마켓플레이스 (상장기업 재무제표 공개)
- DART OpenAPI `/fnlttSinglAcnt` (단일기업 재무현황)

**진입 게이트**: M6 (매수 Signal Engine) 완료 후 착수

### P-C — AI 해석 결합 (M3 확장 연속, 예정)

**목표**: 공시 분석에서 AI가 해당 투자 스타일의 관점으로 해석문을 생성한다.

**작업**:
1. `PersonaInterpretationTask` 프롬프트에 철학 원칙·체크리스트 주입
2. AI 출력에 `philosophyFit` 필드 추가 (`HIGH`·`MID`·`LOW`·`MISMATCH`)
3. 모바일 UI: 공시 상세에서 "버핏 관점 요약" / "린치 관점 요약" 탭 표시

**진입 게이트**: P-A 완료 + M3 완료 후 착수

### P-D — 스타일별 모의 자동투자 (M10 이후, 예정)

**목표**: 사용자가 투자 스타일을 선택하면 해당 철학의 Rule로 모의 자동투자를 실행한다.

**작업**:
1. `PaperPortfolio`에 `activePhilosophyId` 필드 추가
2. 모의투자 신호 생성 시 `PhilosophyScore`와 `BuyScore` 결합 (가중 합산)
3. Persona별 백테스트 성과 비교 레포트 생성
4. 모바일 UI: 스타일 선택 → 모의 포트폴리오 자동 관리 화면

**진입 게이트**: M10 (모의투자) 완료 후 착수

---

## 5. 재무 데이터 보강 계획

현재 Engine3는 **시세·기술지표** 중심이다. Persona 스코어러(P-B)는 **재무 지표(ROE·부채비율·PER·PEG·EBIT)**가 필요하다.

### 5-1. 재무 데이터 소스 (국내)

| 항목 | 소스 | 갱신 주기 |
|------|------|---------|
| 분기/연간 손익계산서·재무상태표 | DART `/fnlttSinglAcnt` | 분기 결산 후 |
| 시가총액·발행주식수 | KRX 데이터마켓플레이스 | 일봉 |
| EPS·PER·PBR·ROE | KRX 또는 FnGuide (유료) | 일봉 |
| 컨센서스 EPS 예측 | 에프엔가이드·유안타 API (유료) | 주간 |

### 5-2. 신규 Prisma 모델 (P-B 착수 시 추가 예정)

```
CompanyFinancials    — 분기별 재무제표 (ROE, 부채비율, 매출, 영업이익)
CompanyValuation     — 일별 PER, PBR, EV/EBIT, PEG (KRX 기준)
```

> **스키마 변경 금지** (현재 단계). 모델 설계는 이 문서에 기록하고 P-B 착수 시 별도 마이그레이션 이슈로 분리한다.

---

## 6. Persona별 백테스트 비교

P-D 이후 각 Persona의 성과를 비교하는 **철학별 백테스트 레포트**를 생성한다.

| 지표 | 버핏 | 린치 | 그린블랫 | 드러켄밀러 | 사이먼스 |
|------|------|------|--------|---------|-------|
| 연환산 수익률 | — | — | — | — | — |
| MDD | — | — | — | — | — |
| Sharpe | — | — | — | — | — |
| 승률 | — | — | — | — | — |

> 실제 수치는 P-D 단계 백테스트 실행 후 채운다.

---

## 7. AI 정책

| 단계 | AI 역할 | 등급 |
|------|---------|------|
| P-A 철학 시드 | 철학 원칙 문서 초안 생성 (1회성) | L2 보조 |
| P-B 스코어러 | **AI 개입 금지** — 순수 Rule 기반 정량 계산 | L0 |
| P-C AI 해석 | Persona 관점 해석문 생성 | L2 필수 |
| P-D 모의 자동투자 신호 | **AI 금지** — Rule 기반 신호 결합만 | L0 |
| P-D 실매수 결정 | **AI 절대 금지** — Risk Engine 하드룰만 | L0 |

---

## 8. 관련 문서 링크

- [5엔진 아키텍처](./cc-engine-architecture.md) — Engine2 PersonaInterpretationTask 위치
- [실행 로드맵](./01-execution-roadmap.md) — M3 확장(P-A~P-C)·M10 이후(P-D) 마일스톤
- [비전](./00-vision-and-principles.md) — AI 금지영역 원칙
- [다자산 확장](./cc-multi-asset-expansion.md) — 미국·코인에도 동일 Persona 적용
- [AI 비용 거버넌스](./phase-11-ai-cost-governance.md) — L0~L3 게이트 구조
