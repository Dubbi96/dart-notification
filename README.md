# DART 공시 알림 서비스 (MVP)

## 프로젝트 개요

개인 투자자가 관심 기업의 DART 공시를 실시간으로 받아볼 수 있는 모바일 알림 서비스

## 핵심 가치

- 관심 기업의 공시를 놓치지 않음
- 조건에 맞는 공시만 선별하여 알림
- 공시 원문을 빠르게 확인 가능

## 기술 스택

### Backend
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL 15+ (Docker)
- **ORM**: Prisma
- **Authentication**: 카카오 OAuth (JWT Access + Refresh Token)
- **API 문서**: Swagger (`/api/docs`)
- **Scheduler**: @nestjs/schedule (node-cron) - 구현 예정
- **Push Notification**: Expo Push Notifications - 구현 예정

### Mobile
- **Framework**: React Native (Expo)
- **Navigation**: Expo Router
- **State Management**: React Query + Zustand
- **UI**: React Native Paper + StyleSheet (커스텀 테마)
- **Theme**: Teal 기반 커스텀 테마 (다크모드 준비됨)

### Infrastructure
- **Package Manager**: npm
- **Database**: Docker Compose (PostgreSQL)
- **CI/CD**: GitHub Actions (예정)

## 프로젝트 구조

```
dart-notification/
├── backend/                 # NestJS 백엔드
│   ├── src/
│   │   ├── auth/           # 카카오 OAuth 인증
│   │   ├── users/          # 사용자 관리
│   │   ├── watchlist/      # 관심 기업 관리
│   │   ├── disclosures/    # 공시 데이터
│   │   ├── notifications/  # 알림 발송
│   │   ├── devices/        # 푸시 토큰 관리
│   │   ├── scheduler/      # 공시 수집 배치
│   │   └── companies/      # 기업 마스터 데이터
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
├── mobile/                  # React Native 앱
│   ├── app/                # Expo Router 기반 화면
│   ├── components/         # 재사용 컴포넌트 (Button, Card, Input, GlassCard 등)
│   ├── services/           # API 클라이언트
│   ├── hooks/              # Custom Hooks
│   ├── stores/             # Zustand 스토어
│   ├── theme/              # 테마 (colors, spacing, typography)
│   └── package.json
├── docs/                    # 설계 문서
├── docker-compose.dev.yml
└── README.md
```

## MVP 범위 (1차)

### 포함 기능
- 카카오 소셜 로그인 (OAuth)
- 관심 기업 등록/삭제 (최대 30개, 자동완성 검색)
- 공시 유형 선택 (5개: 정기공시, 주요사항보고, 발행공시, 지분공시, 기타공시)
- 키워드 매칭 (관심 기업의 공시 중 키워드 포함된 것만)
- 알림 on/off 토글
- DART API 기반 공시 자동 수집 (10분 주기)
- 조건 매칭 및 푸시 알림 발송
- 알림 히스토리 조회 및 읽음 처리
- 공시 목록/상세 조회, DART 원문 링크
- Deep Link (푸시 클릭 시 공시 상세로 이동)

### 제외 기능 (1차에서 구현 안 함)
- AI 3줄 요약, 중요도 판단, 핵심 수치 추출
- 이메일/카카오톡 알림, 북마크, 공시 비교
- 웹 지원 (모바일만)
- 통계 대시보드, 프리미엄 기능, 커뮤니티

## 시작하기

### 필수 요구사항
- Node.js 20+
- npm
- Docker & Docker Compose
- Expo CLI
- 카카오 개발자 계정 (OAuth 앱 등록)

### 설치 및 실행

#### 1. 데이터베이스 실행
```bash
docker-compose -f docker-compose.dev.yml up -d
```

#### 2. 환경 변수 설정
```bash
# backend/.env
DATABASE_URL="postgresql://user:password@localhost:5432/dart_notification"
JWT_SECRET="your-secret-key"
JWT_REFRESH_SECRET="your-refresh-secret-key"
DART_API_KEY="your-dart-api-key"
KAKAO_CLIENT_ID="your-kakao-rest-api-key"
KAKAO_REDIRECT_URI="http://localhost:3000/auth/kakao/callback"
```

#### 3. 백엔드 실행
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
# Swagger 문서: http://localhost:3000/api/docs
```

#### 4. 모바일 앱 실행
```bash
cd mobile
npm install
npx expo start
```

## 문서

- [시스템 아키텍처](./docs/architecture.md)
- [데이터베이스 스키마](./docs/database-schema.md)
- [API 명세서](./docs/api-specification.md)
- [업무 흐름도](./docs/workflow.md)
- [배포 가이드](./docs/deployment.md)
- [개발 계획](./docs/development-plan.md)

## 개발 일정

- **Week 1**: 백엔드 기본 구조, DB 스키마, 카카오 OAuth 인증 -- 완료
- **Week 2**: 공시 수집/저장, 관심 목록, 매칭 로직 -- 모듈 스캐폴딩 완료, 스케줄러 미구현
- **Week 3**: 모바일 앱 화면 개발 -- 대부분 완료, 푸시/딥링크 미구현
- **Week 4**: 통합 테스트, 버그 수정, 배포 준비 -- 미착수

## 라이선스

MIT
