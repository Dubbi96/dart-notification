# 멀티에이전트 하네스 — 구축 내역 & 운영 가이드

> 최종 업데이트: 2026-06-04 · 이 문서는 세션 리셋 후 작업 재개를 위한 **단일 인수인계 문서(SSOT)** 다.
> 관련: 루트 `CLAUDE.md`(DDD·검증·하네스 규칙), `AGENTS.md`(워크플로), `.agents/`, `harness/`, `docs/roadmap/`

---

## 0. ✅ 재개 첫 작업 — 완료 (2026-06-04)

> 🛑 **현재 paperclip 4 에이전트는 전부 PAUSED 상태다.** (할당된 이슈가 wakeOnDemand를 자동 트리거해 선행조건 미충족 작업까지 자율 착수한 사고 → 통제 위해 일시정지함.) 재개 시 **환경 준비 후 의도적으로 unpause + wakeup** 할 것. 미할당/BLOCKED 이슈는 환경 충족 전 할당 금지. (상세: §7)

**✅ `feat/DAR-2-remaining-ai-tasks` → main ff-병합 + 부트스트랩 커밋 완료.**
재개 세션이 아래를 실행했다(병합 전 재검증: tsc 0 / jest 22스위트·251테스트 그린 재확인):

```bash
git switch main
git merge --ff-only feat/DAR-2-remaining-ai-tasks          # 4fc3ddb 병합 완료
git add .agents AGENTS.md harness CLAUDE.md docs/multi-agent-harness.md
git commit -m "chore(harness): paperclip 부트스트랩 + 멀티에이전트 문서 정리"   # 7577ac1
```
> 결과: main = `7577ac1` (DAR-2 + 하네스 부트스트랩 포함). 미push 상태.
> push는 별도(요청 시) — `git push origin main`은 하네스가 휴먼 승인 요구.
> **다음 작업**: §6 백로그 — `37ae394e`(M4 engine3 스캐폴딩)은 선행조건 없음·즉시 가능. 나머지(M3-A/B/C)는 환경(DB/Redis/LLM키) 준비 후.

---

## 1. 두 개의 하네스 레이어 (공존)

| 레이어 | 자산 | 읽는 주체 | 역할 |
|---|---|---|---|
| **Claude Code 네이티브** | `.claude/settings.json`(권한 매트릭스)·`.claude/hooks/`(guard-bash·risk-guard)·`.claude/agents/`(be/fe/ai/qa-verifier) | Claude Code CLI | 권한 경계·파괴적명령/AI금지영역 차단·검증 서브에이전트 |
| **paperclip AI** | `.agents/`(ORCHESTRATOR·PLANNER·DEVELOPER·REVIEWER)·`harness/`·`AGENTS.md` | localhost:3100 오케스트레이션 툴 | 자율 멀티에이전트 실행(이슈→브랜치→구현→검수) |

두 레이어 모두 루트 `CLAUDE.md` 공통 규칙을 참조한다. paperclip 에이전트는 이 repo를 워크스페이스로 실행되므로 `.claude/` 훅·권한도 함께 적용된다.

### Claude Code 권한/훅 (`.claude/`)
- `settings.json`: allow(빌드·테스트·git status/commit 등) / ask(`git push`·`prisma migrate`) / deny(`prisma migrate reset`·force push·`rm -rf`).
- `hooks/guard-bash.mjs`: 파괴적 Bash 명령 정규식 차단. `hooks/risk-guard.mjs`: Engine5 Risk가 AI import 시 차단(AI 금지영역 코드 강제).

---

## 2. paperclip AI 구성 (company: dart-notification)

- **Company id**: `c45545cc-29fc-4abb-9a9e-4c4d7d671d76` · 이슈 prefix `DAR`
- **deploymentMode**: local_trusted · heartbeat 전부 OFF(on-demand, 자동폴링 없음)

| 에이전트 | id | role(enum) | model | skip-perms | reportsTo |
|---|---|---|---|---|---|
| ORCHESTRATOR | `ee81f071-55a5-4cbc-9463-89268af0516f` | ceo | sonnet-4-6 | on | (top) |
| PLANNER | `8d6e49f8-780b-4248-862c-02c461f00a58` | pm | sonnet-4-6 | on | ORCHESTRATOR |
| DEVELOPER | `bacf2dc3-edd8-4bef-8b42-81d4849fb656` | engineer | opus-4-8 | on | ORCHESTRATOR |
| REVIEWER | `c6931f6c-b213-4265-b610-931f9bc8acb4` | qa | sonnet-4-6 | on | ORCHESTRATOR |

> 각 에이전트의 instructions(managed `AGENTS.md`)는 repo `.agents/<ROLE>.md` 내용으로 설정됨. role enum에 "agent"가 없어 PLANNER→pm, DEVELOPER→engineer, REVIEWER→qa로 매핑(이름은 유지).

### paperclip REST API 빠른 참조 (localhost:3100)
- 에이전트 목록: `GET /api/companies/<C>/agents`
- 이슈 생성: `POST /api/companies/<C>/issues` `{title, description, assigneeAgentId}`
- 에이전트 깨우기: `POST /api/agents/<id>/wakeup?companyId=<C>` `{reason}`
- 에이전트 설정 수정: `PATCH /api/agents/<id>?companyId=<C>` `{adapterConfig:{...}}`
- instructions 파일 쓰기: `PUT /api/agents/<id>/instructions-bundle/file?companyId=<C>` `{path, content}`
- (per-agent 경로는 `/api/agents/<id>/...?companyId=<C>`, 목록/생성은 `/api/companies/<C>/...`)

---

## 3. DDD 도메인 구조 (백엔드, 5엔진) — 상태

정본: `docs/roadmap/cc-engine-architecture.md §4-1`. 코드는 `backend/src/engineN-*/` 도메인 폴더로 묶고, 폴더마다 `CLAUDE.md` 동반.

| 도메인 | 마일스톤 | 상태 |
|---|---|---|
| `engine1-disclosure/` (수집·파싱·이벤트추출) | M0~M2 | ✅ 물리통합 완료 |
| `engine2-ai-analyst/` (4 AI Task·비용게이트·영속) | M3 | 🚧 코어+4Task 구현, **영속/큐/라이브LLM 미완** |
| `engine3-quant-market/` | M4~M6,M9 | ⬜ (스캐폴딩 예정 = DAR 백로그) |
| `engine4-portfolio-exit/` | M7~M8 | ⬜ |
| `engine5-trading-risk/` (Risk 독립·AI금지) | M11~M12 | ⬜ |
| 횡단(auth·companies·prisma·common 등) | 전구간 | 유지 |

### Engine2(M3) 구현 현황
- ✅ 헥사고날: `LlmClient`(포트)+`HttpLlmClient`(OpenAI호환), `AiAnalysisRepository`(포트)+`InMemory`(어댑터)
- ✅ 4 Task 전부 구현: Summary(L2)/EventClassification(L1)/Persona(L2)/PositionThesis(L3) — 최소입력→LLM→`parseAndValidate`(필드 화이트리스트)
- ✅ `AiCostGateService`(L0~L3 Rule), `AiAnalystService`(멱등캐시→게이트→Task→영속→비용기록), `AiUsageLogService`
- 🚧 미완(환경 선행조건): Prisma 영속(DB), event.extracted 큐(Redis), 라이브 LLM(키) → **DAR 백로그 참조**

---

## 4. 워크플로 & 검증 (AGENTS.md / harness/)

- 작업 단위 = 이슈 1건. **main 직접 커밋 금지** → `feat/<issue-id>-<slug>` 브랜치 + PR.
- 완료는 주장이 아니라 **증거**: `harness/VERIFICATION.md` 6대 증거(테스트·타입체크·린트·동작재현·회귀·수용기준).
- 검증 게이트(DoD): `cd backend && npx tsc --noEmit`(0) + `npm test`(그린) + AI금지영역 미침범 + 문서 동기화.
- 독립 검증은 `.claude/agents/qa-verifier`(읽기전용) 또는 REVIEWER가 수행.

---

## 5. 진행 이력 (git, 로컬 — origin 미push)

```
main: 7577ac1  (DAR-2 병합 + 하네스 부트스트랩)   ← origin/main(a066704)보다 5커밋 앞섬, 미push
  ├ 4fc3ddb  feat/DAR-2 (M3 나머지 3 Task, ff 병합 완료)
  └ 6c17b38  (하네스+DDD+M3코어)
feat/DAR-2-remaining-ai-tasks: 4fc3ddb  (main에 ff 병합 완료 — 삭제 가능)
feat/DAR-4-ai-analysis-prisma, feat/DAR-5-bullmq-queue-consumer  (미검증 WIP, §7 참조)
feat/ddd-harness-m3, feat/m3-ai-analyst  (병합완료된 과거 브랜치)
```
> ✅ 재개 세션이 §0대로 main 복귀 + ff 병합 + 부트스트랩 커밋 완료. working tree clean.

### 첫 자율 실행(DAR-2) 결과 & 관찰된 deviation
- ✅ ORCHESTRATOR가 이슈를 읽고 브랜치 생성→3 Task 구현→테스트→커밋, 이슈를 in_review로. 검증 통과.
- ⚠️ deviation: (1) 별도 worktree 미사용(주 디렉터리 브랜치 직접 전환) (2) `gh pr create` 미실행(in_review만) (3) 서브에이전트 위임 없이 오케스트레이터 단독 처리. → 다음 실행 전 ORCHESTRATOR instructions에 worktree·PR 규약 강화 권장.

---

## 6. 다음 작업 (paperclip 백로그 이슈, 전부 todo·ORCHESTRATOR 할당)

| 이슈 | 내용 | 선행조건 |
|---|---|---|
| `37ae394e` M4 | engine3-quant-market 스캐폴딩 | **없음 — 즉시 가능** |
| `7be69287` M3-A | Prisma 모델3종+마이그레이션+Prisma 어댑터 | docker DB 가동 + migrate 승인 |
| `e3823e6f` M3-B | event.extracted 큐 컨슈머 | Redis/BullMQ 설치 |
| `27aafc7d` M3-C | 라이브 LLM 통합+게이트 실측 | LLM_API_KEY 설정 |

### 활성화 방법(재개 시)
1. **먼저 환경 준비** (BLOCKED 이슈): `docker-compose -f docker-compose.dev.yml up -d`(DB·Redis), `.env`에 `LLM_API_KEY` 등.
2. **에이전트 unpause**: `POST /api/agents/<id>/resume?companyId=<C>` (또는 paperclip UI). 4개 모두 현재 paused.
3. ORCHESTRATOR 깨우기: `POST /api/agents/ee81f071-.../wakeup?companyId=c45545cc-...` `{"reason":"<이슈> 진행"}`
4. ⚠️ **이슈 할당 = 자동 깨움**(wakeOnDemand). 준비 안 된 이슈는 할당하지 말 것. heartbeat는 OFF.

## 7. ⚠️ 핸드오프 인시던트 & WIP 보존 (2026-06-04)

백로그 이슈를 ORCHESTRATOR에 할당하자 **wakeOnDemand가 자동 트리거**되어, 선행조건(DB/Redis) 미충족인 DAR-4(Prisma)·DAR-5(BullMQ)를 자율 착수함. 통제 위해 **전 에이전트 pause** + 미완 WIP를 손실 없이 브랜치에 보존:
- `feat/DAR-4-ai-analysis-prisma`: schema.prisma 수정 + Prisma 어댑터 + engine3 스캐폴딩 일부 (미검증)
- `feat/DAR-5-bullmq-queue-consumer`: BullMQ/Redis 의존성 + docker-compose redis (미검증)
- 백로그 이슈 4건은 `todo`로 복귀, repo는 검증된 `feat/DAR-2`로 복귀, 임시 worktree(wt-DAR-5) 제거.

**재개 시**: DAR-4/DAR-5 WIP는 참고만 하고, 환경 준비 후 깨끗이 재구현 권장. (교훈: `harness/KNOWN_FAILURES.md` 등록됨 — 백로그는 미할당으로 생성하거나 등록 전 pause.)
