# 개발 계획 (4주 일정)

> **변경 사항 (2026-03-08)**: 인증 방식이 이메일/비밀번호에서 **카카오 OAuth**로 변경됨.
> 패키지 매니저는 **npm** 사용. UI는 NativeWind 대신 **React Native Paper + StyleSheet** 사용.

## 전체 일정 개요

| 주차 | 주요 작업 | 상태 |
|------|----------|------|
| **Week 1** | 백엔드 기본 구조, DB 스키마, 카카오 OAuth 인증 | 완료 |
| **Week 2** | 공시 수집/저장, 관심 목록, 매칭 로직 | 모듈 스캐폴딩 완료, 스케줄러/DART API 미구현 |
| **Week 3** | 모바일 앱 화면 개발 | 대부분 완료, 푸시/딥링크 미구현 |
| **Week 4** | 통합 테스트, 버그 수정, 배포 준비 | 미착수 |

---

## Week 1: 백엔드 기본 구조 및 인증

### Day 1: 프로젝트 초기 설정

**백엔드**:
- [x] NestJS 프로젝트 생성
- [x] Prisma 설정
- [x] 환경 변수 설정 (.env)
- [x] Docker Compose 설정 (PostgreSQL)
- [x] ESLint, Prettier 설정

**모바일**:
- [x] Expo 프로젝트 생성
- [x] 필수 라이브러리 설치 (React Query, Zustand, Axios, React Native Paper 등)
- [x] 테마 설정 (Teal 기반 커스텀 테마, StyleSheet)

---

### Day 2-3: DB 스키마 및 Prisma 설정

**백엔드**:
- [x] Prisma Schema 작성 (User, UserDevice, Company, WatchList, NotificationSettings, Disclosure, NotificationHistory)
- [x] User 모델에 provider/providerId 필드 추가 (소셜 로그인, password optional)
- [x] 마이그레이션 생성 및 실행
- [ ] 기업 마스터 데이터 시드 스크립트 작성 (DART API 호출)
- [ ] 시드 실행

---

### Day 4-5: 인증 모듈 구현

> **변경**: 이메일/비밀번호 인증 대신 카카오 OAuth 구현

**백엔드**:
- [x] Auth Module 생성
- [x] 카카오 OAuth 엔드포인트 구현
  - `POST /auth/kakao` - 카카오 로그인 시작
  - `GET /auth/kakao/callback` - 카카오 콜백 처리
  - `GET /auth/kakao/result` - 로그인 결과 polling
- [x] JWT 전략 구현 (JwtStrategy, JwtAuthGuard)
- [x] Access Token + Refresh Token 발급
- [x] Swagger 문서 설정 (/api/docs)

---

### Day 6-7: Users 및 Devices 모듈

**백엔드**:
- [x] Users Module
  - `GET /users/me` - 현재 사용자 조회
  - `PATCH /users/me` - 프로필 수정
- [x] Devices Module
  - `POST /devices/register` - 디바이스 등록
  - `DELETE /devices/:id` - 디바이스 삭제

**모바일**:
- [x] API 클라이언트 설정 (Axios)
- [x] 카카오 OAuth 로그인 화면 (WebBrowser + polling)
- [x] Zustand 스토어 (authStore, settingsStore)
- [x] React Query 설정
- [x] Path aliases 설정 (@components, @theme, @hooks, @services, @stores, @app-types, @utils)

---

## Week 2: 공시 수집 및 알림 로직

### Day 8-9: Companies 및 WatchList 모듈

**백엔드**:
- [x] Companies Module
  - `GET /companies/search?query=삼성` - 기업 검색 (자동완성)
  - `GET /companies/:corpCode` - 기업 상세
- [x] WatchList Module
  - `GET /watchlist` - 관심 기업 목록
  - `POST /watchlist` - 관심 기업 등록
  - `DELETE /watchlist/:id` - 관심 기업 삭제
  - 최대 30개 제한 검증

---

### Day 10-11: Notification Settings 및 Disclosures 모듈

**백엔드**:
- [x] Notification Settings Module
  - `GET /notification-settings` - 알림 설정 조회
  - `PATCH /notification-settings` - 알림 설정 수정
- [x] Disclosures Module
  - `GET /disclosures` - 공시 목록 (페이징)
  - `GET /disclosures/:rcpNo` - 공시 상세

---

### Day 12-13: DART API 통합 및 Scheduler

**백엔드**:
- [ ] DART API Service 작성
  - Axios 인스턴스 생성
  - Retry 로직 (axios-retry)
  - `getDisclosures()` - 공시 목록 조회
  - XML/JSON 파싱
  - 공시 유형 분류 로직
- [ ] Scheduler 구현
  - `collectDisclosures()` - 공시 수집 (10분마다)
  - DART API 호출, 중복 체크 (rcpNo), 신규 공시 저장
  - `cleanupExpiredTokens()` - 만료 토큰 정리 (매일 자정)

> **참고**: Scheduler 모듈은 스캐폴딩만 완료, 실제 로직 미구현

---

### Day 14: 알림 매칭 및 발송 로직

**백엔드**:
- [ ] 사용자 매칭 쿼리 작성 (관심 기업 + 공시 유형 + 키워드)
- [ ] 중복 알림 방지 로직
- [ ] NotificationHistory 생성
- [ ] Expo Push Service
  - `sendPushNotification()` 구현
  - 배치 발송 (최대 100개)
  - 에러 처리 (DeviceNotRegistered)

> **참고**: Notifications 모듈은 스캐폴딩만 완료, 실제 로직 미구현

---

## Week 3: 모바일 앱 개발

### Day 15-16: 홈 화면 및 공시 목록

**모바일**:
- [x] 홈 화면 (`app/(tabs)/home/index.tsx`)
  - 최근 공시 목록 표시
  - 공시 카드 컴포넌트
- [x] 공시 상세 화면
  - 공시 정보 표시
  - DART 원문 링크

---

### Day 17-18: 설정 화면 및 관심 목록

**모바일**:
- [x] 설정 화면 (`app/(tabs)/settings/index.tsx`)
  - 프로필 정보
  - 관심 기업 관리 버튼
  - 알림 설정 버튼
  - 로그아웃
- [x] 관심 기업 화면
  - 관심 기업 목록
  - 추가/삭제 기능
- [ ] CompanySearchModal 컴포넌트 (자동완성, debounce) - 미구현

---

### Day 19-20: 알림 설정 및 히스토리

**모바일**:
- [x] 알림 설정 화면
  - 알림 on/off 토글
  - 공시 유형 체크박스
  - 키워드 입력
- [x] 알림 히스토리 화면 (`app/(tabs)/notifications/index.tsx`)
  - 알림 목록
  - 읽음/안 읽음 표시

---

### Day 21: 푸시 알림 및 Deep Link

**모바일**:
- [ ] 푸시 알림 설정 (Expo Notifications, 권한 요청, Push Token 등록)
- [ ] Deep Link 처리 (알림 클릭 -> 공시 상세)
- [ ] 온보딩 화면 (관심 기업 등록 유도)

---

## Week 4: 통합 테스트 및 배포

### Day 22-23: 통합 테스트

**백엔드**:
- [ ] 단위 테스트 작성 (Jest)
- [ ] E2E 테스트 작성

**모바일**:
- [ ] 수동 테스트 (전체 플로우)
- [ ] 버그 수정

---

### Day 24-25: 성능 최적화 및 보안

**백엔드**:
- [ ] Rate Limiting 적용 (NestJS Throttler)
- [ ] Helmet 미들웨어 적용
- [ ] CORS 설정
- [ ] DB 쿼리 성능 확인 (인덱스, N+1 문제)

**모바일**:
- [ ] 번들 사이즈 최적화
- [ ] 오프라인 대응

---

### Day 26-27: 문서화 및 배포 준비

- [ ] API 문서 정리 (Swagger 이미 설정됨)
- [ ] Docker 이미지 빌드 테스트
- [ ] Staging 환경 배포
- [ ] 모바일 앱 Internal Build (EAS)

---

### Day 28: 최종 점검 및 MVP 배포

- [ ] 보안 체크리스트 확인
- [ ] 기능 체크리스트 확인
- [ ] 프로덕션 배포

---

## 리스크 관리

| 리스크 | 영향 | 완화 전략 |
|--------|------|----------|
| **DART API 불안정** | 높음 | Retry 로직, 에러 로깅, 대체 API 조사 |
| **푸시 알림 발송 실패** | 중간 | 토큰 만료 처리, 재시도 로직, 로그 모니터링 |
| **DB 성능 저하** | 중간 | 인덱스 최적화, 쿼리 튜닝, 페이징 |
| **카카오 OAuth 정책 변경** | 중간 | Google OAuth 추가 예정, 멀티 소셜 로그인 대응 |

---

## 다음 단계 (MVP 이후)

### MVP 1.5 (추가 기능)
- Google OAuth 로그인
- AI 3줄 요약 (GPT API 연동)
- 중요도 자동 판단
- 웹 버전 개발
- 이메일 알림

### MVP 2.0 (확장)
- 북마크 기능
- 공시 비교
- 통계 대시보드
- 프리미엄 기능 (관심 기업 무제한, 고급 필터)

---

**작성일**: 2026-03-07
**마지막 업데이트**: 2026-03-08
**버전**: 1.0 (MVP)
