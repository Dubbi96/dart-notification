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
