> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# AI·프롬프트 파트 업무 정의서

> 작성일: 2026-06-02 · 상태: 기준선 확정

---

## 1. 역할 정의 & 책임 범위

### 이 파트가 소유하는 것

AI·프롬프트 파트는 **AI Analyst Engine 전체의 프롬프트·입출력 계약·비용 거버넌스**를 단독 소유한다.

- **4개 AI Task 프롬프트 설계 및 버전 관리** (Disclosure Summary / Event Classification / Persona Interpretation / Position Thesis)
- **최소 입력 원칙** — AI에 공시 전문을 통째로 넣지 않는다. Phase 2·3 파싱 산출물에서 핵심 수치와 텍스트(500자 이내)만 추출해 전달하는 `buildMinimalInput()` 계약 정의
- **JSON 출력 스키마 설계·강제** — 각 Task의 출력 스키마 확정, JSON mode 강제 적용, 필드 화이트리스트 검증 규칙
- **멱등 캐시 정책** — `rcpNo + task` 복합 고유키 기반 중복 호출 방지 계약
- **비용 게이트 L0~L3 분기 정책** — 어떤 공시가 어느 레벨로 라우팅되는지 판단 로직 설계 (AiRouterService 계약)
- **AIUsageLog 정책** — 저장 필드·지표 공식·예산 가드레일·예외 허용 조건 정의
- **AI 금지영역 보장** — 프롬프트·아키텍처·출력 파싱 레이어 모두에서 주문/룰/한도/수량 결정이 AI에 위임되지 않도록 설계 및 검증
- **프롬프트 eval(출력 품질 평가)** — Task별 정답 레이블 샘플 작성, 정확도·False Positive/Negative 측정 기준 정의

### 다른 파트와의 경계

| 경계 | 내용 |
|------|------|
| AI ↔ BE | AI 파트는 프롬프트·스키마·정책 설계를 제공한다. NestJS `AiAnalystModule`·`AiCostModule` 코드 구현은 BE 파트 소유. AI 파트는 구현 전 설계 문서와 계약을 확정하고, 구현 후 출력 품질을 검증한다. |
| AI ↔ DQ | Event Classification 보정 결과(AI polarity)가 Buy Score 컴포넌트에 반영되는 방식은 DQ 파트가 결정한다. AI 파트는 폴라리티·Persona 점수 매핑 계약만 제공한다. |
| AI ↔ 기획(화면/시나리오) | Persona Interpretation 출력(view/reason/actionHint)이 화면에서 어떻게 노출되는지 UX 설계는 화면·시나리오 파트 소유. AI 파트는 출력 텍스트 길이 제한(reason 50자 이내 등)과 언어(한국어) 규약을 확정한다. |
| AI ↔ QA | QA 파트는 AI 금지영역 침범 여부를 감사 로그로 검증한다. AI 파트는 감사 체크리스트와 프롬프트 내 금지 문구를 제공한다. |
| AI ↔ 정책 | 비투자자문 고지 문구는 정책 파트 소유. AI 파트는 프롬프트 시스템 프롬프트에 "투자 가설 제안, 매수·매도 지시 아님" 문구를 포함시킨다. |

---

## 2. 마일스톤별 업무 (M0~M12)

### M0 — 기준선 & 수집 안정화 · 해당 없음(·)

해당 없음(다른 파트 산출물 대기). AI 파트 착수 없음.

확인할 점: M0에서 확정되는 **초기 공시 5종 이벤트 enum**(SUPPLY_CONTRACT, SHARE_BUYBACK, DIVIDEND_CHANGE, PAID_IN_CAPITAL_INCREASE, CB_ISSUANCE/BW_ISSUANCE)이 Task 2(Event Classification) 출력 스키마의 `confirmedEventType` 허용 값과 정합해야 한다. M0 완료 시 이 목록을 수령해 스키마 초안에 반영한다.

---

### M1 — 공시 원문 파싱 · 해당 없음(·)

해당 없음(다른 파트 산출물 대기).

확인할 점: M1 완료 후 `DisclosureDocument.parsedJson`이 포함하는 **표·key-value 구조**를 수령해, `buildMinimalInput()`이 어떤 필드를 추출할지 Task별 입력 명세를 확정한다. 특히 `rawSummaryText` 500자 제한이 파싱 산출물 품질에 의존하므로, 파싱 실패율이 높은 공시 유형은 AI 파트가 대응 입력 fallback 정책을 미리 정의해야 한다.

---

### M2 — 이벤트·수치 추출 · 협업(C)

**[C] 협업 — AI를 이용한 이벤트 타입 보정 설계**

- [ ] Task 2(Event Classification AI) 프롬프트 초안 작성 — Rule 기반 `ruleBasedEventType`을 참고값으로 받아 `confirmedEventType` / `correctedEventType` / `subType` 을 출력하는 프롬프트 구조 확정
- [ ] 입력 스키마 초안 확정: `reportName`, `ruleBasedEventType`, 이벤트별 핵심 수치(dilutionRate / salesRatio 등 Phase 3 산출물) 항목 목록 정의
- [ ] 출력 JSON 스키마 확정: `confirmedEventType`, `correctedEventType`, `subType`, `polarity`, `polarityReason`, `confidence`, `mixedSignals`
- [ ] 보정 불일치율 추적 기준 정의: Rule 분류와 AI 보정 결과가 다른 경우를 로그로 남기는 정책 수립
- [ ] 이벤트 분류 정확도 eval 기준 수립: 100건 수동 정답 레이블 샘플 구조 및 F1 측정 방식 정의

M2 진입 게이트(5종 이벤트 분류 정확도 ≥ 90%)와 연동해, AI 보정을 적용한 후의 분류 정확도가 Rule 단독 대비 개선되는지 확인한다.

---

### M3 — AI Analyst + 비용 계측 토대 · 주담당(R)

**[R] 주담당 — AI Analyst Engine 설계 전체 및 비용 계측 토대**

#### 프롬프트 설계 & 버전 관리
- [ ] `backend/src/ai-analyst/prompts/versions.ts` 버전 상수 파일 구조 정의 (`SUMMARY: 'summary-v1.0'` 등)
- [ ] Task 1 Disclosure Summary 프롬프트 확정 — 시스템 프롬프트(역할·어조·금지사항) + 사용자 프롬프트 템플릿 분리, `summary` 100자 이내 / `keyPoints` 최대 3개 / `riskFactors` 최대 3개 제한 명시
- [ ] Task 2 Event Classification 프롬프트 확정 — Rule 결과 보정 구조, `confidence` 0.5 미만 표기 기준
- [ ] Task 3 Persona Interpretation 프롬프트 확정 — 4개 Persona(VALUE/GROWTH/MOMENTUM/EVENT_DRIVEN) 순회 구조, `reason` 50자 이내 한국어, `actionHint` 정보 제공 목적 명시
- [ ] Task 4 Position Thesis 프롬프트 확정 — `initialThesis` 3~5개 / `invalidConditions` 3~5개 / `watchConditions` 구조. 시스템 프롬프트에 금지 문구 필수 포함: "목표가, 손절 수치, 주문 수량, 포트폴리오 비중은 절대 제안하지 마십시오."
- [ ] 버전 관리 정책 확정: minor 변경(문장 수정) vs. major 변경(스키마 변경) 기준, major 변경 시 기존 DONE 레코드 무효화 범위 정의

#### 입출력 스키마 & 최소 입력 원칙
- [ ] Task별 `buildMinimalInput()` 계약 문서화 — Phase 2·3 어떤 필드를 어떻게 조합하는지, 토큰 상한(Task 1: ~500, Task 3: ~800, Task 4: ~1000토큰) 명시
- [ ] 토큰 초과 시 자동 축소 규칙 정의: `rawSummaryText` 500자 → 200자 자동 축소 조건
- [ ] 출력 JSON 스키마 4개 확정 및 Zod 등 스키마 검증 라이브러리 적용 방식 정의
- [ ] 필드 화이트리스트 검증 규칙: AI가 AI 금지영역 필드(목표가, 손절선, 주문수량 등)를 출력할 경우 해당 필드를 파싱 단계에서 제거하는 정책 확정

#### 멱등 캐시 & 재시도 정책
- [ ] `rcpNo + task` 복합 고유키 기반 멱등성 보장 계약 확정 — `upsert` 기반 선점 로직, `DONE` 상태 스킵 조건
- [ ] 재시도 전략 확정: 최대 3회, exponential backoff(1s/2s/4s), `FAILED_PERMANENT` 전환 기준
- [ ] JSON 파싱 실패 시 1회 재호출 후 `FAILED` 처리 정책

#### 비용 게이트 L0~L2 정책 (M3 범위)
- [ ] L0 제외 조건 5종 확정: 관심 외 기업 / 정기공시 ROUTINE_REPORT / 거래정지·관리·투자위험 / 30일 평균 거래대금 < 5억 원 / 기분석 완료
- [ ] L1 입력·출력 스키마 확정: 500토큰 이내 입력, `isTradingRelevant` / `roughSentiment` / `suggestedLevel` 출력
- [ ] L1 → L2 상향 조건, L1 → L3 직접 상향 조건 정의
- [ ] L2 수행 AI Task 매핑: Task 1(Summary) + Task 2(Event Classification) + Task 3(Persona Interpretation)
- [ ] M3 단계 임시 호출 필터 정책: Phase 11 완성 전까지 관심 외 기업·비대상 유형 공시를 하드코딩으로 L0 처리

#### AIUsageLog 기본 정책
- [ ] `AIUsageLog` 모델 필드 정의: taskType / level / model / rcpNo / corpCode / inputTokens / outputTokens / costUsd / costKrw / exchangeRate / latencyMs / isSuccess / calledAt
- [ ] `AiCostService.log()` 호출 의무화 계약: AI 호출이 있는 모든 지점에서 반드시 호출해야 하는 규칙 명시
- [ ] 일일 최대 호출 건수 하드 상한 정책: 초기 50건/일, 초과 시 다음 날로 지연

#### 완료 기준 확인 항목 (M3 진입 게이트)
- [ ] AI 분석 10건 이상 JSON 정상 출력 및 스키마 준수 확인
- [ ] JSON 파싱 실패 fallback 동작 확인 (앱 중단 없음)
- [ ] 공시 1건당 평균 비용 < $0.005 측정
- [ ] L0(AI 미사용) 비율 ≥ 70% 유지 여부 측정 기준 정의

---

### M4 — 시세·시장 데이터 · 해당 없음(·)

해당 없음(다른 파트 산출물 대기).

확인할 점: M4에서 확정되는 `TechnicalIndicator`의 RSI·MACD·거래량 증가율 등 수치가 나중에 Task 3(Persona Interpretation) 입력의 선택적 보완 정보로 활용 가능한지 검토한다. 단, M3 단계에서는 시세 데이터 없이도 Task 3가 동작해야 하므로 해당 필드는 optional로 설계한다.

---

### M5 — Event Study · 해당 없음(·)

해당 없음(다른 파트 산출물 대기).

확인할 점: M5 완료 후 `EventStudyResult`의 이벤트별 통계(D+1/3/5 평균수익·상승확률)가 Task 4(Position Thesis) 입력에 보완적으로 추가 가능한지 검토하고, 입력 스키마에 `historicalD5Avg` 등 선택 필드를 준비해둔다.

---

### M6 — 매수 Signal Engine · 협업(C)

**[C] 협업 — Persona 해석이 Buy Score에 반영되는 방식 계약 제공**

- [ ] Task 3 Persona 해석 결과(`view`: POSITIVE/NEGATIVE/NEUTRAL/WATCH)를 Buy Score 컴포넌트 ③(Persona 적합도)에 매핑하는 수치 계약 문서화 — DQ 파트와 협의 후 확정 (예: POSITIVE=+15, WATCH=+5, NEUTRAL=0, NEGATIVE=-10)
- [ ] Task 2 polarity 결과(`POSITIVE`/`NEGATIVE`/`MIXED`)와 Buy Score 방향 일치 여부 검증 기준 정의
- [ ] M6 회귀 체크포인트(↩︎) 대응: AI polarity와 최종 Buy Score 방향이 일치하는지 확인하는 eval 케이스 제공
- [ ] Task 3 출력의 `actionHint`가 진입 조건(`entryCondition`) 리스트에 포함되는 방식 합의 (FE·시나리오 파트와 협의)

---

### M7 — Position Thesis · 협업(C)

**[C] 협업 — Position Thesis AI(Task 4) 출력이 PositionThesis 모델에 저장되는 방식**

- [ ] Task 4 출력 JSON(`thesisSummary` / `initialThesis[]` / `invalidConditions[]` / `watchConditions[]` / `applicablePersonas[]` / `confidence`)이 `PositionThesis` Prisma 모델 필드에 매핑되는 방식 BE 파트와 계약
- [ ] `invalidConditions` 항목이 "기계 평가 가능한 형태"임을 보장하는 프롬프트 제약 추가: 추상 문장(예: "시장 상황이 나빠지면") 금지, 공시 이벤트·수치·지표 기반 조건만 허용하는 프롬프트 가이드라인 확정
- [ ] AI 금지 영역 재확인: Task 4가 손절가·익절가·주문수량 등을 출력하지 않음을 단위 테스트로 검증하는 eval 케이스 제공
- [ ] 정정공시(isAmendment=true) 발생 시 원공시 Thesis의 `invalidConditions` 평가 방식 정의

---

### M8 — Portfolio & Exit Engine · 협업(C)

**[C] 협업 — 보유 논리 유지 여부 설명 AI(EXIT_SIGNAL_ASSIST) 정책**

- [ ] EXIT_SIGNAL_ASSIST Task 설계: 보유 종목 악재 공시 발생 시 `invalidConditions` 훼손 여부를 AI가 서술하는 프롬프트 구조 정의 — 출력 형식: `{ "thesisIntact": boolean, "violatedConditions": string[], "reason": string, "suggestedAction": "HOLD" | "WATCH" | "REDUCE" | "EXIT" }`
- [ ] AI 금지 영역 재확인: `suggestedAction`은 정보 제공용이며, 최종 Exit Score·주문 수량은 Rule Engine이 결정함을 시스템 프롬프트에 명시
- [ ] 예산 가드레일 예외 조건 확정: 월 예산 초과로 L3 비활성화 시에도 보유 종목 EXIT_SIGNAL_ASSIST는 허용하는 정책 문서화
- [ ] 하루 3회 점검(09:00/13:00/16:30) 중 신규 정정공시 감지 시 EXIT_SIGNAL_ASSIST 자동 트리거 조건 정의
- [ ] M8 회귀 체크포인트(↩︎) 대응: `invalidConditions` 기계 평가와 AI 해석의 결과가 충돌하는 경우 우선순위 정책 제공 (Rule 기반 Exit Score 우선, AI는 근거 보조)

---

### M9 — 백테스트 · 해당 없음(·)

해당 없음(다른 파트 산출물 대기).

확인할 점: 백테스트 결과(`BacktestRun`)에서 AI 분석을 사용한 경우와 사용하지 않은 경우의 성과를 비교하는 Split 분석을 DQ·QA 파트가 수행한다. AI 파트는 eval 정답 레이블(Task별 예측 정확도)이 백테스트 성과 지표와 연관되는지 사후 검토를 진행한다.

---

### M10 — 모의투자 + 비용 거버넌스 완성 · 협업(C)

**[C] 협업 — L0~L3 게이트 완성 및 실비용 측정**

- [ ] L3 게이트 정책 완성: Position Thesis AI(Task 4) / 정정공시 비교 AI / EXIT_SIGNAL_ASSIST를 L3로 확정하는 라우팅 정책 문서 업데이트
- [ ] 비용 지표 공식 최종 확정: Cost Per Disclosure / Cost Per Signal / AI Cost / Net Profit 공식이 `AIUsageLog` 쿼리로 정확히 계산되는지 검증 참여
- [ ] outcomeType 레이블링 정책 확정: 모의투자 결과를 바탕으로 AI 호출 건의 `HIT` / `FALSE_POSITIVE` / `FALSE_NEGATIVE` 레이블 기준 및 수동/자동 기입 방식 정의
- [ ] 자체 서빙 전환 검토 기준 확인: L1 태스크를 경량 오픈소스 모델로 전환 가능한지 모의투자 데이터로 F1 ≥ 0.75 품질 검증
- [ ] MVP 졸업 게이트 중 AI 관련 항목 확인: AI비용/모의순익 ≤ 20%(실측), AI 금지영역 침범 0(감사 로그 확인)
- [ ] 월간 AI 비용 리포트 형식 확정 및 대시보드 집계 쿼리 검토

---

### M11 — 반자동매매 · 협업(C)

**[C] 협업 — AI 금지영역 최종 확인 및 사용자 리포트 AI**

- [ ] 반자동매매 주문 카드 UI에서 AI 분석 내용(Summary / Persona 해석 / Thesis 근거)이 표시되는 방식 확인 — "AI 분석 참고 정보" 레이블 부착 여부 화면 파트와 협의
- [ ] 주문 카드에서 AI가 "승인" 버튼을 대신하거나 자동으로 클릭하는 구조가 절대 없음을 아키텍처 레벨에서 확인하는 검토 항목 제공
- [ ] 사용자 리포트 AI Task 추가 검토: 주문 후 "이 매수의 논리 요약" 리포트 생성 프롬프트 설계 여부 결정
- [ ] M11 진입 게이트 AI 관련 항목 확인: "AI는 주문 승인 불가 확인" 감사 로그 점검 참여

---

### M12 — 제한적 자동매매 · 협업(C)

**[C] 협업 — AI 금지영역 자동매매 환경 재확인**

- [ ] 자동매매 환경에서 AI 출력이 Risk Engine의 하드 룰(1회 1~3% / 단일 5~10% / 1일 -2% / 연속손실 자동중단)을 우회하는 경로가 없음을 프롬프트·아키텍처 관점에서 검토하는 체크리스트 제공
- [ ] 이벤트 화이트리스트(6종)에 AI 분석이 필수 선행되는 조건과 L2 이상 완료 여부 게이트 정의
- [ ] AI비용/순익 ≤ 10% 목표 달성 여부 확인 및 미달 시 L3 호출 범위 축소 권고 기준 제공

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### AI 파트가 받는 것

| 출처 파트 | 받는 산출물 | 수령 시점 |
|-----------|------------|----------|
| BE | `DisclosureDocument.parsedJson` 구조 스펙 | M1 완료 후 |
| BE(DQ 협조) | `DisclosureEvent.eventType` enum 확정 목록 | M2 완료 후 |
| DQ | Buy Score 컴포넌트별 입력 계약(Persona 점수 매핑 협의) | M6 착수 전 |
| DQ | `EventStudyResult` 통계 필드 구조 | M5 완료 후 (Task 4 입력 보완용) |
| 정책 | 비투자자문 고지 문구(프롬프트에 포함 예정) | M3 착수 전 |
| QA | AI 금지영역 감사 체크리스트 피드백 | M3 이후 매 마일스톤 |

### AI 파트가 넘기는 것

| 수신 파트 | 넘기는 산출물 | 핸드오프 시점 |
|-----------|-------------|-------------|
| BE | Task 1~4 프롬프트 파일 초안(시스템 프롬프트 + 사용자 프롬프트 템플릿) | M3 착수 전 |
| BE | `buildMinimalInput()` 계약 문서(Task별 입력 필드·토큰 상한) | M3 착수 전 |
| BE | 출력 JSON 스키마 4종 (Zod 스키마 또는 TypeScript 인터페이스) | M3 착수 전 |
| BE | AIUsageLog 정책 문서 (`AiCostService.log()` 의무 호출 계약 포함) | M3 착수 전 |
| BE | L0~L3 라우팅 분기 조건 정책 문서 (`AiRouterService` 계약) | M3 착수 전 |
| DQ | Persona 점수 매핑 계약 (view → 점수 수치) | M6 착수 전 |
| QA | AI 금지영역 프롬프트 검증 체크리스트 (Task별 금지 출력 필드 목록) | M3 이후 |
| 화면/시나리오 | Persona 해석 텍스트 규약 (언어·길이·어조 기준) | M6 화면 설계 전 |

### 회귀 체크포인트(↩︎)에서 AI 파트가 재확인할 항목

| 마일스톤 | AI 파트 재확인 항목 |
|----------|-------------------|
| M3(↩︎M2) | AI Event Classification 보정과 Rule 분류 불일치율이 급증하지 않는지 — 불일치 증가 시 프롬프트 또는 M2 Rule 재점검 여부 판단 |
| M3(↩︎M1) | `buildMinimalInput()`이 원문 전문을 AI에 통째로 보내지 않는지 토큰량 모니터링 기준 확인 |
| M6(↩︎M3) | AI polarity 방향과 Buy Score 방향이 일치하는지 eval 케이스 재확인 |
| M8(↩︎M7) | Task 4가 생성한 `invalidConditions`가 M8 Exit 점검에서 실제로 평가되는지 확인 |
| M10(전구간 end-to-end) | AI 추정 비용 vs 모의운용 실측 비용 일치 검증, AI 금지영역 침범 감사 로그 0건 확인 |

---

## 4. 산출물 목록

| 산출물 | 형태 | 생성 마일스톤 |
|--------|------|-------------|
| Task 1 Disclosure Summary 프롬프트 (summary-v1.0) | `backend/src/ai-analyst/prompts/summary-v1.0.ts` | M3 |
| Task 2 Event Classification 프롬프트 (event-class-v1.0) | `backend/src/ai-analyst/prompts/event-class-v1.0.ts` | M3 (설계 M2) |
| Task 3 Persona Interpretation 프롬프트 (persona-v1.0) | `backend/src/ai-analyst/prompts/persona-v1.0.ts` | M3 |
| Task 4 Position Thesis 프롬프트 (thesis-v1.0) | `backend/src/ai-analyst/prompts/thesis-v1.0.ts` | M3 |
| 프롬프트 버전 상수 파일 | `backend/src/ai-analyst/prompts/versions.ts` | M3 |
| EXIT_SIGNAL_ASSIST 프롬프트 | `backend/src/ai-analyst/prompts/exit-assist-v1.0.ts` | M8 |
| `buildMinimalInput()` 계약 문서 (Task별 입력 필드·토큰 상한) | `docs/roadmap/` 또는 코드 주석 | M3 |
| 출력 JSON 스키마 4종 (TypeScript 인터페이스) | `backend/src/ai-analyst/dto/` | M3 |
| L0~L3 라우팅 정책 문서 | `docs/roadmap/phase-11-ai-cost-governance.md` 보완 | M3 |
| AIUsageLog 정책 문서 (지표·가드레일·예외조건) | `docs/roadmap/phase-11-ai-cost-governance.md` | M3 |
| AI 금지영역 프롬프트 검증 체크리스트 | QA 파트에 제공하는 문서 항목 | M3 |
| Persona 점수 매핑 계약 (view → Buy Score 수치) | DQ 파트에 제공하는 계약 문서 | M6 착수 전 |
| Task별 eval 정답 레이블 샘플 (각 20건 이상) | 스프레드시트 또는 JSON 파일 | M3~M10 |
| outcomeType 레이블링 정책 | `docs/roadmap/phase-11-ai-cost-governance.md` 보완 | M10 |
| 월간 AI 비용 리포트 형식 | 대시보드 쿼리 명세 | M10 |

---

## 5. 역할 특화 표준·체크리스트

### 5-1. 3대 원칙 이행 — AI 파트 관점

**원칙 1. AI는 모든 공시에 쓰지 않는다.**
- L0 조건 5종을 엄격하게 정의하고, 관심 외 기업·정기공시·저유동성 종목에 AI를 호출하는 코드 경로가 없음을 설계 단계에서 차단한다.
- 일일 호출 상한(초기 50건/일) 하드코딩을 프롬프트 정책 문서에 명시한다.

**원칙 2. 매도·포트폴리오 추적 우선 안전설계.**
- Task 4(Position Thesis)의 `invalidConditions`가 추상 문장 없이 기계 평가 가능한 형태임을 프롬프트 제약으로 보장한다.
- 예산 초과 시 보유 종목 EXIT_SIGNAL_ASSIST L3 호출만 예외 허용하는 정책을 명문화한다.

**원칙 3. 자동매매는 최후.**
- M10 MVP 졸업 게이트 전 AI 출력이 어떤 형태로도 자동 주문으로 이어지는 코드 경로가 없음을 프롬프트 아키텍처 다이어그램으로 명시한다.

### 5-2. AI 금지영역 보장 — 프롬프트 레벨 체크리스트

모든 Task의 시스템 프롬프트에 다음 항목이 포함되었는지 매 프롬프트 버전 변경 시 확인한다.

- [ ] "주문을 승인하거나 매수·매도를 지시하지 마십시오." (최종 주문 승인 금지)
- [ ] "손절가, 익절가, 손절선 퍼센트를 제안하지 마십시오." (손익 하드룰 금지)
- [ ] "포트폴리오 비중, 종목 한도를 제안하지 마십시오." (포트폴리오 한도 금지)
- [ ] "주문 수량, 주식 수, 투자 금액을 계산하지 마십시오." (주문 수량 결정 금지)
- [ ] "리스크 관리 규칙을 우회하거나 대체하는 제안을 하지 마십시오." (리스크 룰 우회 금지)
- [ ] 출력 파싱 단계에서 금지 필드 화이트리스트 검증 적용 여부 확인

### 5-3. 최소 입력 원칙 게이트

| Task | 입력 토큰 상한 | 위반 시 조치 |
|------|--------------|------------|
| Task 1 (Summary) | 500토큰 | `rawSummaryText`를 500자→200자로 자동 축소 |
| Task 2 (Event Classification) | 400토큰 | 핵심 수치 항목만 유지, 부가 텍스트 제거 |
| Task 3 (Persona Interpretation) | 800토큰 | 선택 보완 필드(시세 데이터) 제외 |
| Task 4 (Position Thesis) | 1,000토큰 | EventStudy 통계 필드 제외 fallback |
| L1 게이트 | 500토큰 | 제목 + 이벤트 타입 + 핵심 수치 요약만 |
| L3 심층 분석 | 6,000토큰 | 원문 핵심 섹션만 발췌, 전문 전체 전달 금지 |

### 5-4. 프롬프트 버전 변경 게이트

| 변경 유형 | 기준 | 처리 |
|-----------|------|------|
| minor (문장 수정, 어조 조정) | 출력 스키마 필드 변경 없음 | 기존 DONE 레코드 유지. 새 레코드부터 신 버전 적용 |
| major (스키마 필드 추가·삭제·타입 변경) | 출력 스키마 변경 | 기존 DONE 레코드 `superseded` 처리, 재처리 배치 예약. BE 파트와 마이그레이션 계획 협의 |

### 5-5. eval(출력 품질 평가) 최소 기준

| Task | 평가 지표 | 합격 기준 |
|------|----------|---------|
| Task 2 (Event Classification) | F1 (이벤트 분류 정확도) | ≥ 0.85 (100건 수동 레이블 기준) |
| Task 3 (Persona Interpretation) | Persona polarity 방향 일치율 | ≥ 0.80 |
| Task 4 (Position Thesis) | `invalidConditions` 기계 평가 가능 비율 | ≥ 0.90 (추상 문장 비율 < 10%) |
| 전체 | JSON 스키마 파싱 성공률 | ≥ 0.99 (실패 시 FAILED 처리) |
| 전체 | AI 금지 필드 출력 건수 | 0건 (화이트리스트 파싱 후 기준) |

### 5-6. AIUsageLog 기록 완전성 게이트

매 마일스톤 회귀 체크 시 다음을 확인한다.

- [ ] AI 호출이 발생한 모든 코드 경로에서 `AiCostService.log()`가 호출됨 (누락 0)
- [ ] `AIUsageLog.costUsd` 값이 외부 API 응답의 `usage` 필드와 ±5% 이내
- [ ] L0 처리 공시는 `AIUsageLog` 레코드 없음 (불필요 비용 기록 방지)
- [ ] 월간 집계(`getDailySummary`) 쿼리가 인덱스 스캔으로 처리됨
