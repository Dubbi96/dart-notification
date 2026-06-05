# Engine 2 — AI Analyst (AI 요약·해석·비용 거버넌스)

> 상위: `backend/CLAUDE.md` · 설계: `docs/roadmap/cc-engine-architecture.md §4-4·§4-6·§6` · 역할: `docs/roadmap/roles/ai.md` · Phase: `phase-04`, `phase-11`
> 이 폴더는 **AI Analyst 도메인**(M3)이다. 격리 컨텍스트로 작업한다.

## 책임

| 영역 | 파일 | 책임 |
|---|---|---|
| 비용 게이트 | `cost-gate/ai-cost-gate.service.ts` | 공시→AI 레벨(L0~L3) 라우팅. **Rule 기반(AI 미사용)** |
| 사용량 로그 | `usage-log/ai-usage-log.service.ts` | 호출 비용·토큰 기록(`AIUsageLog`). 기록 누락 0 |
| AI Task ×4 | `tasks/*.task.ts` | Summary(L2)·EventClassification(L1)·Persona(L2)·PositionThesis(L3) |

## 절대 규칙

- **AI 금지영역 불가침**: 이 엔진은 *참고 정보*만 생성한다. 최종 주문 승인·손절/익절 하드룰·포트폴리오 한도·주문 수량·리스크 우회에 **절대 개입 금지**(Engine5가 독립 강제).
- **입력 최소화 계약**: 원문 전문을 AI에 통째로 넣지 않는다. Engine1 파싱 산출물에서 핵심 수치 + 핵심 단락(≤2,000 토큰)만 전달.
- **JSON 출력 강제**: 각 Task는 JSON mode + 필드 화이트리스트 검증. 파싱 실패 시 fallback.
- **멱등 캐시**: `rcpNo + task` 복합 유니크로 중복 호출 방지.
- AI 등급(필수/보조/금지) 매핑은 `cc-engine-architecture.md §4-6` 표가 정본.

## 현재 상태 (스캐폴딩)

- ✅ 구조·타입·비용 게이트(L0~L2, 테스트 통과) + Task 스켈레톤 + 모듈 등록(AppModule).
- 🚧 TODO(M3): `AIUsageLog`·`DisclosureAnalysis`·`PersonaAnalysis` Prisma 모델 + LLM 클라이언트 + 프롬프트·JSON 스키마 + `event.extracted` 큐 컨슈머.

## 회귀 게이트 (M3 ↩︎)

- AI 보정 vs Rule 분류 **불일치율** 추적(급증 시 M2 룰 재점검) · AI 입력 토큰량 모니터(원문 전문 유입 금지) · **L0 비율 ≥ 70%** · 공시 1건당 평균 비용 < $0.005.

## DoD

`npx tsc --noEmit` 0 · `npm test` 그린 · `AIUsageLog` 기록 누락 0 · AI 금지영역 미침범 · `docs/api-specification.md`·`docs/database-schema.md` 동기화.
