# DART 공시 알림 서비스 - Claude Code 지침

## 프로젝트 개요

DART 공시 실시간 알림 모바일 앱 (React Native Expo + NestJS)
- 모든 UI 텍스트는 **한국어**로 작성
- 제품 방향: 공시 알림 → 투자판단·포트폴리오·(제한적)자동매매. SSOT: `docs/roadmap/00-vision-and-principles.md`, 실행 순서: `docs/roadmap/01-execution-roadmap.md`(M0~M12)

## 아키텍처: DDD 도메인 구조 (필수 준수)

코드는 **도메인(Bounded Context) 단위**로 묶는다. 기능 모듈을 평면 나열하지 않는다.
백엔드는 **5개 엔진**으로 분리한다 (정본: `docs/roadmap/cc-engine-architecture.md §4-1`).

| 도메인 폴더 (`backend/src/`) | 책임 | 마일스톤 | 상태 (2026-07-02) |
|---|---|---|---|
| `engine1-disclosure/` | 공시 수집·파싱·이벤트추출 | M0~M2 | ✅ 완료·prod 가동 |
| `engine2-ai-analyst/` | 4 AI Task·비용게이트(L0~L3)·`AIUsageLog` | M3 | ✅ 완료 (SMOKE_LLM 상시 라이브만 미가동) |
| `engine3-quant-market/` | 시세·지표·Event Study·Buy Score | M4~M6,M9 | ✅ 완료 (KIS/KRX·백테스트 포함) |
| `engine4-portfolio-exit/` | 포트폴리오·포지션·Exit Score | M7~M8 | ✅ 완료 |
| `engine5-trading-risk/` | Risk 하드룰·모의/실주문 | M11~M12 | 🚧 Risk 하드룰·모의매매 완료, 실주문 루프(OrderRequest) 미연동 |
| 횡단(독립) | auth·users·companies·watchlist·notifications·notification-settings·expo-push·devices·saved-disclosures·search·collection-status·cron-health·ops·storage-ops·prisma·common | 전 구간 | — |

> 현재 위치: M0~M9 완료, M10 모의운용 진행 중(졸업 게이트: `docs/roadmap/cc-mvp-definition.md` §9), M11 이후 미착수. 재개 계획 정본: `docs/roadmap/cc-resume-plan-2026-07-02.md`

**도메인 구축 규칙 (점진적·지속):**
- 새 마일스톤 착수 시 해당 `engineN-*/` 폴더를 만들고, **그 폴더에 `CLAUDE.md`(도메인 규칙 + 담당 마일스톤 로드맵 발췌)를 반드시 동반**한다.
- 컨텍스트 계층화: 작업 디렉터리에서 가장 가까운 `CLAUDE.md`가 자동 로드된다. 현재 존재: `backend/`, `backend/prisma/`, `mobile/`, `backend/src/engine1-disclosure/`~`engine5-trading-risk/` (5엔진 전부).
- 엔진 간 통신은 BullMQ 큐 + DB. 엔진끼리 서비스 직접 호출 최소화.
- 런타임 `@/` alias는 미등록 → **상대경로 import** 사용.

## 멀티에이전트 하네스 & 검증 절차

**권한 경계(`.claude/`):** `settings.json` 권한 매트릭스 + 훅(`hooks/guard-bash.mjs`, `hooks/risk-guard.mjs`)이 파괴적 명령과 **AI 금지영역**을 코드로 차단한다. `git push`·`prisma migrate`는 휴먼 승인(ask), `prisma migrate reset`·force push·`rm -rf`는 차단(deny).

**서브에이전트 = 컨텍스트 방화벽(`.claude/agents/`):** 긴 작업의 세부 단위를 격리된 컨텍스트의 서브에이전트에 위임하고 결과만 회수한다. 역할별 에이전트는 조직도가 아니라 **위임 단위 + 도구(권한) 경계**다.
- `be-engineer` — 백엔드 도메인 구현 / `ai-prompt-engineer` — Engine2 프롬프트·스키마·비용 / `fe-engineer` — 모바일 / `qa-verifier` — 검증(읽기전용)

**검증 절차 (DoD — 모든 구현/위임 완료 조건):**
1. `npx tsc --noEmit` 에러 0 · `npm run build` 통과
2. `npm test`(jest) **그린** — 기존 테스트 회귀 없음
3. 스키마 변경 시 마이그레이션 커밋(`backend/prisma/CLAUDE.md`) + 자연키(rcpNo/corpCode) FK 정합
4. **AI 금지영역 미침범** (Engine5 Risk 독립) · AI 사용 시 `AIUsageLog` 기록 누락 0
5. 변경 영역 문서 동기화 (아래 "문서 자동 업데이트 규칙")
6. 매 마일스톤 종료 시 ↩︎ 이전단계 회귀 + 전역 회귀 매트릭스(`01-execution-roadmap.md §3`) 점검

**paperclip AI 멀티에이전트 하네스 (외부 오케스트레이션 툴):** `.agents/`(ORCHESTRATOR/PLANNER/DEVELOPER/REVIEWER) + `harness/`(VERIFICATION·KNOWN_FAILURES·ENTROPY_CHECK·tools) + `AGENTS.md`(브랜치/PR/worktree/통지 규약). Claude Code 네이티브 `.claude/agents/`(be/fe/ai/qa-verifier)와는 별개 레이어로 **공존**한다 — 전자는 paperclip이, 후자는 Claude Code가 읽는다.

**토큰 규율 (모든 에이전트 공통):**
- 작업에 필요한 컨텍스트만 로드. 저장소 통째 로드 금지. 이미 로드한 파일 재로드 금지 — 경로 참조로 전달.
- 서브에이전트는 **최종 산출물만** 반환(중간 탐색 반환 금지).
- 출력 압축(caveman/전보체)은 **버려지는 내부 추론에만** 허용. 전달·보존 산출물(명세/증거/판정/영구 `.md`)은 평문 유지.

**작업 흐름:** 작업 단위 = GitHub Issue 1건. **main 직접 커밋 금지** → `feat/<issue-id>-<slug>` 브랜치 + PR. 코드 편집 에이전트는 격리 worktree에서 작업. 권한 경계: Planner/Reviewer는 `docs/`만 수정(코드 금지), Prisma 스키마 변경은 직렬 처리. 완료는 주장이 아니라 **증거**(`harness/VERIFICATION.md` 6대 증거 첨부). 상세 규약: `AGENTS.md`.

## 기술 스택 & 규칙

### 패키지 매니저
- **npm** 사용 (pnpm, yarn 사용 금지)
- 설치 시 `--legacy-peer-deps` 플래그 필수

### 모바일 (Expo)
- **UI**: React Native Paper + StyleSheet (NativeWind/Tailwind 사용 금지)
- **네비게이션**: Expo Router
- **상태관리**: React Query (서버) + Zustand (클라이언트)
- **저장소**: expo-secure-store (AsyncStorage 사용 금지 - Expo Go 미지원)
- **테마**: Teal 기반, `theme/colors.ts`의 `lightColors`/`darkColors`
- **Path alias**: `@components`, `@theme`, `@hooks`, `@services`, `@stores`, `@app-types` (NOT `@types`), `@utils`
- **아이콘**: Feather (thin stroke) 선호, Ionicons 지양

### 백엔드 (NestJS)
- **ORM**: Prisma + PostgreSQL
- **인증**: Kakao OAuth (JWT Access + Refresh Token)
- **API 문서**: Swagger (`/api/docs`)

## 실행 명령어

```bash
# DB
docker-compose -f docker-compose.dev.yml up -d

# 백엔드
cd backend && npm run start:dev

# 모바일
cd mobile && npx expo start

# DB 마이그레이션
cd backend && npx prisma migrate dev
```

## 코딩 컨벤션

- 컴포넌트 파일명: PascalCase (`Button.tsx`)
- 서비스/훅 파일명: camelCase (`auth.service.ts`, `useAuth.ts`)
- 상수: UPPER_SNAKE_CASE
- Import 순서: 외부 라이브러리 → Path alias → 타입
- 커밋 메시지: `<type>(<scope>): <한국어 설명>` (feat, fix, docs, refactor 등)

## React Native 베스트 프랙티스

### 컴포넌트 설계
- **함수형 컴포넌트만** 사용 (class 컴포넌트 금지)
- **Props 인터페이스** 반드시 정의 (`interface ButtonProps { ... }`)
- **variant/size 패턴** 사용하여 컴포넌트 유연성 확보
- 재사용 컴포넌트는 `components/common/`에 배치
- 화면 전용 컴포넌트는 해당 화면 폴더 내에 배치
- `any` 타입 사용 금지 — 명시적 타입 또는 제네릭 사용

### 성능 최적화
- **긴 리스트**: `ScrollView` 대신 `FlatList` 또는 `FlashList` 사용 필수
- **FlatList 필수 props**: `keyExtractor`, `getItemLayout`(가능 시), `initialNumToRender`
- **React.memo**: 부모 리렌더 시 불필요하게 리렌더되는 자식 컴포넌트에 적용
- **useCallback**: 자식 컴포넌트에 전달하는 함수에 적용 (특히 FlatList `renderItem`)
- **useMemo**: 비용이 큰 계산/필터링/정렬 결과에 적용
- **이미지 최적화**: `expo-image` 사용 권장 (캐싱, WebP 지원)
- **인라인 객체 지양**: `style={{ margin: 10 }}` 대신 `StyleSheet.create()` 사용
- **인라인 함수 지양**: `onPress={() => navigate(id)}` 대신 useCallback으로 분리

### 스타일링 규칙
- **StyleSheet.create()** 컴포넌트 파일 하단에 정의
- **테마 토큰 사용 필수**: 하드코딩된 색상값(`#xxx`) 금지 → `colors.ts` 토큰 사용
- **매직 넘버 금지**: spacing, radius 등 `theme/` 토큰 사용
- 동적 스타일은 배열 합성 패턴 사용: `style={[styles.base, { color: colors.primary }]}`
- `Platform.select()` 또는 `Platform.OS`로 플랫폼별 스타일 분기

### 상태 관리 규칙
- **서버 상태**: React Query (`useQuery`, `useMutation`, `useInfiniteQuery`)
- **클라이언트 상태**: Zustand (인증, 설정 등 영속 상태)
- **로컬 UI 상태**: `useState` (모달 열림, 입력값 등)
- React Query와 Zustand를 혼용하지 않기 — 서버 데이터를 Zustand에 복제 금지
- `queryKey` 컨벤션: `[entity, ...params]` (예: `['disclosures', page, filter]`)

### React Query 사용 규칙
- **모든 API 호출**은 React Query 훅으로 래핑 (`hooks/` 폴더에 배치)
- 컴포넌트에서 직접 `axios`/`fetch` 호출 금지 → 반드시 커스텀 훅 사용
- **읽기**: `useQuery` / `useInfiniteQuery` (페이지네이션)
- **쓰기**: `useMutation` + `onSuccess`에서 `queryClient.invalidateQueries()` 호출
- **낙관적 업데이트**: 빠른 UX가 필요한 경우 `onMutate`에서 캐시 직접 수정
- **staleTime**: 자주 변하지 않는 데이터는 충분히 길게 설정 (예: 기업 정보 30분)
- **enabled 옵션**: 조건부 fetching에 활용 (예: `enabled: query.length >= 2`)
- **select 옵션**: 서버 응답에서 필요한 데이터만 추출하여 리렌더 최소화
- **에러/로딩 상태**: `isLoading`, `isError`, `error` 활용하여 UI 분기 처리
- **서비스 레이어 분리**: `services/` 폴더에 API 호출 함수, `hooks/`에서 React Query로 래핑

### 에러 처리 & 안전성
- API 호출 훅에서 `onError` 콜백으로 사용자 피드백 제공
- 네트워크 에러 시 적절한 fallback UI 표시 (빈 상태, 재시도 버튼)
- **Optional chaining** 적극 사용 (`data?.items?.length`)
- 환경 변수는 `.env`에서 관리, 코드에 하드코딩 금지

### 접근성 (a11y)
- 터치 영역 최소 44x44pt (`hitSlop` 또는 패딩으로 확보)
- 의미 있는 `accessibilityLabel` 추가 (아이콘 버튼, 이미지 등)
- `accessibilityRole` 적절히 지정 (`button`, `link`, `header` 등)

### 네비게이션 규칙
- Expo Router 파일 기반 라우팅 준수
- 인증 가드는 루트 `_layout.tsx`에서 처리
- 화면 간 데이터 전달: route params (간단한 값) 또는 React Query 캐시 (복잡한 객체)
- `router.push()` vs `router.replace()` 구분 — 뒤로가기 불필요 시 `replace`

### 린트 & 포맷팅
- ESLint + Prettier 적용 (`npm run lint`로 검증)
- 커밋 전 린트 통과 필수

## 문서 자동 업데이트 규칙

**코드 변경 시 관련 문서를 반드시 함께 업데이트할 것.**

작업 완료 후 아래 문서들을 확인하고, 변경사항과 관련된 문서가 있으면 최신 상태로 갱신한다:

| 변경 영역 | 업데이트 대상 문서 |
|-----------|-------------------|
| DB 스키마 (Prisma) 변경 | `docs/database-schema.md` |
| API 엔드포인트 추가/수정 | `docs/api-specification.md` |
| 시스템 구조 변경 | `docs/architecture.md` |
| 배치/스케줄러 변경 | `docs/workflow.md` |
| 배포 설정 변경 | `docs/deployment.md` |
| 새 모듈/화면 추가 | `PROJECT_STRUCTURE.md` |
| 기능 완료/추가 | `NEXT_STEPS.md`, `docs/roadmap/01-execution-roadmap.md`(마일스톤 상태) |
| 실행 방법 변경 | `QUICK_START.md` |
| 주요 변경 사항 | `README.md` (해당 시) |

- 문서의 "최종 수정일" 또는 "마지막 업데이트" 날짜도 갱신
- 새 파일/폴더가 추가되면 `PROJECT_STRUCTURE.md`의 트리 구조 업데이트
- 완료된 작업은 `NEXT_STEPS.md`에서 체크 표시 `[x]`로 변경
