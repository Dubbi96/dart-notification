# DART 공시 알림 서비스 - Claude Code 지침

## 프로젝트 개요

DART 공시 실시간 알림 모바일 앱 (React Native Expo + NestJS)
- 모든 UI 텍스트는 **한국어**로 작성

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
| 기능 완료/추가 | `NEXT_STEPS.md`, `docs/development-plan.md` |
| 실행 방법 변경 | `QUICK_START.md` |
| 주요 변경 사항 | `README.md` (해당 시) |

- 문서의 "최종 수정일" 또는 "마지막 업데이트" 날짜도 갱신
- 새 파일/폴더가 추가되면 `PROJECT_STRUCTURE.md`의 트리 구조 업데이트
- 완료된 작업은 `NEXT_STEPS.md`에서 체크 표시 `[x]`로 변경
