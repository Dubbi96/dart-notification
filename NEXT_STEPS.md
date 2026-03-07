# 다음 단계 (2026-03-08 기준)

## 완료된 작업

### 프로젝트 문서
- [x] README.md, QUICK_START.md, NEXT_STEPS.md
- [x] docs/architecture.md, database-schema.md, api-specification.md
- [x] docs/workflow.md, deployment.md, development-plan.md
- [x] PROJECT_STRUCTURE.md

### 백엔드 (NestJS)
- [x] NestJS 프로젝트 생성 및 설정
- [x] Prisma 스키마 작성 (User, Company, WatchList, Disclosure, NotificationHistory 등)
- [x] Docker Compose PostgreSQL 실행
- [x] 마이그레이션 생성 및 적용
- [x] 환경 변수 설정
- [x] Auth 모듈 - 카카오 OAuth 로그인 (POST /auth/kakao, GET /auth/kakao/callback, GET /auth/kakao/result)
- [x] JWT 전략 및 Guard (Access + Refresh Token)
- [x] Users 모듈 (GET /users/me, PATCH /users/me)
- [x] Devices 모듈 (POST /devices/register, DELETE /devices/:id)
- [x] Companies 모듈 (GET /companies/search, GET /companies/:corpCode)
- [x] WatchList 모듈 (GET/POST/DELETE /watchlist)
- [x] Notification Settings 모듈
- [x] Disclosures 모듈 (GET /disclosures, GET /disclosures/:id)
- [x] Notifications 모듈 스캐폴딩
- [x] Scheduler 모듈 스캐폴딩
- [x] Swagger 문서 설정 (/api/docs)
- [x] User 모델에 provider/providerId 필드 추가 (소셜 로그인용, password optional)

### 모바일 (React Native Expo)
- [x] Expo 프로젝트 생성 및 설정
- [x] Expo Router 탭 네비게이션 (홈, 알림, 설정)
- [x] Teal 기반 커스텀 테마 시스템 (lightColors/darkColors, ThemeContext)
- [x] 다크모드 준비 (useAppColorScheme + settingsStore.colorSchemeOverride)
- [x] React Native Paper 통합 (PaperProvider, Switch, Checkbox, Divider)
- [x] 커스텀 컴포넌트: Button, Card, Input (비밀번호 토글), Loading, GlassCard
- [x] Path aliases 설정 (@components, @theme, @hooks, @services, @stores, @app-types, @utils)
- [x] API 클라이언트 (Axios) 설정
- [x] Zustand 스토어 (authStore, settingsStore)
- [x] React Query Provider 설정
- [x] 카카오 OAuth 로그인 화면 (WebBrowser + polling 방식)
- [x] 홈 화면 (공시 목록)
- [x] 알림 히스토리 화면
- [x] 설정 화면
- [x] 관심 기업 관리 화면
- [x] 알림 설정 화면
- [x] 공시 상세 화면
- [x] 전체 UI 한국어

---

## 남은 작업

### 1순위: 핵심 기능 구현

#### 기업 마스터 데이터
- [ ] DART API에서 기업 목록 가져오기 (시드 스크립트)
- [ ] XML 파싱 및 DB 저장
- [ ] `npx prisma db seed` 실행

#### DART 공시 수집
- [ ] DART API Service 구현 (공시 목록 조회, XML/JSON 파싱)
- [ ] Scheduler 구현 (10분 주기 공시 수집)
- [ ] 중복 체크 (rcpNo 기준)
- [ ] 공시 유형 분류 로직

#### 알림 매칭 및 발송
- [ ] 사용자 매칭 쿼리 (관심 기업 + 공시 유형 + 키워드)
- [ ] 중복 알림 방지 로직
- [ ] NotificationHistory 생성
- [ ] Expo Push Service 구현 (sendPushNotification, 배치 발송)

### 2순위: 모바일 추가 기능

- [ ] CompanySearchModal 컴포넌트 (자동완성, debounce)
- [ ] 푸시 알림 설정 (Expo Notifications 권한 요청, Push Token 등록)
- [ ] Deep Link 처리 (알림 클릭 -> 공시 상세)
- [ ] 온보딩 화면 (관심 기업 1개 이상 등록 유도)

### 3순위: 추가 인증

- [ ] Google OAuth 로그인 추가

### 4순위: 테스트 및 배포 (Week 4)

#### 테스트
- [ ] 단위 테스트 (Jest) - AuthService, WatchlistService 등
- [ ] E2E 테스트
- [ ] 수동 테스트 (전체 플로우)

#### 최적화 및 보안
- [ ] Rate Limiting (NestJS Throttler)
- [ ] Helmet 미들웨어
- [ ] CORS 설정
- [ ] DB 쿼리 최적화 (인덱스, N+1)
- [ ] 모바일 번들 사이즈 최적화

#### 배포
- [ ] Docker 이미지 빌드
- [ ] Staging 환경 배포
- [ ] 모바일 앱 Internal Build (EAS)

---

## 필수 계정 및 API 키

### 1. DART Open API
- **URL**: https://opendart.fss.or.kr
- **환경 변수**: `DART_API_KEY`

### 2. 카카오 개발자
- **URL**: https://developers.kakao.com
- **환경 변수**: `KAKAO_CLIENT_ID`, `KAKAO_REDIRECT_URI`

### 3. Expo Account
- **URL**: https://expo.dev
- **환경 변수**: `EXPO_PUSH_ACCESS_TOKEN`

---

**마지막 업데이트**: 2026-03-08
