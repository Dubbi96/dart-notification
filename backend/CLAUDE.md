# 백엔드(NestJS) — 도메인 규칙

> 상위: 루트 `CLAUDE.md`(전역) · SSOT: `docs/roadmap/00-vision-and-principles.md` · 구조: `docs/roadmap/cc-engine-architecture.md`
> 이 파일은 `backend/` 작업 시 자동 로드되는 **백엔드 도메인 컨텍스트 패키지**다.

## 1. DDD 바운디드 컨텍스트 (5개 엔진 + 횡단)

코드는 **도메인(엔진) 단위**로 묶는다. 기능 모듈을 평면 나열하지 않는다.

| 도메인 폴더 | 책임 | 소유 모델 | 마일스톤 |
|---|---|---|---|
| `engine1-disclosure/` | 공시 수집·원문 파싱·이벤트/수치 추출 | `Disclosure`·`DisclosureDocument`·`DisclosureEvent`·`DisclosureCollectionLog` | M0~M2 ✅ |
| `engine2-ai-analyst/` | 4개 AI Task·비용 게이트(L0~L3)·`AIUsageLog` | `DisclosureAnalysis`·`PersonaAnalysis`·`AIUsageLog` | M3 |
| `engine3-quant-market/` | 시세·지표·Event Study·Buy Score | `StockDailyPrice`·`TechnicalIndicator`·`EventStudyResult`·`TradingSignal` | M4~M6, M9 |
| `engine4-portfolio-exit/` | 포트폴리오·포지션·Exit Score | `Portfolio`·`Position`·`PositionThesis`·`ExitSignal` | M7~M8 |
| `engine5-trading-risk/` | Risk 하드룰·모의/실주문 | `PaperTrade`·`OrderRequest`·`OrderExecution`·`TradingAuditLog` | M11~M12 |
| 횡단(독립 유지) | `auth` `users` `companies` `watchlist` `notifications` `notification-settings` `expo-push` `devices` `saved-disclosures` `prisma` `common` | — | 전 구간 |

- 엔진 간 통신은 **BullMQ 큐**(`common/queues/queue.constants.ts`)와 DB를 통한다. 엔진끼리 서비스 직접 호출은 최소화.
- 새 도메인 폴더를 만들면 해당 폴더에 `CLAUDE.md`(도메인 규칙 + 담당 마일스톤 로드맵 발췌)를 함께 둔다.

## 2. AI 금지영역 (절대 규칙 — 코드로 강제, `.claude/hooks/risk-guard.mjs`가 감시)

- **Engine5 `RiskCheckService`는 AI(`AiAnalystModule`/LLM)에 의존성을 가질 수 없다.** 독립 실행.
- 최종 주문 승인 / 손절·익절 하드룰 / 포트폴리오 한도 / 주문 수량 / 리스크 우회 → **AI 개입 절대 금지**.
- Buy Score·Exit Score 계산은 **Rule(점수 공식)**, AI 아님. 이벤트 타입 1차 분류도 정규식·키워드(L0).
- AI 등급 매핑은 `cc-engine-architecture.md §4-6` 표를 정본으로 따른다.

## 3. 자연키 & 데이터 정합

- `Disclosure.rcpNo` (String PK) = 모든 신규 분석 모델의 FK 루트.
- `Company.corpCode` (String PK) = 시세·포트폴리오 모델의 FK 루트.
- FK 무결성 유지, 고아 레코드 0. 마이그레이션은 `prisma/CLAUDE.md` 규칙 준수.

## 4. NestJS 컨벤션

- 모듈 단위 구성: `*.module.ts` / `*.controller.ts` / `*.service.ts` / `dto/` / (도메인별) `extractors/`·`parsers/`·`mappers/`.
- DI는 생성자 주입. 순환참조는 `forwardRef` 대신 큐/이벤트로 분리.
- 비동기 무거운 작업(파싱·AI·지표)은 **BullMQ 워커**, 순서·중복 락 필요한 작업은 **Cron**.
- 모든 엔드포인트는 Swagger 데코레이터(`@ApiTags`/`@ApiOperation`) 부착. 문서: `/api/docs`.
- import: 외부 라이브러리 → 도메인 내부(상대경로) → 타입. 런타임 `@/` alias는 **미등록**이므로 상대경로 사용.

## 5. 완료(DoD) 게이트 — 서브에이전트/구현 완료 조건

1. `npm run build`(nest build) 통과 · `npx tsc --noEmit` 에러 0
2. `npm test`(jest) 그린 — 기존 테스트 회귀 없음
3. 스키마 변경 시 마이그레이션 커밋(`prisma/CLAUDE.md`) + 자연키 FK 정합
4. AI 금지영역 미침범(Engine5 독립성) · `AIUsageLog` 기록 누락 0(AI 사용 시)
5. 변경 영역 문서 동기화(`docs/database-schema.md`·`docs/api-specification.md` 등)

## 6. 테스트 분리 — 단위 vs 통합

- **단위**: `npm test`(`jest.config.js`, `*.spec.ts`, DB 불필요) — 항상 그린 유지.
- **통합**: `npm run test:integration`(`jest.integration.config.js`, `*.integration-spec.ts`) — **실 Postgres 필요**(`DATABASE_URL`, dev DB 가동 전제). DB 의존이라 단위 파이프라인과 분리. 각 테스트는 인터랙티브 트랜잭션 내부에서 수행 후 **롤백**(`test/integration/with-rollback.ts`)하여 dev DB 잔여 row 0·데모 데이터 무변경을 보장한다.
