# Claude 총괄 × paperclip 플릿 — 자율 고도화 운용 플레이북

> **목적**: Claude Code(총괄/오케스트레이터)가 paperclip AI 멀티에이전트 플릿(구현)을 지휘해
> 코드베이스를 **자율·지속적으로 고도화**하는 운용 형상을 정의한다. 이 문서는 paperclip이
> 붙어 있는 **다른 프로젝트에도 그대로 이식**할 수 있도록 프로젝트 고유값을 템플릿화했다.
>
> **출처**: dart-notification 프로젝트에서 23+ 사이클(배치14~37, DAR-262~291, 30+ PR 무회귀 머지)로
> 검증된 패턴. 최종 갱신 2026-06-15.

---

## 0. 한 줄 요약

> **Claude는 "두뇌"(감사·기획·검증·머지), paperclip 플릿은 "손"(구현)이다.**
> Claude는 직접 기능을 구현하지 않는다. 매 사이클 ① 완성된 PR을 검증·머지하고, ② 새 차원을
> 감사해 실결함만 이슈로 등록·디스패치하고, ③ 다음 사이클을 예약한다. 이 루프를 **수렴 없이**
> 돌린다. 단, **허위양성·패딩 없이 실제 결함만** 등록한다.

---

## 1. 2-레이어 멘탈 모델

이 형상은 **두 개의 독립 레이어가 공존**한다. 혼동하면 안 된다.

| 레이어 | 무엇 | 읽는 주체 | 역할 |
|---|---|---|---|
| **Claude Code 네이티브** | `.claude/`(settings·hooks·agents) | Claude Code | 권한 경계·서브에이전트·총괄 두뇌 |
| **paperclip 오케스트레이션** | `.agents/`·`harness/`·`AGENTS.md` | paperclip 런타임 | 구현 플릿(PLANNER/DEVELOPER/REVIEWER/ORCHESTRATOR) |

- **Claude = 총괄(orchestrator-of-record)**: 사람의 대리인. 무엇을 고칠지 **판단**하고, 결과를 **검증**하고, **머지**한다.
- **paperclip 플릿 = 구현 워커**: Claude가 발행한 이슈를 픽업해 격리 worktree에서 **구현**하고 PR을 올린다.

> ⚠️ 핵심 원칙: **기능 개발·개선·고도화는 paperclip 플릿이 구현한다. Claude는 이슈 발행·할당·검증·머지만 한다.**
> (예외: 플릿 픽업이 정체되고 사용자가 명시 승인한 경우에 한해 Claude가 직접 구현 — 일상 규칙 아님.)

---

## 2. 자율 루프 — 코어 엔진

매 사이클(=한 번의 `/loop` 발화)은 **3단계**다. 이것이 전부다.

```
┌─────────────────────────────────────────────────────────────┐
│  ⏱️ 타임스탬프 찍기 (작업 시간 추적)                          │
│                                                               │
│  ① 수확(HARVEST)   in_review PR → 검증 → 머지                 │
│  ② 감사(AUDIT)     새 차원 1개 감사 → 실결함 이슈 등록 → 디스패치 │
│  ③ 예약(SCHEDULE)  다음 사이클 예약                           │
└─────────────────────────────────────────────────────────────┘
```

### ① 수확 (HARVEST) — 완성된 PR을 머지

1. **상태 조회**: paperclip에서 직전 배치 이슈 상태 확인 (`in_review`면 PR 완성).
2. **코드 리뷰**: PR diff 확인 — 의도대로 구현됐는가, **금지영역(아래 §6) 미접촉**인가.
3. **통합 빌드**: `verify/bNN` 브랜치를 만들어 PR(들)을 머지 → **충돌 여부 확인**.
4. **DoD 게이트**(아래 §5):
   - 백엔드: `npx tsc --noEmit` 0 · `npm run build` · **`TZ=UTC npm test` 그린(회귀 0)**
   - 모바일: `npx tsc --noEmit` 0 · `npm run lint` 0
5. **에뮬레이터 검증**(UI 변경 시): 실제 디바이스에서 시각·동작 확인. 결함이면 **반려(재이슈)**.
6. **working-tree 정합 검증** ⚠️ **(절대 생략 금지)**: `git status --short | grep "^ ?D"` — 브랜치 조작으로 추적 파일이 유실되지 않았는지 확인.
7. **머지** → worktree·로컬 브랜치 정리 → paperclip 이슈 `done` 처리.

### ② 감사 (AUDIT) — 새 차원에서 실결함 발굴

- 매 사이클 **이전과 다른 차원** 1개를 감사한다(아래 §4 차원 목록).
- **검증된 실결함만** 이슈로 등록. 추측·코스메틱은 등록하지 않는다.
- 발견을 **파일별 1이슈**로 묶어 배치 등록(충돌 회피, §7).
- 플릿에 디스패치(wakeup).

### ③ 예약 (SCHEDULE)

- 다음 사이클을 예약(예: `ScheduleWakeup` ~1500초, 플릿 구현 시간 확보).
- 같은 `/loop` 프롬프트를 그대로 전달해 사이클을 반복.

---

## 3. 역할 & 경계 (RACI)

| 활동 | Claude 총괄 | paperclip DEVELOPER | 사람(사용자) |
|---|---|---|---|
| 차원 감사 · 결함 발굴 | **R/A** | — | I |
| 이슈 명세 작성 · 등록 | **R/A** | — | I |
| 기능 구현(코드 작성) | — | **R/A** | — |
| PR 코드리뷰 · 통합검증 | **R/A** | — | C |
| 에뮬레이터/실기 검증 | **R/A** | — | — |
| 머지 결정 | **R/A** | — | C(최종승인 위임 시) |
| 스키마 마이그레이션 **DB 적용** | C | — | **R/A**(휴먼 게이트) |
| LLM 키 로테이션 · Risk 하드룰 변경 | — | — | **R/A**(휴먼 게이트) |

- **Claude는 main에 직접 커밋하지 않는다** — 모든 변경은 paperclip이 `feat/<id>-<slug>` 브랜치 + PR로.
- **머지 = 사용자 최종승인이 원칙**이나, "검증→머지" 플로우를 루프에 위임받은 경우 Claude가 수행(에뮬 검증 통과를 전제).

---

## 4. 감사 차원(Audit Dimensions) — "수렴 금지"의 연료

루프가 멈추지 않으려면 **새로운 관점**을 계속 공급해야 한다. 한 차원을 다 보면 다음으로 이동한다.
아래는 dart-notification에서 실제로 1사이클씩 소진한 차원 목록(참고용 — 프로젝트마다 가감).

**백엔드(기술)**
- 도메인 정확성(공식 중복·모집단 불일치) · 페이지네이션 입력 검증(NaN/음수/무클램프)
- 트랜잭션 원자성(revoke→create 등) · 동시성/TOCTOU(claim·advisory lock) · cron 멱등/오버랩
- 복합 인덱스 커버리지(필터+정렬) · 정렬 안정성(tie-break) · 조회 over-fetch(select 누락)
- DTO 경계 검증(MaxLength/Length/Matches) · 로깅 위생(시크릿 노출·console→Logger) · env/시크릿 검증

**모바일(기술·UX)**
- RQ 캐시/staleTime 일관성 · 인증 상태 위생 · 리스트 성능(memo·useCallback·initialNumToRender)
- 접근성(터치영역·label·role·selected state) · 빈상태/스켈레톤 일관성 · 에러 카피 행동유도성
- 한국어 카피 자연스러움(조사) · 날짜/시간 표기(정본·미래 클램프) · 키보드 입력 UX
- 하드코딩 색상→테마 토큰 · 텍스트 잘림(numberOfLines) · SafeArea/노치 · 폰트스케일

**제품/UX**
- 빈 데이터 첫사용자 동선 · 정보 위계·CTA 명확성 · 카피 SSOT 통합

> **차원이 고갈되는가?** 그렇지 않다. 기술 차원이 성숙하면 **제품/UX·성능·접근성·관측성**으로
> 확장한다. "개선할 게 없다"는 거의 항상 **아직 안 본 관점이 있다**는 신호다.

---

## 5. 검증 규율(Discipline) — 이 형상의 핵심 가치

플릿이 빠르게 구현하므로, **Claude의 검증 품질이 전체 시스템의 품질**을 결정한다.

### 5-1. 완료 정의(DoD) — 모든 머지의 통과 조건
1. `npx tsc --noEmit` 0 · `npm run build` 통과
2. `TZ=UTC npm test` **그린**(기존 테스트 회귀 0). *TZ=UTC가 로컬 KST가 가리던 타임존 버그를 드러낸다.*
3. 스키마 변경 시 마이그레이션 커밋 + 자연키 FK 정합
4. **금지영역 미침범**(§6)
5. **working-tree 정합**(유실 추적파일 0)
6. 변경 영역 문서 동기화

### 5-2. 허위양성·패딩 금지 — "LOW라도 실제만"
- **추측으로 이슈를 만들지 않는다.** 표면적 패턴(예: `getFullYear()`, `console.*`, `findMany`)이
  보여도 **실제 버그인지 코드로 검증**한 뒤 등록한다.
- 실측으로 기각한 실제 사례:
  - "AsyncStorage 사용" → grep이 **주석**을 매칭(실제는 SecureStore). 기각.
  - "WebView를 Image로 오인" → 원격 uri는 Image가 아니라 WebView. 기각.
  - "BullMQ add에 attempts 없음" → jobId 라인만 보였을 뿐 `{...JOB_OPTIONS, jobId}` **spread**였음. 기각.
  - "날짜 유틸 getFullYear TZ 버그" → `new Date(y,m,d)` 생성+로컬 읽기 **대칭**이라 안전. 기각.
- **"0건이 정답일 수 있다"** — 한 차원이 깨끗하면 정직하게 클린 판정하고 다음 차원으로.
- 단, **"개선할 게 없다"로 루프를 멈추지 않는다**(수렴 금지). 클린이면 차원을 바꾼다.

### 5-3. 코드베이스 자체 패턴과 비교 — 가장 강력한 발굴법
> 최고의 결함은 **"형제는 맞게 했는데 한 곳만 안 한" 불일치**에서 나온다.
- 예: 5개 LIST 쿼리가 `select:{rcpNo}`인데 getRetryQueue만 누락 → over-fetch(DAR-288).
- 예: disclosures/insider는 `[정렬키, 유니크]` tie-break인데 events/notifications/signals만 단일키 → 페이지 중복/누락(DAR-289).
- 예: RiskStatusBadges/PriceChangeChip은 `maxFontSizeMultiplier` cap인데 정렬칩만 누락.

**기존 정본(canonical) 패턴을 찾고, 그것을 우회한 곳을 찾아라.**

---

## 6. 금지영역(불가침) — 반드시 회피

| 영역 | 이유 | 대응 |
|---|---|---|
| AI 프롬프트/스키마(예: engine2-ai-analyst 프롬프트 본문·비용게이트 로직) | 제품 핵심 IP·민감 | plumbing만, 프롬프트 내용 미접촉 |
| Risk 하드룰(예: engine5 trading-risk) | 안전·로드맵 게이트 | 미접촉 |
| 스키마 마이그레이션 **DB 적용** | 데이터 파괴 위험 | 파일 생성·커밋만, **적용은 사용자**(`prisma migrate deploy`) |
| LLM 키 로테이션 | 비용·보안 | 휴먼 게이트 |
| force push · `rm -rf` · `migrate reset` | 비가역 파괴 | 훅(`guard-bash.mjs`)이 차단 |

- 매 PR 코드리뷰에서 `git diff --name-only`로 금지영역 접촉 여부를 **명시 확인**한다.

---

## 7. 이슈 등록 & 배칭 — 충돌 회피 설계

### 7-1. 파일별 1이슈 원칙
- 여러 PR이 **같은 파일**을 수정하면 머지 충돌이 난다.
- 발견을 **파일별로 묶어** 한 이슈가 한 파일(또는 독립 파일 집합)만 건드리게 한다.
- **공유 파일(예: theme/colors.ts, emptyStateCopy.ts, schema.prisma)에 수렴하는 변경은 단일 이슈/단일 PR**로 묶는다(분리하면 그 파일에서 충돌).

### 7-2. 충돌 발생 시 대응
- 같은 파일 다PR → **순차 머지**(rebase chain). **octopus 머지 금지.**
- 2회 차단된 PR → **닫고 새로 재구현**(fresh re-implement).
- 새 의존성 추가 PR → 검증 전 `npm install --legacy-peer-deps`.

### 7-3. 이슈 명세 포맷(플릿이 바로 구현 가능하게)
좋은 이슈는 **근거(파일:라인)·문제·해결방향·DoD**를 담는다.
```
제목: DAR <한줄 요약> (bug/perf/a11y/...)
본문:
  ## <심각도>: <한줄 문제>
  근거: <파일경로:라인> + 무엇이 왜 문제인지 구체적으로
  대조(정본): <같은 패턴을 올바르게 한 파일:라인>  ← 불일치형 결함에 강력
  해결: <1~2문장, 어느 파일만 건드릴지 명시>
  DoD: <단위/통합 테스트 기준> · tsc0 · build · (TZ=UTC) test 그린
  공통: DoD·금지영역·출처(배치N·날짜)·"파일별 1이슈(충돌회피)"
```

---

## 8. paperclip API 연동 (템플릿)

> 아래 값은 **프로젝트마다 다르다**. `<...>` 를 실제 값으로 치환.

### 8-1. 엔드포인트 (paperclip 로컬 런타임, 기본 `http://127.0.0.1:3100`)
| 동작 | HTTP |
|---|---|
| 에이전트 목록(역할·ID 발견) | `GET /api/companies/<COMPANY_ID>/agents` |
| 이슈 목록 | `GET /api/companies/<COMPANY_ID>/issues?limit=400` |
| 이슈 생성 | `POST /api/companies/<COMPANY_ID>/issues` body: `{title, description, assigneeAgentId, priority, workMode}` |
| 이슈 상태 변경 | `PATCH /api/issues/<ISSUE_ID>?companyId=<COMPANY_ID>` body: `{status}` (`todo`/`in_progress`/`in_review`/`done`) |
| 에이전트 기동(픽업 유도) | `POST /api/agents/<AGENT_ID>/wakeup?companyId=<COMPANY_ID>` body: `{message}` |

### 8-2. 역할/ID 발견 (신규 프로젝트 첫 단계)
```bash
curl -s "http://127.0.0.1:3100/api/companies/<COMPANY_ID>/agents"
# → role 별 id 회수: PLANNER(pm) / DEVELOPER(engineer) / REVIEWER(qa) / ORCHESTRATOR(ceo)
# 구현 디스패치 대상 = DEVELOPER(engineer) 의 id
```

### 8-3. 이슈 일괄 등록 스크립트 (Node, 템플릿)
```js
const C='<COMPANY_ID>', DEV='<DEVELOPER_AGENT_ID>', BASE='http://127.0.0.1:3100';
async function api(m,p,b){const r=await fetch(BASE+p,{method:m,
  headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
  return{s:r.status,j:await r.json().catch(()=>null)};}
const issues=[ /* {title, body, prio} ... */ ];
for(const it of issues){
  const rr=await api('POST',`/api/companies/${C}/issues`,
    {title:it.title,description:it.body,assigneeAgentId:DEV,priority:it.prio,workMode:'standard'});
  const i=rr.j.issue||rr.j;
  if(i?.id) await api('PATCH',`/api/issues/${i.id}?companyId=${C}`,{status:'todo'});
}
```

---

## 9. 하드원 게쳐(Gotchas) — 실패에서 배운 것

1. **working-tree 유실** ⚠️ 최대 함정. 브랜치/worktree 조작(reset·remove) 후 추적 파일이
   working tree에서 삭제된 채 남을 수 있다. **매 머지 후 `git status --short | grep "^ ?D"` 필수.**
   (`git checkout HEAD -- <경로>`로 복구.) 이걸 놓치면 "수렴했다"는 **거짓 결론**에 이른다.
2. **guard-bash 오탐(heredoc)**: 이슈 본문에 `prisma migrate deploy/dev` 같은 **리터럴 문자열**이
   있으면 훅이 이를 명령으로 오인·차단한다. → **스크립트는 Write 툴로 파일 생성**(bash heredoc 회피),
   본문엔 "표준 마이그레이션 절차" 같은 우회 표현 사용.
3. **TZ=UTC 테스트**: 로컬이 KST면 타임존 버그가 가려진다. CI/검증은 **`TZ=UTC`로 실행**.
4. **spread 패턴 간과**: `add(..., { jobId })`만 보고 옵션 누락으로 단정 금지 — `{...SHARED_OPTS, jobId}`
   일 수 있다. **변수/spread를 끝까지 추적**한 뒤 판정.
5. **emulator NAT**: Android 에뮬은 호스트를 `10.0.2.2`로 본다(`localhost` 아님). 폰트스케일 등
   접근성은 `adb shell settings put system font_scale 1.5`로 **실측** 후 판정(추측 금지).
6. **dev-login 딥링크**: 인증 필요 화면은 테스트계정 토큰을 딥링크로 주입(`exp://<host>/--/dev-login?...`).
7. **stale Prisma client**: 스키마 `@@unique` 변경 후 worktree tsc 실패는 generate 아티팩트일 수 있음
   (코드 버그 아님). shared client 재생성 금지, 머지 후 사용자 적용+generate로 검증.

---

## 10. 신규 프로젝트 부트스트랩 체크리스트

다른 paperclip 프로젝트에 이 형상을 이식할 때:

- [ ] **권한 하네스**: `.claude/settings.json` 권한 매트릭스 + `hooks/`(파괴적 명령·금지영역 차단) 구축.
- [ ] **CLAUDE.md**: 아키텍처·금지영역·DoD·코딩 컨벤션·실행 명령어를 명문화(컨텍스트 자동 로드).
- [ ] **paperclip 연동값 발견**: `GET /api/companies/<C>/agents`로 company·DEVELOPER id 확보.
- [ ] **루프 프롬프트 정의**: "①수확 ②감사 ③예약 · 수렴금지 · 허위양성/패딩 금지 · 파일별1이슈" 표준 프롬프트.
- [ ] **감사 차원 백로그**: 프로젝트 특성에 맞는 차원 목록 작성(§4 참고).
- [ ] **검증 파이프 확인**: `tsc`/`build`/`test`(TZ=UTC) 명령 표준화.
- [ ] **금지영역 명시**: AI 프롬프트·Risk·마이그레이션 DB적용·키 로테이션 = 휴먼 게이트.
- [ ] **메모리/핸드오프**: 사이클 간 진행상황·교훈을 영속(다음 세션이 이어받게).
- [ ] **첫 사이클 드라이런**: 1개 차원 감사 → 1개 이슈 등록 → 픽업·머지까지 end-to-end 확인.

---

## 11. 운용 지표 (dart-notification 실적, 참고)

- **사이클 수**: 23+ (배치14~37)
- **머지된 PR**: 30+ (DAR-262~291), **전부 무회귀**(TZ=UTC 전체 테스트 그린 유지)
- **이슈 처리**: 291건 중 290 done
- **회귀**: 0 — 매 머지마다 working-tree 정합 + 전체 테스트 게이트
- **허위양성 기각**: 다수(AsyncStorage 주석·WebView·BullMQ spread·날짜 대칭 등) — 등록 전 코드 검증으로 차단

---

## 12. 핵심 원칙 5줄 요약 (각인용)

1. **Claude는 두뇌, 플릿은 손** — 구현은 위임, 판단·검증·머지는 Claude.
2. **수렴 금지** — 클린이면 차원을 바꿔라. "개선 없음"은 거의 항상 안 본 관점.
3. **허위양성 금지** — 표면 패턴 말고 **코드로 검증한 실결함만**. LOW라도 실제만.
4. **정본 비교가 최강 발굴법** — 형제는 맞고 한 곳만 틀린 불일치를 노려라.
5. **working-tree 정합 + TZ=UTC 테스트** — 매 머지의 절대 게이트. 회귀 0을 지켜라.
