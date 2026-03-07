# 시스템 아키텍처

## 1. 전체 아키텍처 개요

```
┌─────────────────┐
│   Mobile App    │  React Native (Expo)
│  (React Native) │  - 사용자 UI
└────────┬────────┘  - 푸시 알림 수신
         │           - Deep Link 처리
         │ HTTPS/REST API
         ▼
┌─────────────────────────────────────────┐
│         NestJS Backend API              │
├─────────────────────────────────────────┤
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │  Auth   │  │  Users   │  │Devices │ │
│  └─────────┘  └──────────┘  └────────┘ │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │Watchlist│  │Disclosure│  │  Push  │ │
│  └─────────┘  └──────────┘  │  Notif │ │
│  ┌─────────┐                └────────┘ │
│  │Companies│  Scheduler (Cron)         │
│  └─────────┘  - 공시 수집 (10분마다)   │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────┐
│   PostgreSQL DB     │
│  (with Prisma ORM)  │
└─────────────────────┘

External APIs:
- DART Open API (공시 수집)
- Expo Push Notification Service (푸시 발송)
```

## 2. 컴포넌트 상세 설명

### 2.1 Mobile App (React Native + Expo)

**주요 책임**
- 사용자 인터페이스 제공
- 백엔드 API 호출
- 푸시 알림 수신 및 처리
- Deep Link를 통한 공시 상세 화면 이동

**주요 화면**
- 인증: 회원가입, 로그인
- 홈: 최근 공시 목록
- 설정: 관심 기업, 공시 유형, 알림 설정
- 공시 상세: 공시 정보, DART 원문 링크
- 알림 히스토리: 받은 알림 목록

**기술 스택**
- Expo (React Native 프레임워크)
- Expo Router (파일 기반 라우팅)
- React Query (서버 상태 관리)
- Zustand (클라이언트 상태 관리)
- NativeWind (Tailwind CSS)
- Expo Notifications (푸시 알림)

### 2.2 Backend API (NestJS)

**모듈 구조**

#### Auth Module
- **책임**: 회원가입, 로그인, JWT 발급/검증, 토큰 갱신
- **주요 기능**:
  - 이메일/비밀번호 기반 회원가입
  - JWT Access Token (15분) + Refresh Token (7일) 발급
  - 비밀번호 해싱 (bcrypt)
  - Guard를 통한 인증 확인
- **엔드포인트**:
  - `POST /auth/signup`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`

#### Users Module
- **책임**: 사용자 프로필 조회/수정
- **주요 기능**:
  - 현재 사용자 정보 조회
  - 프로필 수정 (이름, 이메일 등)
- **엔드포인트**:
  - `GET /users/me`
  - `PATCH /users/me`

#### Devices Module
- **책임**: 푸시 알림을 위한 디바이스 토큰 관리
- **주요 기능**:
  - Expo Push Token 등록/갱신
  - 만료된 토큰 삭제
- **엔드포인트**:
  - `POST /devices/register`
  - `DELETE /devices/:deviceId`

#### Companies Module
- **책임**: 기업 마스터 데이터 관리
- **주요 기능**:
  - 기업 목록 조회 (자동완성 검색용)
  - 종목코드로 기업 조회
- **엔드포인트**:
  - `GET /companies/search?query=삼성` (자동완성)
  - `GET /companies/:corpCode`

#### Watchlist Module
- **책임**: 사용자의 관심 기업 및 알림 설정 관리
- **주요 기능**:
  - 관심 기업 등록/삭제 (최대 30개)
  - 공시 유형 선택
  - 키워드 설정
  - 알림 on/off 토글
- **엔드포인트**:
  - `GET /watchlist`
  - `POST /watchlist`
  - `DELETE /watchlist/:id`
  - `PATCH /watchlist/:id/settings`

#### Disclosures Module
- **책임**: 공시 데이터 조회
- **주요 기능**:
  - 최근 공시 목록 조회 (페이징)
  - 공시 상세 조회
  - 공시 검색 (기업명, 공시명)
- **엔드포인트**:
  - `GET /disclosures` (목록)
  - `GET /disclosures/:id` (상세)
  - `GET /disclosures/search?q=증자`

#### Notifications Module
- **책임**: 알림 히스토리 조회 및 읽음 처리
- **주요 기능**:
  - 알림 히스토리 조회
  - 알림 읽음 처리
  - 알림 삭제
- **엔드포인트**:
  - `GET /notifications`
  - `PATCH /notifications/:id/read`
  - `DELETE /notifications/:id`

#### Scheduler Module
- **책임**: 배치 작업 실행
- **주요 기능**:
  1. **공시 수집 작업** (10분마다 실행)
     - DART Open API 호출하여 신규 공시 조회
     - 중복 체크 (고유키: rcp_no)
     - 신규 공시 DB 저장
  2. **알림 매칭 및 발송 작업** (공시 수집 직후)
     - 신규 공시와 사용자 관심 설정 매칭
     - 조건 만족 시 알림 생성 및 발송
     - 중복 알림 방지 (NotificationHistory 체크)
  3. **만료 토큰 정리 작업** (매일 자정)
     - 만료된 Refresh Token 삭제
     - 오래된 푸시 토큰 삭제

### 2.3 Database (PostgreSQL + Prisma)

**주요 역할**
- 사용자, 공시, 알림 데이터 영구 저장
- 관계형 데이터 관리
- 트랜잭션 지원

**ORM: Prisma**
- 타입 안전한 DB 쿼리
- 마이그레이션 관리
- 스키마 버전 관리

### 2.4 External APIs

#### DART Open API
- **용도**: 전자공시 데이터 수집
- **주요 API**:
  - `GET /api/list.json` - 공시 목록 조회
  - 파라미터: crtfc_key, bgn_de, end_de, page_no, page_count
- **수집 주기**: 10분마다
- **Rate Limit**: (DART API 문서 확인 필요)

#### Expo Push Notification Service
- **용도**: 모바일 푸시 알림 발송
- **방식**: Expo Push Token 기반
- **Endpoint**: `https://exp.host/--/api/v2/push/send`
- **제약사항**:
  - 토큰 만료 시 재등록 필요
  - 배치 전송 지원 (최대 100개)

## 3. 데이터 흐름

### 3.1 공시 수집 및 알림 발송 플로우

```
[매 10분마다 Scheduler 실행]
         │
         ▼
┌──────────────────────┐
│  DART API 호출       │
│  (최근 10분간 공시)  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  중복 체크           │
│  (rcp_no 기준)       │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  신규 공시 DB 저장   │
│  (Disclosures 테이블)│
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  사용자 매칭         │
│  1. 관심 기업 매칭   │
│  2. 공시 유형 매칭   │
│  3. 키워드 매칭      │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  알림 생성           │
│  (NotificationHistory│
│   중복 체크)         │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  푸시 알림 발송      │
│  (Expo Push API)     │
└──────────────────────┘
```

### 3.2 사용자 알림 수신 및 확인 플로우

```
[푸시 알림 수신]
         │
         ▼
┌──────────────────────┐
│  사용자 푸시 클릭    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  앱 열림 (Deep Link) │
│  disclosure/:id      │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  공시 상세 API 호출  │
│  GET /disclosures/:id│
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  공시 상세 화면 표시 │
│  - 기업명, 공시명    │
│  - 접수일시          │
│  - DART 원문 링크    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  알림 읽음 처리      │
│  PATCH               │
│  /notifications/:id  │
└──────────────────────┘
```

### 3.3 관심 기업 등록 플로우

```
[사용자 입력: "삼성"]
         │
         ▼
┌──────────────────────┐
│  자동완성 API 호출   │
│  GET /companies/     │
│  search?query=삼성   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  후보 목록 표시      │
│  - 삼성전자          │
│  - 삼성물산          │
│  - 삼성SDI           │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  사용자 선택:        │
│  삼성전자 (005930)   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  관심 기업 등록      │
│  POST /watchlist     │
│  {corpCode: 005930}  │
└──────────────────────┘
```

## 4. 보안 아키텍처

### 4.1 인증/인가

```
[Login]
  │
  ▼
┌─────────────────┐
│  JWT 발급       │
│  - Access: 15분 │
│  - Refresh: 7일 │
└────────┬────────┘
         ▼
[매 API 요청]
  │
  ▼
┌─────────────────┐
│  JwtAuthGuard   │
│  (Access Token  │
│   검증)         │
└────────┬────────┘
         ▼
[토큰 만료 시]
  │
  ▼
┌─────────────────┐
│  Refresh Token  │
│  으로 재발급    │
└─────────────────┘
```

### 4.2 비밀번호 보안
- bcrypt 해싱 (saltRounds: 10)
- 평문 비밀번호는 DB에 저장하지 않음

### 4.3 API Rate Limiting
- NestJS Throttler 사용
- 기본: 60 requests / 분
- 로그인: 5 requests / 분

### 4.4 입력 검증
- class-validator를 통한 DTO 검증
- SQL Injection 방지 (Prisma ORM 사용)
- XSS 방지 (helmet middleware)

## 5. 중복 알림 방지 메커니즘

### 5.1 문제 정의
- 같은 공시에 대해 같은 사용자에게 여러 번 알림이 가는 것을 방지

### 5.2 해결 방안

#### NotificationHistory 테이블 설계
```prisma
model NotificationHistory {
  id           String   @id @default(cuid())
  userId       String
  disclosureId String
  sentAt       DateTime @default(now())
  isRead       Boolean  @default(false)

  user         User       @relation(...)
  disclosure   Disclosure @relation(...)

  @@unique([userId, disclosureId])  // 복합 유니크 제약
  @@index([userId, isRead])
}
```

#### 알림 발송 로직
```typescript
async sendNotification(userId: string, disclosureId: string) {
  // 1. 이미 알림을 보낸 적이 있는지 체크
  const existing = await prisma.notificationHistory.findUnique({
    where: {
      userId_disclosureId: {
        userId,
        disclosureId,
      },
    },
  });

  if (existing) {
    // 이미 알림을 보낸 적이 있으면 스킵
    return;
  }

  // 2. 푸시 알림 발송
  await expoPushService.send(...);

  // 3. 알림 히스토리 저장 (중복 방지)
  await prisma.notificationHistory.create({
    data: {
      userId,
      disclosureId,
    },
  });
}
```

## 6. 정정공시 처리 메커니즘

### 6.1 정정공시란?
- 이미 제출한 공시의 내용을 수정하여 다시 제출하는 공시
- DART에서는 별도의 공시로 접수됨 (새로운 rcp_no)

### 6.2 처리 방식 (MVP 1차)

**기본 정책**: 정정공시를 별개의 신규 공시로 취급하여 알림 발송

**이유**:
- 정정공시는 중요한 변경사항이므로 사용자가 반드시 알아야 함
- DART API에서 정정공시와 원 공시의 연결 정보를 제공하지 않을 수 있음
- 1차 MVP에서는 단순하게 처리하고, 이후 개선

**향후 개선 방향** (MVP 1.5+):
- 공시명에 "[정정]" 표시
- 원 공시와 정정공시 연결 정보 제공
- 정정 내용 비교 기능

## 7. 확장성 고려사항

### 7.1 사용자 증가 대응
- **현재 구조**: 단일 서버 + 단일 DB
- **향후 확장**:
  - 백엔드 API 서버 수평 확장 (로드 밸런서)
  - DB 읽기 replica 추가
  - Redis 캐시 추가 (자주 조회되는 공시)

### 7.2 공시 데이터 증가 대응
- **현재**: 모든 공시를 단일 Disclosures 테이블에 저장
- **향후**:
  - 오래된 공시는 별도 Archive 테이블로 이동
  - 파티셔닝 (월별 또는 분기별)

### 7.3 알림 발송 부하 대응
- **현재**: Scheduler에서 동기적으로 알림 발송
- **향후**:
  - 메시지 큐 도입 (Bull.js + Redis)
  - 알림 발송 Worker 분리

## 8. 모니터링 및 로깅

### 8.1 로깅 전략
- **NestJS Logger 사용**
- **로그 레벨**: error, warn, info, debug
- **주요 로깅 포인트**:
  - API 요청/응답 (Interceptor)
  - 공시 수집 배치 실행/완료
  - 알림 발송 성공/실패
  - 에러 발생 (Exception Filter)

### 8.2 모니터링 지표 (향후)
- API 응답 시간
- 공시 수집 성공률
- 알림 발송 성공률
- DB 쿼리 성능
- 사용자 수, 일일 활성 사용자 (DAU)

## 9. 배포 아키텍처

### 9.1 개발 환경
- Docker Compose로 로컬 개발 환경 구성
  - NestJS backend
  - PostgreSQL
  - (선택) Redis (향후)

### 9.2 프로덕션 환경 (향후)
- **백엔드**: AWS ECS / GCP Cloud Run / Fly.io
- **DB**: AWS RDS PostgreSQL / GCP Cloud SQL
- **푸시 알림**: Expo Push Notification Service
- **CI/CD**: GitHub Actions

## 10. 기술적 의사결정 정리

| 의사결정 항목 | 선택 | 이유 |
|--------------|------|------|
| **백엔드 프레임워크** | NestJS | TypeScript 지원, 모듈화, DI, 생산성 |
| **ORM** | Prisma | 타입 안전, 마이그레이션, 개발자 경험 |
| **DB** | PostgreSQL | 관계형 데이터, 트랜잭션, 안정성 |
| **Scheduler** | @nestjs/schedule | NestJS 네이티브 통합, cron 지원 |
| **모바일 프레임워크** | React Native (Expo) | 빠른 개발, 푸시 알림 간편, Deep Link 지원 |
| **상태 관리** | React Query + Zustand | 서버/클라이언트 상태 분리, 캐싱, 간결함 |
| **UI** | NativeWind | Tailwind CSS 익숙도, 빠른 스타일링 |
| **푸시 알림** | Expo Push | Expo와 통합, 간단한 설정 |

---

**작성일**: 2026-03-07
**버전**: 1.0 (MVP)
