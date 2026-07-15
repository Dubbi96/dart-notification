# Engine 2 — AI Analyst (AI 요약·해석·비용 거버넌스)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md §4-4·§4-6·§6` · 역할: `docs/roadmap/roles/ai.md` · Phase: `phase-04`, `phase-11`
> 이 폴더는 **AI Analyst 도메인**(M3)이다. 격리 컨텍스트로 작업한다. · 최종 수정: 2026-07-09

## 책임 (실제 모듈 트리 기준)

| 영역 | 모듈 | 책임 |
|---|---|---|
| 오케스트레이션 | `ai-analyst.service.ts` / `ai-analyst.module.ts` | 게이트→Task→검증→저장 파이프라인. AppModule 등록 완료 |
| 비용 게이트 | `cost-gate/ai-cost-gate.service.ts` | 공시→AI 레벨(L0~L3) 라우팅. **Rule 기반(AI 미사용)** |
| 비용 하드캡 | `cost-gate/ai-cost-limit-guard.service.ts` | 일일 $1 하드 백스톱 — 호출별 강제 차단 |
| 사용량 로그 | `usage-log/ai-usage-log.service.ts` | 호출 비용·토큰 기록(`AIUsageLog`). 기록 누락 0 |
| AI Task ×4 | `tasks/*.task.ts` | Summary(L2)·EventClassification(L1)·PersonaInterpretation(L2)·PositionThesis(L3) — 4종 전부 구현 |
| LLM 클라이언트 | `llm/http-llm-client.ts` | OpenAI 호환 HTTP 클라이언트(`LlmClient` 포트 구현) |
| 큐 컨슈머 | `consumers/event-extracted.consumer.ts` | Engine1 `event.extracted` → AI 분석 트리거 |
| 백필 드레인 | `backfill/ai-backfill.scheduler.ts` | 과거 미분석 공시 일일 드레인 cron(매일 02:00 KST, 예산 내 멱등·겹침가드) |
| 비용 집계·모니터 | `cost-aggregation/` · `cost-metrics/` | 일/월 비용 집계, 헬스 체크, 메트릭 컨트롤러, 모니터 cron |
| 입력 최소화 | `input/build-minimal-input.ts` | 파싱 산출물→최소 입력(≤2,000 토큰) 계약 구현 |
| 출력 검증 | `validation/json-output.validator.ts` | JSON mode + 필드 화이트리스트 검증 |
| 단가 추정 | `pricing/estimate-cost.ts` | 토큰×단가 비용 추정(`estimateCostUsd`) |
| 투자철학 | `philosophy/` | 철학 적합도 스코어링 + 페르소나 융합(`fusion/`) + API 컨트롤러 + **부팅 자동 시드**(`philosophy-seeder.service.ts`: `InvestorPhilosophy` 비었을 때만 4종 멱등 시드, count>0 no-op, 실패 graceful·부팅 무중단; SSOT=`philosophy-seeder.core.ts` — 수동 `npm run seed:philosophy` 와 공유). AI 미개입 |
| 영속화 | `ports/` + `adapters/` | `AiAnalysisRepository` 포트 — Prisma 어댑터(운영) / 인메모리(테스트) |
| 스모크 | `smoke/` | `ai-analyst.smoke.spec.ts` — `SMOKE_LLM=1` 시 실 LLM 호출 검증 |

## 절대 규칙

- **AI 금지영역 불가침**: 이 엔진은 *참고 정보*만 생성한다. 최종 주문 승인·손절/익절 하드룰·포트폴리오 한도·주문 수량·리스크 우회에 **절대 개입 금지**(Engine5가 독립 강제).
- **입력 최소화 계약**: 원문 전문을 AI에 통째로 넣지 않는다. Engine1 파싱 산출물에서 핵심 수치 + 핵심 단락(≤2,000 토큰)만 전달.
- **JSON 출력 강제**: 각 Task는 JSON mode + 필드 화이트리스트 검증. 파싱 실패 시 fallback.
- **멱등 캐시**: `rcpNo + task` 복합 유니크로 중복 호출 방지.
- AI 등급(필수/보조/금지) 매핑은 `cc-engine-architecture.md §4-6` 표가 정본.

## 현재 상태 (M3 완료 — 구현·라이브 실증)

- ✅ **41 src / 23 spec.** 4 Task·비용게이트(L0~L3)·`AIUsageLog`·JSON 검증·멱등 캐시 전부 구현, 테스트 그린.
- ✅ Prisma 모델 `AIUsageLog`·`DisclosureAnalysis`·`PersonaAnalysis` 존재(`prisma/schema.prisma`).
- ✅ `event.extracted` 큐 컨슈머 + 백필 드레인 cron 구동. **라이브 LLM 배치 실증 완료**(실공시 AI 카드 생성, 비용 소액 실측).
- 🚧 미가동은 **`SMOKE_LLM=1` 상시 라이브 운용뿐** — 라이브 호출 자체는 배치·스모크로 검증됨. 상시 라이브는 M10 졸업 조건(`m10-graduation-readiness`)과 연동.

## 회귀 게이트 (M3 ↩︎)

- AI 보정 vs Rule 분류 **불일치율** 추적(급증 시 M2 룰 재점검) · AI 입력 토큰량 모니터(원문 전문 유입 금지) · ~~**L0 비율 ≥ 70%**~~ → **전수분석 모드(2026-06-19 사용자지시)에서 의도적 완화**: 비용게이트 거래대금 하한=0 으로 전 공시를 AI 분석(`cost-gate/ai-cost-gate.service.ts`). L0 비율 가드는 미적용; 절대 비용은 `AiCostLimitGuard` 일일 $1 한도가 하드 백스톱 · 공시 1건당 평균 비용 < $0.005 유지.

## DoD

`npx tsc --noEmit` 0 · `npm test` 그린 · `AIUsageLog` 기록 누락 0 · AI 금지영역 미침범 · `docs/api-specification.md`·`docs/database-schema.md` 동기화.
