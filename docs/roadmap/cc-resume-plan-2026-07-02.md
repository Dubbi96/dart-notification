# 프로젝트 재개 계획 (2026-07-02) — 전수 감사 기반

> 작성: Claude Code 재개 감사 세션. 입력: 문서 120건 전수 감사(32 에이전트, 코드 교차검증) + 코드 건강 점검 + 브랜치/PR 위생 감사 + OCI prod 실측.
> 선행 정본: [일시중단 핸드오프 2026-06-28](./cc-pause-handoff-2026-06-28.md) — 복원 런북(§3 DB 복원 등)은 그쪽 참조.
> 이 문서는 **"지금 어디에 있고, 다음에 무엇을 하는가"** 의 단일 기준이다.

---

## 1. 현재 상태 스냅샷 (2026-07-02 실측)

### 1-1. 시스템: 중단 기간에도 정상 가동 ✅

| 항목 | 실측 결과 |
|---|---|
| OCI prod 수집 | **정상** — 최신 공시 `rcpDt=20260702`(당일), 누적 2,637,723건 |
| 모의매매 | **중단 없이 계속 운용됨** — 단타 트랙 마지막 거래일 20260702, 6/18~7/2 거래일 13일, 95건 청산, 누적 +0.55% |
| 백엔드 코드 건강 | `tsc --noEmit` 에러 0 · `nest build` 성공 · jest **3229/3231 green** |
| 모바일 코드 건강 | `tsc --noEmit` 에러 0 |
| 테스트 실패 2건 | **코드 회귀 아님** — `ai-usage-log.service.spec.ts`가 집계 윈도우를 2026-06-로 하드코딩한 시한부 테스트(7월부터 자동 실패). `harness/KNOWN_FAILURES.md` 기록됨 |

> 🔑 함의: 일시중단은 로컬 개발만 멈췄고 **M10의 "30일 캘린더 모의운용" 시계는 OCI에서 계속 흘렀다.** 다중전략 트랙 기동(6/21~22) 기준 30일 도달 시점은 **약 7/21**.

### 1-2. M0~M12 마일스톤 상태 (코드 근거 판정)

| 마일스톤 | 상태 | 근거 |
|---|---|---|
| M0 수집 안정화 | ✅ 완료 | prod 라이브 수집, DART 쿼터 라이브 예약분 가드(DAR-445) |
| M1 원문 파싱 | ✅ 완료 | DisclosureDocument + S3 오프로드(커버리지 100%) |
| M2 이벤트 추출 | ✅ 완료 | DisclosureEvent(rcpNo 1:1). ⚠️ 파싱→추출 체이닝 미발화 잠재버그 이력 |
| M3 AI Analyst | ✅ 완료 | engine2 4 Task + 비용게이트 + AIUsageLog, 라이브 배치 실증($0.014/27건). SMOKE_LLM 상시 라이브만 미가동(→M10) |
| M4 시세·시장데이터 | ✅ 완료 | KIS 실시간·KRX 일봉 검증, TimescaleDB 전종목 일봉·분봉 축적 |
| M5 Event Study | ✅ 완료 | 1,093 관측 + 이상치 robust 보강(DAR-402) |
| M6 매수 Signal | ✅ 구현 완료 / ⚠️ 엣지 미증명 | 1년 백테스트 baseline -14.5% → 결함 수정 후 **재검증 프로토콜 미실행**([buy-logic-validation-baseline](./buy-logic-validation-baseline.md)) |
| M7 Position Thesis | ✅ 완료 | engine4 구현·테스트 |
| M8 Portfolio & Exit | ✅ 완료 | Exit 5액션 도메인 테스트 |
| M9 백테스트 | ✅ 완료 | 다중전략 4트랙 + RSI 검증(엣지 없음 → 제품화 보류) |
| **M10 모의투자·비용 거버넌스** | 🚧 **진행 중 — 현재 병목** | 측정기준 충족, 졸업 잔여: ①라이브AI 상시(SMOKE_LLM) ②30일 캘린더 모의운용(≈7/21 도달) |
| M11 반자동매매 | 🚧 토대만 | Risk 하드룰·KillSwitch·OrderRequest 스키마 완비, **실주문 루프 미연동**(OrderRequest 실사용 0). M10 졸업이 진입 게이트 |
| M12 제한적 자동매매 | ⬜ 미착수 | 선행요소(Kill Switch)만 존재 |
| M13~ 다자산 | ⬜ 미착수 | 설계만([cc-multi-asset-expansion](./cc-multi-asset-expansion.md)) — 계획대로 보류 |

**결론: 병목은 코드가 아니라 ①캘린더 시간(30일 운용) ②라이브AI 상시 가동 ③매수논리 엣지 재검증이다.**

---

## 2. 즉시 재개 작업 (Track 0 — 첫 세션에서 처리)

| # | 작업 | 비고 |
|---|---|---|
| 0-1 | 오픈 PR #388/#389 **클로즈 (사용자 실행 필요)** | 중복 확정 — 동등 수정이 #387(ed388c4a)/#390(e979027e)으로 이미 main 머지됨, 둘 다 CONFLICTING. `gh pr close 388 389` |
| 0-2 | PR #424(DAR-471)·#425(DAR-472) **상호평가→머지→재배포** | 둘 다 MERGEABLE/CLEAN 확인됨. 절차: pause 핸드오프 §1 |
| 0-3 | ~~시한부 테스트 수정~~ | ✅ 2026-07-02 처리 — 상대 윈도우化, **PR #430** (jest 3254 전그린) |
| 0-4 | 로컬 브랜치 정리 | ✅ 2026-07-02 처리 — 머지 확인 255개 삭제, 잔여는 §5-3 |
| 0-5 | (로컬 개발 필요 시) DB 복원 | pause 핸드오프 §3 — TimescaleDB pre/post_restore 필수, 백업: `dart-db-backups/dart_notification_2026-06-27.dump` |
| 0-6 | Paperclip 플릿 재기동 | `cd rubberducksim-agents/paperclip && pnpm dev` |

## 3. 트랙별 실행 계획

### Track A — M10 졸업 (최우선, 캘린더 의존)

1. **라이브AI 상시 가동**: SMOKE_LLM 활성화 + engine2 배치가 신규 공시에 상시 동작하는지 OCI에서 확인. AIUsageLog 비용 모니터링(비용게이트 L0~L3 동작 검증).
2. **30일 모의운용 완주**: OCI에서 이미 누적 중 — **중단시키지 말 것**. ≈7/21 이후 `integration-regression.ts` 재실행으로 졸업 게이트(G1~G7, [cc-mvp-definition §9](./cc-mvp-definition.md)) 측정.
   - ✅ (2026-07-02 처리) DAR-68 확장 게이트(G6 MDD/G7 alpha) 행 재반영 완료 — **PR #430** (`graduation-gate-rows.ts` + 단위테스트 21건). 머지 후 재실행 가능.
3. **졸업 판정 리포트** 생성 → `docs/roadmap/`에 새 리포트로 커밋(구 리포트는 archive에 있음).

### Track B — 매수논리 엣지 재검증 (Track A와 병행)

- ✅ **재검증 1회차 실행됨 (2026-07-02) — 판정: 불합격.** 상세: [buy-logic-validation-baseline §6](./buy-logic-validation-baseline.md).
  - replay -24.71%(429tr·PF 0.546·sharpe -1.00), d20 robust median -13.38%, **isRobustMonotonic=false(rankCorr -0.8)**.
  - ★핵심: DAR-410의 "robust로 단조성 성립" 결론이 확장 표본에서 **반전** — BLOCKED(회피)가 median +14.18·승률 69.6%로 최고 성과. 회피 룰이 상승 신호를 걸러내는 구조적 역예측 가능성.
- **후속 이슈(발행 대상)**: ① BLOCKED 조건 분해 진단(92건 역추적) ② WATCH 등급 재설계(승률 6.7%) ③ calibration 응답 공백 확인. 해소 후 재검증 2회차.
- **M11 진입 보류 유지 확정** (§4-2 조건 미충족).

### Track C — M11 반자동매매 준비 (M10 졸업 후 착수)

- 실주문 루프: OrderRequest → KIS 주문 API 연동 → OrderExecution 기록 → TradingAuditLog(INSERT-ONLY). **Risk 하드룰은 AI 금지영역**(engine5 독립) 유지.
- ⚠️ [phase-13](./phase-13-semi-auto-trading.md) 문서보다 코드가 앞서 있음(OrderRequest 모델·KIS 인증·Risk 체크 선구현) — **착수 전 phase-13 현행화 필수, 중복 구현 위험 최대 지점**.
- 모바일: 주문 승인/이력 화면(SCR-ORDER-PENDING·SCR-ORDER-HISTORY)은 [screen-plan](../mobile/screen-plan.md)에 유일한 상세 기획 존재(`app/orders/` 미구현).

### Track D — 배포·운영 개선 (독립 병행 가능)

| 항목 | 상태 → 할 일 |
|---|---|
| FCM V1 서버키 등록 | 대화식 필요(Firebase 콘솔) → 등록 후 standalone APK 푸시 토큰 검증 |
| ARM 상위서버 | Tokyo 용량 부족 지속 — `scripts/oci-arm-a1-retry.sh` 루프 유지 |
| 스토어 출시 | EAS APK 직접 배포 단계 → Play Store 등록 준비(BMC의 채널 전략) |
| 백업 자동화 | 수동 pg_dump(6/27) → 주기 백업 cron 검토 |

### Track F — UI/UX 개선 백로그 (2026-07-02 정밀 리뷰, 이슈化하여 플릿 처리)

- 정본: [cc-ux-review-2026-07-02](./cc-ux-review-2026-07-02.md) — 확정 76건(high 10/medium 33/low 33), 파일별 1이슈 분해안 UXR-1~23 + low 패턴 묶음.
- 순서: **#424/#425 머지 먼저**(중복 4건 자동 해소, UXR-6/9는 같은 파일이라 머지 후 착수) → 1차 UXR-1~10(high) → 2차 → 3차. 처리 후 에뮬레이터 인터랙션 패스 + 재검증(§6).
- 6/27 감사 잔여: W1(신호 탭 서브타이틀·코치마크), W5(배너 토큰·BuyScoreCard 정리), W7(GlassCard·LogoMark 토큰) — UXR 분해안에 포함됨.

### Track E — 문서 현행화 백로그 (감사 결과, 이슈化하여 플릿 처리)

이번 정리 PR에서 **아카이브 21건 + 위험 수정(CLAUDE.md 엔진표, QUICK_START 파괴 명령 제거, cc-data-model SSOT 이관, KNOWN_FAILURES 2건 추가)** 은 완료. 남은 update 백로그(우선순위순):

**P1 — 에이전트 오도 방지 (자동 로드 컨텍스트):**
- `backend/src/engine2-ai-analyst/CLAUDE.md`("스캐폴딩" 주장 → 실제 완성) · `engine3-quant-market/CLAUDE.md`("M4 스켈레톤" → 99src 완성) — 가장 심각
- `backend/CLAUDE.md`, engine1/4/5 CLAUDE.md 모듈 표 부분 낡음
- `docs/roadmap/01-execution-roadmap.md` — 마일스톤 상태 열 추가(§1-2 매트릭스 반영)

**P2 — 기술 정본 4종:**
- `docs/api-specification.md`: 카카오 OAuth 엔드포인트 완전 누락, 45개 컨트롤러 중 다수 미수록, Base URL(`api.dart-notification.com` → nip.io)
- `docs/database-schema.md`: 미문서 모델 15종(IntradayScalpTrade 등), User provider/providerId 미반영
- `docs/deployment.md`: pnpm 잔재, ARM 단일 VM 절차 → 실제 AMD 2-micro + Mac 크로스빌드 + Caddy/nip.io/FCM 미기재
- `docs/workflow.md`: §1 이메일 가입 플로우(실제 카카오 전용), 단타 배치·매수매도 푸시·쿼터 가드 미반영, 절 번호 중복

**P3 — 로드맵·설계 정본:**
- `docs/roadmap/00-vision-and-principles.md` "1번 초입" 등 현재 위치 서술
- `docs/roadmap/cc-engine-architecture.md`: 큐 8종 설계 vs 실제 3종(AI_ANALYZE/NOTIFY/EXPO_RECEIPT), ECS Fargate vs 실제 OCI compose
- `docs/roadmap/cc-mvp-definition.md` §1 제외항목(Event Study·백테스트 이미 구현), `docs/roadmap/README.md` 인덱스
- phase-03/05/06/12/**13**(중복 구현 위험) · roles/infra.md(AWS 전제)
- `docs/mobile/screen-plan.md` IA 트리 · `docs/mobile-dev-build.md`(EAS owner duvbi·oci 프로파일·regression-ci)

**P4 — 소개·기획·런북:**
- `README.md` 전면 재작성(이번 PR은 최소 수정만) · `QUICK_START.md` env 49줄 반영 · `docs/01-service-overview.md`/`02-BMC`(GCP→OCI, 제품 범위) · `docs/multi-agent-harness.md` 상태절 · `docs/work/m0/policy-non-advisory.md` · `docs/dart-disclosure-types.md` 코드 경로

**잠재 코드 이슈 (감사 중 발견, 이슈화 대상):**
1. 시한부 테스트(§2 0-3) — 즉시
2. 파싱→추출 체이닝 미발화 잠재버그(메모리 기록, 미해소 확인 필요)
3. 배당 HYBRID 미분류 known-gap(`KNOWN_FAILURES.md` 승계됨) — 저우선
4. `integration-regression.ts` DAR-68 게이트 행 소실(§3 Track A)

## 4. 결정 필요 사항 (사용자 판단)

1. **M10 졸업 판정 시점**: ≈7/21 도달 시 자동 측정 후 보고 → 졸업 선언은 사용자 승인.
2. **M11 착수 조건**: M10 졸업 + Track B 엣지 확인, 둘 다 충족 시에만? (제안: 예 — 엣지 없는 실주문은 무의미)
3. **스토어 출시 시점**: M10 졸업 전 알림 앱으로 선출시 vs 투자판단 기능 안정화 후 출시.
4. **Free/Premium 티어**: BMC의 Freemium(관심기업 5개 제한 등)은 코드 미구현 — 출시 전 구현 여부.

## 5. 위생 감사 결과 기록 (2026-07-02 처리분)

### 5-1. 문서 감사 총괄
- 대상 120건: **keep 40 · update 35(→Track E) · archive 21(이동 완료) · delete 0**
- 아카이브 후보 21건 전부 참조 검증(반박 에이전트) 통과 후 `docs/archive/`로 이동, 참조 링크 동일 커밋 수정. 정책: [docs/archive/README.md](../archive/README.md)
- `_develop_extract/`(gitignored 로컬 잔재 1.8MB) 삭제

### 5-2. 오픈 PR 판정
| PR | 판정 | 근거 |
|---|---|---|
| #424, #425 | **머지 대상**(상호평가 절차로) | MERGEABLE/CLEAN, 충돌 없음 |
| #388 | 클로즈(중복) | 동등 수정 ed388c4a(#387)로 main 반영, CONFLICTING |
| #389 | 클로즈(중복) | 동등 수정 e979027e(#390)로 main 반영, CONFLICTING |

### 5-3. 브랜치 위생
- 로컬 278개 중 **255개 삭제**(머지 PR 헤드 175 + 조상 병합 확인 80). 오픈 PR 헤드 4개 + 클로즈 PR 출신 미확인 8개 + 진짜 미확인 10개는 보존 — 목록·사유는 감사 로그 참조. 미확인 18개는 내용 확인 후 개별 처리.

---
*최종 수정: 2026-07-02 · 다음 갱신 트리거: M10 졸업 측정(≈2026-07-21) 또는 트랙 상태 변경 시*
