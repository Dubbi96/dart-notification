# 데이터베이스 스키마 설계

> **SSOT**: 스키마의 단일 진실 원천은 `backend/prisma/schema.prisma`(총 **49개 모델**)이며, **이 문서는 해설**(설계 의도·도메인 맥락·마이그레이션 이력)이다. 필드 정의가 다르면 schema.prisma 가 우선한다.

## 1. ER Diagram

```
┌─────────────┐         ┌──────────────┐
│    Users    │         │UserDevices   │
├─────────────┤         ├──────────────┤
│ id          │────┬───>│ id           │
│ email       │    │    │ userId       │
│ password    │    │    │ deviceToken  │
│ name        │    │    │ platform     │
│ createdAt   │    │    │ createdAt    │
│ updatedAt   │    │    │ lastUsedAt   │
└─────────────┘    │    └──────────────┘
       │           │
       │           │    ┌──────────────┐
       │           ├───>│WatchLists    │
       │           │    ├──────────────┤
       │           │    │ id           │
       │           │    │ userId       │
       │           │    │ corpCode     │
       │           │    │ corpName     │
       │           │    │ createdAt    │
       │           │    └──────────────┘
       │           │
       │           │    ┌──────────────────────┐
       │           └───>│NotificationSettings  │
       │                ├──────────────────────┤
       │                │ userId (PK)          │
       │                │ disclosureTypes      │
       │                │ keywords             │
       │                │ isEnabled            │
       │                │ updatedAt            │
       │                └──────────────────────┘
       │
       │                ┌──────────────────────┐
       └───────────────>│NotificationHistory   │
                        ├──────────────────────┤
                   ┌───>│ id                   │
                   │    │ userId               │
                   │    │ disclosureRcpNo      │
                   │    │ sentAt               │
                   │    │ isRead               │
                   │    │ readAt               │
                   │    └──────────────────────┘
                   │
┌──────────────┐   │
│ Disclosures  │───┘
├──────────────┤
│ rcpNo (PK)   │ (DART 접수번호)
│ corpCode     │
│ corpName     │
│ reportName   │
│ rcpDt        │ (접수일시)
│ flrName      │ (공시제출인명)
│ rmk          │ (비고)
│ disclosureType│
│ createdAt    │
└──────────────┘
       │
       │
       ▼
┌──────────────┐
│  Companies   │
├──────────────┤
│ corpCode(PK) │ (DART 고유번호)
│ corpName     │ (기업명)
│ stockCode    │ (상장코드, nullable)
│ market       │ (코스피/코스닥, nullable)
│ createdAt    │
│ updatedAt    │
└──────────────┘
```

## 2. Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ====================================
// 사용자 관련
// ====================================

model User {
  id         String   @id @default(cuid())
  email      String   @unique
  password   String?  // bcrypt 해싱 — 소셜 로그인(kakao) 사용자는 null
  name       String?
  provider   String   @default("local") // "local" | "kakao" | "google"
  providerId String?  // kakao user id
  tier       UserTier @default(FREE)    // 갭분석 W1: 엔티틀먼트 소켓 (FREE | PRO)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  // Relations
  devices              UserDevice[]
  watchLists           WatchList[]
  savedDisclosures     SavedDisclosure[]
  notificationSettings NotificationSettings?
  notificationHistory  NotificationHistory[]
  portfolios           Portfolio[]
  refreshTokens        RefreshToken[]
  proWaitlistEntry     ProWaitlistEntry?

  @@unique([provider, providerId]) // 카카오 OAuth 계정 유일성
  @@index([email])
  @@map("users")
}

// 갭분석 W1: Pro 출시알림 사전신청 리드 서버 영속화 (유일한 지불의사 계측기).
// UserTier(FREE|PRO)는 결제 레일과 무관한 엔티틀먼트 소켓 — v1 유료 경계는 '도구 편의' 한정
// (신호·판단 레이어 과금은 유사투자자문업 신고 완료 전 금지, docs/work/m0/policy-non-advisory.md).
model ProWaitlistEntry {
  id        String   @id @default(cuid())
  userId    String   @unique // User 1:1, onDelete: Cascade
  createdAt DateTime @default(now())
}

model UserDevice {
  id          String   @id @default(cuid())
  userId      String
  deviceToken String   @unique // Expo Push Token
  platform    String   // "ios" | "android"
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime @updatedAt

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([deviceToken])
  @@map("user_devices")
}

// DAR-207: refresh 토큰 회전/무효화용 세션 추적
model RefreshToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique // refresh JWT 의 SHA-256 해시 (원문 비저장)
  expiresAt DateTime  // 발급 + 90d
  revokedAt DateTime? // null = 유효
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenHash])
  @@map("refresh_tokens")
}

// ====================================
// 기업 마스터
// ====================================

model Company {
  corpCode  String   @id // DART 고유번호 (8자리, Natural Key)
  corpName  String   // 기업명
  stockCode String?  // 종목코드 (6자리, 비상장은 null)
  market    String?  // "KOSPI" | "KOSDAQ" | null

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  watchLists  WatchList[]
  disclosures Disclosure[]

  @@index([corpName]) // 자동완성 검색용
  @@index([stockCode])
  @@map("companies")
}

// ====================================
// 관심 목록
// ====================================

model WatchList {
  id           String    @id @default(cuid())
  userId       String
  corpCode     String    // DART 고유번호
  corpName     String    // 기업명 (중복 저장, 조회 성능)
  createdAt    DateTime  @default(now())
  lastViewedAt DateTime? // DAR-165: 마지막 조회 시각(표시용)
  lastViewedRcpNo String? // DAR-185: 마지막으로 본 공시 rcpNo 커서. 이 값보다 큰 rcpNo 만 신규(unread 배지) — 같은 날 공시도 정확히 집계

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, corpCode]) // 같은 기업 중복 등록 방지
  @@index([userId])
  @@index([corpCode])
  @@map("watch_lists")
}

// ====================================
// 알림 설정
// ====================================

model NotificationSettings {
  userId          String   @id // User와 1:1, Natural Key
  disclosureTypes String[] // ["정기공시", "주요사항보고", "발행공시", "지분공시", "기타공시"]
  keywords        String[] // 키워드 배열 (예: ["증자", "배당"])
  isEnabled       Boolean  @default(true) // master 푸시 스위치

  // DAR-85: 신호·청산·논리훼손 푸시 토글(기본 OFF). master isEnabled ON일 때만 발송.
  signalPushEnabled Boolean @default(false)
  exitPushEnabled   Boolean @default(false)
  thesisPushEnabled Boolean @default(false)
  // DAR-424: 라이브 페이퍼 체결 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략(과알림 방지).
  tradePushEnabled  Boolean @default(true)
  // DAR-473(P01): 리스크·운영 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략.
  opsPushEnabled    Boolean @default(true)
  // 갭분석 W7: 관심종목 급변동(PRICE_MOVE) 알림 토글(★기본 OFF).
  priceMovePushEnabled Boolean @default(false)
  // DAR-514(Wave A): 신규 2계열 토글(★기본 OFF — 예약, Wave B 소비) + 사용자별 일일 푸시 캡.
  editionPushEnabled Boolean @default(false) // 일일 에디션 발행 알림(예약)
  digestPushEnabled  Boolean @default(false) // 다이제스트(요약) 알림(예약)
  dailyPushCap       Int     @default(30)    // 일일 푸시 상한(면제 계열 RISK/OPS 제외). 1~500.

  updatedAt       DateTime @updatedAt

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notification_settings")
}

// DAR-514(Wave A): 푸시 실발송/억제 원장 — 사용자별 일일 캡 계산의 SSOT + 억제 로그.
//   kstDate(YYYYMMDD KST 버킷)별 SENT 행 수가 그날 발송 카운트. (userId,type,refId) 멱등(원장 1건/통지).
//   FK 없음(forward-only). status=SUPPRESSED_CAP 행이 '캡 초과 억제' 로그다(인박스는 별도 보존).
enum PushDeliveryStatus {
  SENT
  SUPPRESSED_CAP
}

model PushDeliveryLog {
  id        String             @id @default(cuid())
  userId    String
  type      NotificationType
  refId     String
  kstDate   String // YYYYMMDD(KST) — 일일 캡 버킷
  status    PushDeliveryStatus
  createdAt DateTime           @default(now())

  @@unique([userId, type, refId]) // 멱등: 통지 1건당 원장 1건
  @@index([userId, kstDate, status]) // 캡 카운트(당일 SENT 집계)
  @@map("push_delivery_log")
}

// 통합 알림 유형 (DAR-84/85/424/473)
// DISCLOSURE(공시)·SIGNAL(매수신호)·EXIT(청산권고)·THESIS_VIOLATED(논리훼손)
// ·TRADE_ENTRY(라이브 페이퍼 매수 체결)·TRADE_EXIT(라이브 페이퍼 매도 체결, DAR-424)
// ·RISK_ALERT(리스크: 킬스위치·드로다운)·OPS_ALERT(운영: 크론 stale·수집/청산 실패·일일 리포트, DAR-473 P01)
// NotificationHistory.type 으로 사용. 멱등 키 @@unique([userId, type, refId]).
// 알림 카테고리(4 버킷): 공시(disclosure)·신호(signal)·체결(trade)·운영(system=RISK_ALERT+OPS_ALERT).

// ====================================
// 공시 데이터
// ====================================

model Disclosure {
  rcpNo          String   @id // DART 접수번호 (Natural Key)
  corpCode       String   // 기업 고유번호
  corpName       String   // 기업명
  reportName     String   // 보고서명
  rcpDt          String   // 접수일시 (YYYYMMDD 또는 YYYYMMDDHHmmss)
  flrName        String   // 공시제출인명
  rmk            String   // 비고
  disclosureType String   // 공시 유형 (정기공시, 주요사항보고 등)
  isBackfill     Boolean  @default(false) // DAR-129: 과거 공시 백필 표식. true=라이브 신호·알림 격리, 분석/백테스트 포함

  createdAt DateTime @default(now())

  // Relations
  company             Company              @relation(fields: [corpCode], references: [corpCode])
  notificationHistory NotificationHistory[]

  @@index([corpCode])
  @@index([rcpDt])
  @@index([disclosureType])
  @@index([createdAt]) // 최근 공시 조회용
  @@index([isBackfill]) // DAR-129: 신호생성·신호피드 백필 제외 필터 조회용
  @@index([corpCode, rcpNo]) // DAR-214: 워치리스트 신규 공시 grouped count(corpCode + rcpNo>커서) 조인용
  @@index([corpCode, rcpDt, rcpNo]) // DAR-276: 기업상세 공시목록 필터+정렬 커버(메모리정렬 해소)
  @@map("disclosures")
}

// ====================================
// 알림 히스토리
// ====================================

model NotificationHistory {
  id       String           @id @default(cuid())
  userId   String
  type     NotificationType @default(DISCLOSURE) // DAR-84 통합 인박스 타입
  refId    String?          // 다형 참조키 (rcpNo/signalId/positionId) — 앱레벨 무결성
  title    String?          // 통지 제목 (공시 외 타입용)
  body     String?          // 통지 본문
  deepLink String?          // 인앱 딥링크 (예: /disclosure/:rcpNo)

  disclosureRcpNo String?   // DART 접수번호 (FK → Disclosure.rcpNo, nullable — 공시 외 타입 수용)
  sentAt          DateTime  @default(now())
  isRead          Boolean   @default(false)
  readAt          DateTime?

  // Relations
  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  disclosure Disclosure? @relation(fields: [disclosureRcpNo], references: [rcpNo], onDelete: Cascade)

  @@unique([userId, type, refId]) // DAR-84: type+refId 단위 멱등 (공시는 refId=rcpNo)
  @@index([userId, isRead]) // 읽지 않은 알림 조회용
  @@index([userId, sentAt]) // 알림 목록 조회용
  @@map("notification_history")
}
```

## 3. 테이블별 상세 설명

### 3.1 Users

**목적**: 사용자 정보 저장

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 사용자 고유 ID | PK, cuid() |
| email | String | 이메일 (로그인 ID) | UNIQUE, NOT NULL |
| password | String? | bcrypt 해싱된 비밀번호 — 소셜 로그인 사용자는 null | NULLABLE |
| name | String | 사용자 이름 | NULLABLE |
| provider | String | 인증 제공자 "local" \| "kakao" \| "google" | default: "local" |
| providerId | String? | 소셜 제공자측 사용자 ID (kakao user id) | NULLABLE |
| createdAt | DateTime | 가입일시 | default: now() |
| updatedAt | DateTime | 수정일시 | auto update |

**인덱스·제약**:
- `email` (로그인 조회 성능)
- Composite Unique: `(provider, providerId)` — 카카오 OAuth 계정 유일성

**카카오 OAuth (인증 흐름)**:
- 카카오 로그인 사용자는 `provider="kakao"` + `providerId=카카오 user id`로 식별하며 `password=null`.
- 로컬(이메일/비밀번호) 사용자는 `provider="local"` + bcrypt 해싱 `password` 보유.

### 3.2 UserDevices

**목적**: 푸시 알림을 위한 디바이스 토큰 관리

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 디바이스 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id |
| deviceToken | String | Expo Push Token | UNIQUE, NOT NULL |
| platform | String | "ios" \| "android" | NOT NULL |
| createdAt | DateTime | 등록일시 | default: now() |
| lastUsedAt | DateTime | 마지막 사용일시 | auto update |

**인덱스**:
- `userId` (사용자의 디바이스 조회)
- `deviceToken` (중복 체크)

**특징**:
- 한 사용자가 여러 디바이스를 가질 수 있음
- 토큰 만료 시 재등록

### 3.2b RefreshTokens (refresh_tokens) — DAR-207 신규

**목적**: 발급된 refresh 토큰의 무효화·회전(rotation)을 위한 세션 추적. 무상태 JWT만으로는 로그아웃·탈취 시 90일간 폐기가 불가능했던 문제(보안)를 해소.

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 토큰 행 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id (onDelete: Cascade) |
| tokenHash | String | refresh JWT 의 SHA-256 해시 (원문 비저장) | UNIQUE, NOT NULL |
| expiresAt | DateTime | refresh JWT 만료 시각 (발급 + 90d) | NOT NULL |
| revokedAt | DateTime? | 회전·로그아웃으로 폐기된 시각 (null = 유효) | nullable |
| createdAt | DateTime | 발급일시 | default: now() |

**인덱스**:
- `userId` (사용자 세션 일괄 폐기)
- `tokenHash` (제시 토큰 조회)

**특징·정책**:
- 토큰 발급(signup/login/kakao/refresh)마다 한 행을 생성하고 해시만 저장(원문 미보관).
- `/auth/refresh`: 제시된 토큰의 해시를 조회 → 미등록/타 사용자/만료/폐기 시 401. 통과 시 해당 행을 revoke 하고 새 토큰 발급(회전).
- 폐기된 토큰의 재사용 감지 시(reuse detection) 해당 사용자의 모든 유효 세션을 폐기.
- `/auth/logout`: 해당 사용자의 모든 유효 refresh 토큰을 폐기 → 이후 동일 토큰으로 갱신 불가.

### 3.3 Company

**목적**: 기업 마스터 데이터 (자동완성 검색용)

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| corpCode | String | DART 고유번호 (8자리) | PK (Natural Key) |
| corpName | String | 기업명 | NOT NULL |
| stockCode | String | 종목코드 (6자리) | NULLABLE |
| market | String | "KOSPI" \| "KOSDAQ" | NULLABLE |
| createdAt | DateTime | 등록일시 | default: now() |
| updatedAt | DateTime | 수정일시 | auto update |

**인덱스**:
- `corpName` (자동완성 검색 성능)
- `stockCode` (종목코드 검색)

**데이터 출처**:
- DART "고유번호" API로 초기 데이터 수집
- 신규 상장/폐지 시 수동 또는 배치로 업데이트

### 3.4 WatchList

**목적**: 사용자의 관심 기업 목록

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 관심 목록 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id |
| corpCode | String | DART 고유번호 | NOT NULL |
| corpName | String | 기업명 | NOT NULL |
| createdAt | DateTime | 등록일시 | default: now() |
| lastViewedAt | DateTime? | 마지막 조회 시각 (DAR-165, 표시용) | NULLABLE |
| lastViewedRcpNo | String? | 마지막으로 본 공시 rcpNo 커서 (DAR-185). 이 값보다 큰 rcpNo 만 신규 unread 배지로 집계 → 같은 날 들어온 공시도 정확히 잡힘 | NULLABLE |

**인덱스**:
- `userId` (사용자의 관심 목록 조회)
- `corpCode` (기업별 관심 사용자 조회)
- Composite Unique: `(userId, corpCode)` (중복 등록 방지)

**제약사항**:
- 사용자당 최대 30개 (애플리케이션 레벨에서 검증)

### 3.5 NotificationSettings

**목적**: 사용자의 알림 설정

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| userId | String | 사용자 ID | PK, FK -> users.id |
| disclosureTypes | String[] | 공시 유형 배열 | default: [] |
| keywords | String[] | 키워드 배열 | default: [] |
| isEnabled | Boolean | 알림 전체 on/off (master) | default: true |
| signalPushEnabled / exitPushEnabled / thesisPushEnabled | Boolean | 신호·청산·논리훼손 푸시 토글 (DAR-85) | default: false |
| tradePushEnabled | Boolean | 체결 알림 토글 (DAR-424) | default: true |
| opsPushEnabled | Boolean | 리스크·운영 알림 토글 (DAR-473 P01) | default: true |
| updatedAt | DateTime | 수정일시 | auto update |

**인덱스**:
- `userId` (사용자별 설정 조회)

**disclosureTypes 값**:
- "정기공시"
- "주요사항보고"
- "발행공시"
- "지분공시"
- "기타공시"

**특징**:
- 사용자당 1개의 설정 레코드
- 회원가입 시 기본값으로 생성

### 3.6 Disclosure

**목적**: DART 공시 데이터 저장

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| rcpNo | String | DART 접수번호 | PK (Natural Key) |
| corpCode | String | 기업 고유번호 | NOT NULL |
| corpName | String | 기업명 | NOT NULL |
| reportName | String | 보고서명 | NOT NULL |
| rcpDt | String | 접수일시 | NOT NULL |
| flrName | String | 공시제출인명 | NOT NULL |
| rmk | String | 비고 | default: "" |
| disclosureType | String | 공시 유형 | NOT NULL |
| isBackfill | Boolean | 과거 공시 백필 표식 (DAR-129) | NOT NULL, default: false |
| createdAt | DateTime | DB 저장일시 | default: now() |

> **isBackfill (DAR-129)**: `true`면 추이·분석 baseline 용도로만 적재된 과거 공시.
> 라이브 신호 생성(`SignalGenerationService`)·신호 피드(`SignalsService.findAll`)·푸시 알림에서 **절대 제외**(불가침).
> Event Study·통계·백테스트 등 분석 경로는 백필 포함 전체 사용. 백필 적재는 수동 스크립트
> `src/engine1-disclosure/scheduler/backfill-disclosures.manual.ts`로만 수행(cron 자동화 아님).

**인덱스**:
- `rcpNo` (PK, 자연키)
- `corpCode` (기업별 공시 조회)
- `isBackfill` (신호생성·신호피드 백필 제외 필터)
- `rcpDt` (날짜별 공시 조회)
- `disclosureType` (유형별 공시 조회)
- `createdAt` (최근 공시 목록 조회)

**DART 원문 URL 생성 규칙**:
```
https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcpNo}
```

### 3.7 NotificationHistory

**목적**: 통합 알림 인박스 (공시·신호·청산·논리훼손·체결·운영/리스크) 발송 이력 및 중복 방지 (DAR-84/85/424/473)

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 알림 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id |
| type | NotificationType | DISCLOSURE/SIGNAL/EXIT/THESIS_VIOLATED/TRADE_ENTRY/TRADE_EXIT/RISK_ALERT/OPS_ALERT | default: DISCLOSURE |
| refId | String? | 다형 참조키 (rcpNo/signalId/positionId) — 앱레벨 무결성 | NULLABLE |
| title / body / deepLink | String? | 통지 제목·본문·인앱 딥링크 (공시 외 타입용) | NULLABLE |
| disclosureRcpNo | String? | DART 접수번호 (공시 외 타입은 null) | FK -> disclosures.rcpNo, NULLABLE |
| sentAt | DateTime | 발송일시 | default: now() |
| isRead | Boolean | 읽음 여부 | default: false |
| readAt | DateTime | 읽은 일시 | NULLABLE |

**인덱스**:
- `(userId, isRead)` (읽지 않은 알림 조회)
- `(userId, sentAt)` (알림 목록 조회, 최신순 정렬)
- Composite Unique: `(userId, type, refId)` (DAR-84: type+refId 단위 멱등 — 중복 알림 방지)

**중복 알림 방지 메커니즘**:
- `(userId, type, refId)` 조합이 유니크 (공시는 refId=rcpNo)
- 알림 발송 전에 이 조합으로 조회하여 이미 존재하면 스킵

## 4. 초기 데이터 설정

### 4.1 Company 테이블 초기 데이터

**출처**: DART Open API - 고유번호 API
- API: `https://opendart.fss.or.kr/api/corpCode.xml`
- 파라미터: `crtfc_key`

**초기 데이터 수집 스크립트** (Node.js):
```typescript
// scripts/seed-companies.ts
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as xml2js from 'xml2js';

const prisma = new PrismaClient();

async function seedCompanies() {
  const response = await axios.get('https://opendart.fss.or.kr/api/corpCode.xml', {
    params: {
      crtfc_key: process.env.DART_API_KEY,
    },
  });

  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(response.data);

  const companies = result.result.list.map((item) => ({
    corpCode: item.corp_code[0],
    corpName: item.corp_name[0],
    stockCode: item.stock_code[0] || null,
    market: item.stock_code[0] ? (item.corp_name[0].includes('코스닥') ? 'KOSDAQ' : 'KOSPI') : null,
  }));

  await prisma.company.createMany({
    data: companies,
    skipDuplicates: true,
  });

  console.log(`Seeded ${companies.length} companies`);
}

seedCompanies()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
```

## 5. 마이그레이션 전략

### 5.1 개발 환경
```bash
npx prisma migrate dev --name <migration-name>
```

### 5.2 프로덕션 환경
```bash
npx prisma migrate deploy
```

### 5.3 스키마 변경 시 주의사항
- 데이터 손실 가능성이 있는 변경은 백업 후 진행
- 대량 데이터가 있는 테이블의 인덱스 추가는 다운타임 고려

## 6. 쿼리 최적화 전략

### 6.1 N+1 문제 방지
- Prisma의 `include`를 활용한 eager loading
```typescript
const notifications = await prisma.notificationHistory.findMany({
  include: {
    disclosure: true, // 한 번에 조인
  },
});
```

### 6.2 페이징
```typescript
const disclosures = await prisma.disclosure.findMany({
  skip: (page - 1) * limit,
  take: limit,
  orderBy: {
    rcpDt: 'desc',
  },
});
```

### 6.3 조건부 쿼리
```typescript
const where: Prisma.DisclosureWhereInput = {
  ...(corpCode && { corpCode }),
  ...(disclosureType && { disclosureType }),
};

const disclosures = await prisma.disclosure.findMany({
  where,
});
```

## 7. M4 시장 데이터 모델 (신규)

### 7.1 StockDailyPrice (stock_daily_prices)

일봉 시세 데이터. 자연키: `(stockCode, tradeDate)`.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| corpCode | TEXT FK | DART 고유번호 → Company.corpCode |
| stockCode | TEXT | 종목코드 6자리 |
| tradeDate | TEXT | 거래일 YYYYMMDD |
| openPrice | INT | 시가 |
| highPrice | INT | 고가 |
| lowPrice | INT | 저가 |
| closePrice | INT | 종가 |
| volume | BIGINT | 거래량 |
| tradingValue | BIGINT? | 거래대금 |

```prisma
model StockDailyPrice {
  @@unique([stockCode, tradeDate])
  @@index([corpCode])
  @@index([tradeDate])
  @@map("stock_daily_prices")
}
```

### 7.1a StockMinutePrice (stock_minute_prices) — DAR-381 ★TimescaleDB 하이퍼테이블 (통합: DAR-377+DAR-378)

장중 분봉 OHLCV 시세. 대규모 시계열(수억 행)을 효율 저장하기 위해 **TimescaleDB 하이퍼테이블**로
운용한다(DAR-381 = #333 수집 + #334 TimescaleDB 단일 스키마 통합).

★**forward-only(불가침 정직 고지)**: KIS 는 '당일 분봉'만 제공한다(과거 분봉 미제공). 따라서 분봉은
**과거 소급 백필이 원천 불가**하며 수집 시작일부터 매일 누적한다(`StockMinutePriceCollector`).
시작일 이전 분봉은 존재하지 않는다 — 이 한계는 수집 로그·문서에 명시한다.

★파티션 키 = `ts`(거래 분의 분 단위 instant; KST 거래일+체결시각 HHMM 결합). TimescaleDB 는 모든
UNIQUE/PK 인덱스에 파티션 컬럼을 포함하도록 요구하므로 대리키 cuid 를 두지 않고
**복합 PK `@@id([stockCode, ts])`** 를 자연키로 쓴다. `chunk_time_interval = 7 days`.

Prisma 모델은 '일반 정의'만 두고, 하이퍼테이블 변환·압축·연속집계·보존정책은 raw SQL
마이그레이션이 담당한다(Prisma 모델 + raw SQL 공존, TimescaleDB 가이드 준수).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| corpCode | TEXT FK | DART 고유번호 → Company.corpCode |
| stockCode | TEXT | 종목코드 6자리 (복합 PK) |
| ts | TIMESTAMP(3) | 거래 분 instant — **파티션 키**, 복합 PK |
| tradeDate | TEXT? | 거래일 YYYYMMDD(파생, 조회 편의·보존정책) — 수집기가 ts 에서 도출해 채움 |
| openPrice/highPrice/lowPrice/closePrice | INT | 분봉 OHLC |
| volume | BIGINT | 분 거래량 |
| tradingValue | BIGINT? | 분 거래대금 |
| source | TEXT | 출처 라벨(정직) — 기본 `'KIS_REALTIME'` |
| createdAt | TIMESTAMP | 생성 시각 |

**TimescaleDB 정책(raw SQL 마이그레이션):**
- **압축**: chunk 7일 경과 시 columnar 압축(`compress_segmentby='stockCode'`, `compress_orderby='ts DESC'`)
  + `add_compression_policy(... '7 days')`. 실측 압축률 **10.7×(90.6% 절감)** — 금융 OHLCV ~90~95% 기대 부합.
- **연속집계**: 분봉→`stock_candles_5m`/`stock_candles_15m`/`stock_candles_1d` materialized cagg
  + refresh policy. 차트·분석이 원본 분봉 풀스캔 없이 롤업 조회.
- **보존정책**: `add_retention_policy(... '5 years')` — 기본은 길게 보존, 운영에서 용량 압박 시 INTERVAL 튜닝.

수집기: `StockMinutePriceCollector` — KIS 당일 분봉 time(HHMMSS)→ts(분 단위 instant) 변환 후 멱등 적재.
조회 API: `GET /market-data/candles`(from~to + resolution 1m/5m/15m/1d + 페이지네이션 + 서버측 다운샘플).
레거시 분봉: `GET /market-data/minute-candles`(당일 KIS 실시간 우선, tradeDate 지정 시 저장분 폴백).

마이그레이션: `20260620000000_dar381_minute_prices_timescaledb`(create-only, 적용 휴먼 승인 — TimescaleDB 이미지 교체·`CREATE EXTENSION` 포함).

```prisma
model StockMinutePrice {
  corpCode     String
  stockCode    String
  ts           DateTime
  tradeDate    String?
  openPrice    Int
  highPrice    Int
  lowPrice     Int
  closePrice   Int
  volume       BigInt
  tradingValue BigInt?
  source       String   @default("KIS_REALTIME")
  createdAt    DateTime @default(now())
  company      Company  @relation(fields: [corpCode], references: [corpCode])
  @@id([stockCode, ts])
  @@index([corpCode])
  @@index([ts])
  @@index([stockCode, tradeDate])
  @@map("stock_minute_prices")
}
```


### 7.1b SimulatedDailyPrice (simulated_daily_prices) — DAR-124 ★모의 전용·실시세 아님

모의운용 전용 **결정적 합성 일봉**. 환경 시계가 미래(2026)라 실 KRX 일봉이 없어
모의운용이 가격변동을 평가하지 못하는 문제를 해소한다. 자연키: `(stockCode, tradeDate)`.

★신뢰 원칙(불가침): 이 테이블은 '모의/시뮬레이션' 전용이다. 절대 실시세로 표시하지 않으며
실데이터(`stock_daily_prices`)와 **혼합하지 않는다**(물리 분리·Company FK 없음). 오직
`PaperSimulation`(`SimulationPriceSourceService`)만 읽고, 기업 현재가/지표/신호 등 실가격
표시 경로는 이 테이블을 절대 참조하지 않는다. 활성: `PAPER_SIM_SYNTHETIC_FEED=1`.

★DAR-364(가격 기준 = 실시간 실가 구동): 운영 기본은 `PAPER_SIM_REAL_FEED=1`(REAL_THEN_SYNTHETIC)이며,
보유 포지션 평가의 **1순위는 KIS 실시간 실가(`RealtimeQuoteCache`, source=REALTIME)**다 →
실 KRX 일봉(REAL) → 합성(SYNTHETIC) 순 폴백(한 종목 한 소스). 따라서 합성은 '실시간/실데이터가
전혀 없는 종목'의 최후 폴백일 뿐이며, **'30일 트랙레코드'는 합성 전용 트랙이 아니라 실시간 실가
구동으로 재정의**된다(과거 백테스트와 분리). 합성 전용(`PAPER_SIM_SYNTHETIC_FEED=1`)은 실데이터·
실시간이 모두 부재한 환경의 레거시/검증 모드로만 남는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| corpCode | TEXT | DART 고유번호(평문 — FK 관계 없음, 격리) |
| stockCode | TEXT | 종목코드 6자리 |
| tradeDate | TEXT | 거래일 YYYYMMDD |
| openPrice/highPrice/lowPrice/closePrice | INT | 합성 OHLC(시드 PRNG, Date.now/random 미사용) |
| volume | BIGINT | 합성 거래량 |
| source | TEXT | 출처 라벨 — 항상 `'SYNTHETIC'`(오인 방지) |
| createdAt | TIMESTAMP | 생성 시각 |

마이그레이션: `20260608100000_dar124_simulated_daily_price`(create-only, 적용 휴먼 승인).

### 7.1c EtfDailyPrice (etf_daily_prices) — DAR-484 신규 [견고화 W1·P10]

ETF 일봉 시세 데이터. Wave1 신규 2트랙(월단위 듀얼모멘텀 P12/P13 · 변동성 돌파 P14/P15)의 공통 토대.
자연키: `(etfCode, tradeDate)`. **`StockDailyPrice`와 물리 분리** — ETF 는 DART `corpCode`가 없어
Company FK 를 걸 수 없으므로 전용 모델로 둔다(FK 관계 없음, `etfCode` 6자리 단축코드가 자연키).

★소스(2026-07-03 실검증): **1차 = KIS 기간별시세(일봉)**. KRX `/etp/etf_bydd_trd`는 HTTP 401
(현재 키 ETF 상품 미구독 — 주식 일봉 `/sto/stk_bydd_trd`는 200 정상)이라 어댑터 인터페이스만 두고
미구현. `source` 컬럼이 어느 소스 어댑터(KIS | KRX_ETP)가 적재했는지 기록해 향후 구독 승인 시
소스 전환을 관측 가능하게 한다. 무레버리지 원칙(레버리지·인버스 ETF 금지).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| etfCode | TEXT | ETF 6자리 단축코드(예: 069500 KODEX 200) — FK 관계 없음 |
| tradeDate | TEXT | 거래일 YYYYMMDD |
| openPrice | INT | 시가 |
| highPrice | INT | 고가 |
| lowPrice | INT | 저가 |
| closePrice | INT | 종가 |
| volume | BIGINT | 거래량 |
| tradingValue | BIGINT? | 거래대금(원) |
| source | TEXT | 시세 소스 어댑터 — 기본 `'KIS'`(`"KIS" \| "KRX_ETP"`) |
| createdAt | TIMESTAMP | 생성 시각 |

수집기: `EtfDailyPriceCollector` — 평일 19:10 KST EOD(기존 KRX 일봉 18:30/21:00 크론과 시간대 분리).
유니버스(`etf-universe.ts`) 4~5종 × 최근 N일 구간을 KIS 기간별시세로 받아 OHLC 정합성 검사 후 멱등
적재(createMany skipDuplicates). 크론 헬스는 `CronRunLog`(jobKey `market.etf-daily-collect`)에 기록되어
`FRESHNESS_JOB_SPECS`(72h 임계)로 감시 — 결측 시 P02 `DataFreshnessMonitorScheduler`가 OPS_ALERT 발송.
백필(3년+)은 P11 별도 이슈. KIS 키 미설정 시 graceful no-op(실호출 0).

마이그레이션: `20260703140000_dar484_etf_daily_price`(create-only, 적용 휴먼 승인).

```prisma
model EtfDailyPrice {
  id           String   @id @default(cuid())
  etfCode      String
  tradeDate    String
  openPrice    Int
  highPrice    Int
  lowPrice     Int
  closePrice   Int
  volume       BigInt
  tradingValue BigInt?
  source       String   @default("KIS")
  createdAt    DateTime @default(now())
  @@unique([etfCode, tradeDate])
  @@index([tradeDate])
  @@map("etf_daily_prices")
}
```

### 7.2 TechnicalIndicator (technical_indicators)

기술지표 계산 결과. MA/RSI/MACD/BB/ATR/VWAP/VolumeRatio/52W/선행상승률. 자연키: `(stockCode, tradeDate)`.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| corpCode | TEXT FK | DART 고유번호 → Company.corpCode |
| stockCode | TEXT | 종목코드 |
| tradeDate | TEXT | 기준 거래일 |
| ma5/20/60/120 | FLOAT? | 이동평균 (데이터 부족 시 null) |
| rsi14 | FLOAT? | RSI 14일 |
| macdLine/Signal/Histogram | FLOAT? | MACD (12,26,9) |
| bollingerUpper/Mid/Lower | FLOAT? | 볼린저 밴드 (20,2σ) |
| atr14 | FLOAT? | ATR 14일 |
| vwap | FLOAT? | VWAP 당일 |
| volumeRatio20 | FLOAT? | 거래량비율 (20일 평균 대비) |
| high52w / low52w | INT? | 52주 최고/최저 |
| preDsclReturn | FLOAT? | 공시 전 선행상승률 D-5~D-1 (%) |

### 7.3 MarketIndex (market_indices)

시장 종합지수 (KOSPI=0001, KOSDAQ=1001). 자연키: `(indexCode, tradeDate)`.

> **DAR-367.** 0001/1001 에는 **종합지수만** 적재한다(파서가 `IDX_NM=='코스피'/'코스닥'` 행만
> 선별). 이전엔 `kospi_dd_trd` 응답의 업종지수 등 모든 시리즈가 동일 코드로 upsert 돼 마지막
> 행이 종합지수를 덮어쓰는 오염(예: KOSPI close 3132 vs prevClose 8639, -63.75%)이 있었다.
> 적재 단계 연속성 가드가 직전 거래일 종가 대비 |Δ| > 20% 행을 격리한다(스키마 변경 없음).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| indexCode | TEXT | 지수코드 |
| indexName | TEXT | 지수명 |
| tradeDate | TEXT | 거래일 YYYYMMDD |
| openIndex/highIndex/lowIndex/closeIndex | FLOAT | OHLC 지수 |
| volume | BIGINT? | 거래량 |
| tradingValue | BIGINT? | 거래대금 |

### 7.4 StockStatus (stock_statuses) — DAR-8 신규

종목별 거래정지·관리종목·투자주의 상태. 매 거래일 장 시작 전 KRX 수집으로 갱신.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| stockCode | TEXT PK | 종목코드 6자리 |
| tradeDate | TEXT | 마지막 갱신 거래일 YYYYMMDD |
| isTradingSuspended | BOOL | 거래정지 여부 |
| isManagement | BOOL | 관리종목 여부 |
| isInvestmentCaution | BOOL | 투자주의 여부 |
| isAbnormalSurge | BOOL | 이상급등 여부 |
| statusNote | TEXT? | 상태 사유 |

> **StockStatus vs StockStatusDaily (DAR-486)**: `StockStatus` 는 종목별 **현재 상태 단일행**(upsert)이다.
> 과거 백테스트에 현재 상태를 소급 적용하면 lookahead(미래정보 누설)이므로 백테스트는 이 테이블을
> 참조하지 않는다. 대신 아래 `StockStatusDaily` 일별 이력을 point-in-time 으로 참조한다.

### 7.4.1 StockStatusDaily (stock_status_daily) — DAR-486 신규 (견고화 W3·P25)

종목상태 **일별 이력**. 매 거래일 08:50 종목상태 수집 시점의 이상상태(거래정지·관리종목 등) 스냅샷을
`(stockCode, tradeDate)` 자연키로 **forward-only** 축적한다. 백테스트 어댑터(`prisma-price-data.adapter`)가
일별 플래그를 공급받아 거래정지·관리종목 종목의 진입을 걸러 **생존편향/상한가추격 낙관 편향**을 줄인다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| stockCode | TEXT | 종목코드 6자리 (복합 PK) |
| tradeDate | TEXT | 상태 스냅샷 거래일 YYYYMMDD (수집일 = point-in-time, 복합 PK) |
| isTradingSuspended | BOOL | 거래정지 여부 |
| isManagement | BOOL | 관리종목 여부 |
| isInvestmentCaution | BOOL | 투자주의 여부 |
| isAbnormalSurge | BOOL | 이상급등 여부 |
| statusNote | TEXT? | 상태 사유 |
| createdAt | TIMESTAMP | 적재 시각 |

- **복합 PK** `(stockCode, tradeDate)` — 하루 1행/종목, 같은 날 재수집에도 멱등(upsert).
- **★소급 백필 금지(lookahead 불가침)**: `tradeDate` 는 항상 수집일이며, 과거 날짜의 현재 상태를
  소급 적재하지 않는다. 이력이 없는 과거 거래일은 어댑터가 미설정(false)으로 처리 → forward-only 라
  과거 백테스트 거동은 무변경이고 이력이 쌓일수록 현실성이 좋아진다.
- **저장 절약**: '정상'(전 플래그 false) 종목은 적재하지 않는다(부재 = 정상). 이상상태 행만 남긴다.
- 신선도: cron-health `market.status-collect`(평일 08:50) 로 적재 실행 헬스를 표면화.

### 7.4.2 InvestorFlowDaily (investor_flow_daily) — 갭분석 W16 신규

외국인/기관/개인 **순매수 EOD** 축적. `(stockCode, tradeDate)` 복합 PK, Company FK 없음
(StockStatusDaily 패턴 — 전종목·ETF·비DART 종목 수용). `source`(KRX | KIS)로 적재 어댑터 관측.
**점수화는 SHADOW(가중치 0) 전용** — 활성화는 룰북 §8 재검증 통과 시에만.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| stockCode / tradeDate | TEXT | 복합 PK (6자리 / YYYYMMDD) |
| foreignNetBuyQty / foreignNetBuyAmount | BIGINT | 외국인 순매수 수량·금액 (음수 = 순매도) |
| institutionNetBuyQty / institutionNetBuyAmount | BIGINT | 기관 순매수 수량·금액 |
| individualNetBuyQty / individualNetBuyAmount | BIGINT | 개인 순매수 수량·금액 |
| source | TEXT | "KRX" \| "KIS" |
| createdAt | TIMESTAMP | 적재 시각 |

### 7.4.3 ShortSellingDaily (short_selling_daily) — 갭분석 W16 신규

공매도 일별 통계. **lookahead 불가침**: 공매도 잔고는 T+2 공표이므로 `publishedDate`(공표일)를
분리 저장하고, 백테스트·as-of 조회는 반드시 `publishedDate` 기준으로만 참조한다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| stockCode / tradeDate | TEXT | 복합 PK (6자리 / 거래 기준일 YYYYMMDD) |
| shortSellingVolume / shortSellingAmount | BIGINT / BIGINT? | 공매도 거래량·거래대금 |
| shortBalanceQty / shortBalanceRatio | BIGINT? / FLOAT? | 공매도 잔고 수량·비율(%) — T+2 공표 |
| publishedDate | TEXT | 공표일 YYYYMMDD — as-of 조회 기준 (인덱스) |
| source | TEXT | "KRX" \| "KIS" |
| createdAt | TIMESTAMP | 적재 시각 |

### 7.5 MarketDataCollectionLog (market_data_collection_logs) — DAR-8 신규

KRX EOD 수집 이력 로그 (DART DisclosureCollectionLog 동일 패턴).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| tradeDate | TEXT | 수집 대상 거래일 |
| triggeredBy | TEXT | CRON 또는 MANUAL |
| status | TEXT | RUNNING / SUCCESS / PARTIAL / FAILED |
| stockCount / savedCount / failedCount | INT | 수집 통계 |
| indexSaved / statusSaved | BOOL | 지수·종목상태 저장 여부 |

### 7.6 AI 정책

Engine 3 (Quant Market)의 모든 지표 계산은 **순수 Rule 기반**. LLM/AI 개입 절대 금지.
계산 함수: `backend/src/engine3-quant-market/indicators/indicators.ts`

---

## 8. M5 Event Study 모델 (신규, DAR-9)

### 8.1 EventStudyResult (event_study_results) — DAR-9 신규

이벤트 타입 × 버킷 × 시장 구분 단위의 집계 결과. 자연키: `(eventType, bucketKey, marketType)`.

**목적**: 특정 공시 이벤트가 발생했을 때 통계적으로 유의미한 주가 반응이 있었는지 집계·저장.
매수 신호 점수 계산(Phase 6)의 근거 데이터로 사용된다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| eventType | TEXT | DisclosureEvent.eventType enum 값 |
| bucketKey | TEXT | 버킷 식별자 (규모·특성 세분화 키) |
| marketType | TEXT | "KOSPI" / "KOSDAQ" / "ALL" |
| sampleCount | INT | 집계 표본 수 |
| isSignificant | BOOL | p < 0.05 기준 통계적 유의성 |
| tStatistic | FLOAT? | t-통계량 (INSUFFICIENT시 null) |
| pValue | FLOAT? | p-값 (INSUFFICIENT시 null) |
| variance | FLOAT? | D+1 AR 분산 (과신 방지용) |
| avgReturnD1 / D3 / D5 / D20 | FLOAT | D+N 평균 수익률 (%) |
| avgArD1 / D3 / D5 / D20 | FLOAT | D+N 평균(산술) 초과수익 AR (%) |
| medianArD5 / D20 | FLOAT? | **DAR-402** D+N 누적 AR 중앙값 — 이상치 강건. 재계산 전 행은 null |
| winsorizedMeanArD5 / D20 | FLOAT? | **DAR-402** D+N 누적 AR winsorized 평균(5%/95% clip) — 신호 스코어링 event edge 입력. 재계산 전 행은 null |
| upProbD5 | FLOAT | D+5 기준 상승 확률 (0~1) |
| crashProbD5 | FLOAT | D+5 기준 급락(-5% 이상) 확률 (0~1) |
| avgMaxDrawdown | FLOAT | D0~D+20 평균 최대낙폭 MDD (%) |
| avgVolumeRatioD1 / D3 | FLOAT | D+N 거래량 / D-5 평균거래량 배율 |
| calculatedAt | TIMESTAMP | 집계 실행 시각 |
| dataFromDate / dataToDate | TEXT | 집계 기간 (YYYYMMDD) |
| status | TEXT | READY / INSUFFICIENT / CALCULATING / ERROR |

```prisma
model EventStudyResult {
  @@unique([eventType, bucketKey, marketType])
  @@index([eventType])
  @@index([bucketKey])
  @@index([calculatedAt])
  @@map("event_study_results")
}
```

### 8.2 EventStudyObservation (event_study_observations) — DAR-9 신규

개별 이벤트 관측치. 집계 재현·디버깅·재집계를 위한 원본 데이터 저장.

**목적**: 버킷 집계 결과를 감사(audit)하거나 재집계할 때 개별 이벤트 수준 데이터를 제공한다.
논리 FK로 DisclosureEvent.id를 참조하지만 Prisma relation은 없다(성능·유연성 우선).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | CUID |
| eventId | TEXT | DisclosureEvent.id (논리 FK) |
| rcpNo | TEXT | Disclosure.rcpNo |
| corpCode | TEXT | Company.corpCode |
| eventType | TEXT | 이벤트 타입 |
| bucketKey | TEXT | 버킷 식별자 |
| d0Date | TEXT | 실제 D0 날짜 (YYYYMMDD) |
| dailyReturns | JSONB | {"dm5":…, "d0":…, "d1":…, …} 일별 수익률 |
| dailyAR | JSONB | 일별 초과수익 (주식 - 시장) |
| cumulativeAR | JSONB | d1부터 누적 초과수익 |
| volumeRatios | JSONB | {"d1": 배율, "d3": 배율} |
| maxDrawdown | FLOAT | D0~D+20 최대낙폭 (%) |
| isUpD5 | BOOL | D+5 기준 양수 수익 여부 |
| isCrashD5 | BOOL | D+5 기준 -5% 이하 여부 |
| createdAt | TIMESTAMP | 저장 시각 |

```prisma
model EventStudyObservation {
  @@index([eventType, bucketKey])
  @@index([rcpNo])
  @@index([corpCode])
  @@map("event_study_observations")
}
```

---

## 9. 백업 및 복구 전략

### 9.1 정기 백업
- PostgreSQL `pg_dump` 사용
- 매일 자정 자동 백업 (크론)
- 백업 파일은 S3 또는 GCS에 저장

### 9.2 복구
```bash
pg_restore -d dart_notification backup.sql
```

## 10. 데이터 정리 정책 (향후)

### 10.1 오래된 공시 삭제
- 2년 이상 된 공시는 Archive 테이블로 이동 또는 삭제
- NotificationHistory와의 FK 관계 고려

### 10.2 읽은 알림 삭제
- 90일 이상 지난 읽은 알림은 삭제

---

---

## 11. TradingSignal 모델 (M6-A 신규, DAR-10)

### 11.1 개요

`TradingSignal`은 Buy Score 엔진(M6)의 최종 산출물이다. 공시 이벤트 1건 × Persona 1개 조합으로 생성되며, 자동매수·주문은 절대 금지(참고정보만).

### 11.2 테이블: `trading_signals`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | CUID PK | |
| rcpNo | String | FK → disclosures.rcpNo (자연키) |
| corpCode | String | FK → companies.corpCode (자연키) |
| stockCode | String | 종목코드 6자리 (역정규화) |
| eventType | String | DisclosureEvent.eventType 값 |
| subCategory | String? | 이벤트 세분류 |
| persona | String | 'GROWTH' \| 'VALUE' \| 'MOMENTUM' \| 'EVENT_DRIVEN' |
| buyScore | Int | -100 ~ 100 (정수) |
| calibratedConfidence | Int? | -100 ~ 100 (정수). DAR-91: calibration 등급 보정계수 환류 confidence. 백테스트 실현 적중률이 등급 기대 미만(과대평가)이면 디스카운트. ★점수/confidence 한정 — 원본 buyScore·임계값 불변, 실주문 무관. null = 보정 정보 없음 |
| signal | SignalGrade | 신호 등급 enum |
| scoreBreakdown | Json | 7컴포넌트별 점수 JSON |
| riskPenalty | Int | 차감된 패널티 합계 |
| entryConditionMet | String[] | 충족된 진입 조건 label 목록 |
| entryConditionUnmet | String[] | 미충족 진입 조건 label 목록 |
| entryReady | Boolean | 필수 진입조건 전부 충족 여부 |
| riskFactors | String[] | 리스크 요인 (human-readable) |
| signalSummary | String? | Phase 4 AI 요약 재사용 (새 AI 호출 없음) |
| blockedReason | String? | BLOCKED 사유 |
| validUntil | DateTime? | 신호 유효 시간 |
| isNotified | Boolean | Push 발송 여부 |
| notifiedAt | DateTime? | 발송 시각 |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### 11.3 SignalGrade Enum

| 등급 | 기준 |
|------|------|
| STRONG_BUY_CANDIDATE | buyScore >= 80 |
| BUY_CANDIDATE | 60 ≤ buyScore < 80 |
| WATCH | 30 ≤ buyScore < 60 |
| NEUTRAL | -29 ≤ buyScore < 30 |
| AVOID | buyScore < -29 |
| BLOCKED | 거래정지·관리종목·투자주의·이상급등·차단 이벤트 타입 |

### 11.4 Buy Score 공식 (7컴포넌트)

```
Buy Score = W1×C1 + W2×C2 + W3×C3 + W4×C4 + W5×C5 + W6×C6 + W7×C7 − RiskPenalty
```

| 컴포넌트 | 가중치 | 설명 |
|----------|--------|------|
| C1 DisclosureEventScore | 0.25 | 이벤트 타입 기본 점수 + polarity 보정 |
| C2 KeyMetricScore | 0.20 | 핵심 수치 점수 (계약금액/희석률 등) |
| C3 PersonaFitScore | 0.15 | Phase 4 AI personaViews → Rule 변환 |
| C4 HistoricalEventScore | 0.10 | EventStudyResult robust event edge(winsorizedMeanArD5→medianArD5→avgArD5 폴백) 기반 — DAR-402 이상치 강건화 |
| C5 ChartScore | 0.15 | 기술지표 (MA/RSI/MACD/BB) |
| C6 VolumeLiquidityScore | 0.10 | 거래량·거래대금 수급 |
| C7 MarketSectorScore | 0.05 | KOSPI/KOSDAQ/업종/VIX |
| RiskPenalty | — | 양수 차감. Infinity 시 BLOCKED |

### 11.5 FK 정합

- `TradingSignal.rcpNo` → `Disclosure.rcpNo` (N:1, 공시 1건에 Persona 수만큼 생성)
- `TradingSignal.corpCode` → `Company.corpCode` (N:1)
- 고유 제약: `(corpCode, rcpNo, eventType, persona)` UNIQUE (DAR-125: 원천 멱등 자연키. DisclosureEvent 1:1 로 기존 `(rcpNo, persona)` 와 동치이나 eventType 명시로 향후 1:N 확장 대비. 신호 생성부 upsert 키)

---

## 12. PositionThesis (M7 신규, DAR-11)

**위치**: `engine4-portfolio-exit/`  
**마이그레이션**: `20260604160000_m7_position_thesis`  
**AI 금지영역**: 생성·평가는 순수 Rule 기반. exitRules·maxWeight는 AI 변경 불가. Engine5 Risk가 최종 강제.

### 12.1 ThesisStatus Enum

| 상태 | 설명 |
|------|------|
| ACTIVE | 논리 유효, 추적 중 (초기 상태) |
| INVALIDATED | 무효 조건 충족 → Exit Engine 대상 |
| CLOSED | 포지션 청산 완료 (최종 상태) |

생명주기 FSM: `ACTIVE → INVALIDATED → CLOSED` (역방향 금지)

### 12.2 PositionThesis 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| tradingSignalId | String (UNIQUE FK → trading_signals.id) | 매수 신호 1:1 연결 |
| rcpNo | String (FK → disclosures.rcpNo) | 공시 자연키 |
| corpCode | String (FK → companies.corpCode) | 종목 자연키 |
| entryReason | String | 진입 사유 한 문장 요약 |
| initialThesis | Json (string[]) | 매수 근거 항목 배열 |
| invalidConditions | Json (InvalidCondition[]) | **기계 평가 가능 구조화 조건** (추상 자연어 금지) |
| exitRules | Json (ExitRule[]) | 청산룰, Rule 기반 하드코딩 |
| maxWeight | Float (default 5.0) | 최대 포트폴리오 비중 %, 상한 10% 하드룰 |
| status | ThesisStatus (default ACTIVE) | 생명주기 상태 |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### 12.3 InvalidCondition 타입 (기계 평가 가능 구조)

| type | 평가 소스 | 필수 필드 |
|------|-----------|-----------|
| `PRICE_BELOW` | M4 시세 | `value` (원) |
| `PRICE_ABOVE` | M4 시세 | `value` (원) |
| `AMENDMENT_NEGATIVE` | M2 정정공시 | (없음) |
| `THESIS_METRIC_BREACH` | M4 지표/M5 통계 | `metric`, `threshold` |
| `VOLUME_COLLAPSE` | M4 거래량 | `threshold` (비율 0~1) |
| `EVENT_STUDY_UNDERPERFORM` | M5 EventStudy | `horizon` (D1/D3/D5/D20), `threshold` (%) |
| `STOP_LOSS_PCT` | M4 시세 | `value` (% 손실) |
| `MAX_HOLD_DAYS` | 경과일 | `value` (일) |

### 12.4 FK 정합

- `PositionThesis.tradingSignalId` → `TradingSignal.id` (1:1 UNIQUE)
- `PositionThesis.rcpNo` → `Disclosure.rcpNo` (N:1)
- `PositionThesis.corpCode` → `Company.corpCode` (N:1)
- TradingSignal당 PositionThesis 1건 자동 생성 (BUY 등급만)

---

---

## 13. M8-A Portfolio & Exit 엔진 (DAR-12)

### 13.1 신규 Enum

| Enum | 값 |
|------|----|
| `PositionStatus` | `OPEN`, `CLOSED`, `PARTIAL` |
| `ExitTriggerType` | `STOP_LOSS`, `TAKE_PROFIT`, `THESIS_INVALIDATED`, `TIME_LIMIT`, `CHART_BREAKDOWN`, `REBALANCING` |
| `ExitAction` | `HOLD`, `WATCH`, `REDUCE`, `EXIT`, `BLOCK_REBUY` |

### 13.2 Portfolio 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| userId | String (FK → users.id) | |
| name | String (default "기본 포트폴리오") | |
| currency | String (default "KRW") | |
| isActive | Boolean (default true) | |
| maxSinglePositionPct | Float (default 10.0) | 단일 종목 최대 비중 % — 하드룰 |
| maxSectorPct | Float (default 30.0) | 단일 섹터 최대 비중 % |
| maxDailyLossPct | Float (default 2.0) | 일일 최대 손실 % |
| maxWeeklyLossPct | Float (default 5.0) | 주간 최대 손실 % |
| stopLossGlobalPct | Float (default 15.0) | 전체 포트폴리오 손실한도 % |

### 13.3 Position 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| portfolioId | String (FK → portfolios.id) | |
| corpCode | String (FK → companies.corpCode) | 종목 자연키 |
| stockCode | String | 종목코드 6자리 |
| positionThesisId | String? (UNIQUE FK → position_theses.id) | PositionThesis 1:1 |
| entryDate / entryPrice / quantity / entryAmount | 진입 정보 | |
| currentPrice / currentValue / unrealizedPnl / unrealizedPnlPct | 현재 평가 | 일일 사이클 스냅샷 시 저장값. ★DAR-364: 상태 조회(`/paper-trading/simulation/status`)·손절 평가는 이 저장값이 아니라 **조회 시점 실시간 실가**(`latestPriceRow`: REALTIME→REAL→SYNTHETIC)로 재평가해 표시·엔진이 동일 가격을 쓴다(화면 -20% = 엔진이 손절하는 -20%). |
| stopLossPct / takeProfitPct / maxHoldDays | 리스크 기준 | |
| highestPrice / highestAt | 고점 추적 | 트레일링 스탑용 |
| status | PositionStatus (default OPEN) | |

### 13.4 PositionDailySnapshot 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| positionId | String (FK → positions.id) | |
| snapshotDate | String (YYYYMMDD) | UNIQUE(positionId, snapshotDate) |
| OHLCV / 기술지표 (ma5/ma20/ma60/rsi14/atr14/vwap) | Float? | 일별 스냅샷 |
| exitScore / exitAction | Int? / String? | 당일 Exit 점수·액션 |

### 13.5 ExitSignal 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| positionId | String (FK → positions.id) | |
| checkTime | String | "PRE_MARKET" / "INTRADAY" / "POST_MARKET" |
| lossRiskScore (0~20) / thesisBreakScore (0~20) / chartBreakScore (0~20) / disclosureRiskScore (0~20) / overweightScore (0~10) / timeExceededScore (0~10) / positiveMomentumBonus (0~20 감산) | Int | Exit Score 구성 요소 |
| exitScore | Int | 최종 합산 |
| exitAction | ExitAction | HOLD/WATCH/REDUCE/EXIT/BLOCK_REBUY |
| triggerType / triggerTypes | ExitTriggerType? / String[] | 발동 트리거 |
| triggerRcpNo | String? (FK → disclosures.rcpNo, nullable) | 공시 악재 연결 |
| aiUsed | Boolean (default false) | AI 사용 여부 — Rule 기반이므로 false가 원칙 |

**Exit Score 공식** (순수 Rule, AI 개입 0):
```
Exit Score = lossRiskScore + thesisBreakScore + chartBreakScore
           + disclosureRiskScore + overweightScore + timeExceededScore
           - positiveMomentumBonus
범위: 0~100
0~29: HOLD / 30~49: WATCH / 50~69: REDUCE / 70~89: EXIT / 90+: BLOCK_REBUY
```

### 13.6 PortfolioRiskSnapshot 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| portfolioId | String (FK → portfolios.id) | |
| snapshotDate | String (YYYYMMDD) | UNIQUE(portfolioId, snapshotDate) |
| totalValue / cashAmount / unrealizedPnl / unrealizedPnlPct | Float | 평가 금액 |
| topPositionPct / topSectorPct / openPositionCount | Float/Int | 집중도 위험 |
| dailyPnl / weeklyPnl | Float? | 기간 손익 |
| riskLevel | String (NORMAL/CAUTION/DANGER/CRITICAL) | |
| hardRuleBreached | Boolean (default false) | 하드룰 위반 — AI 금지 영역, Rule만 |

### 13.7 FK 정합

- `Portfolio.userId` → `User.id` (N:1)
- `Position.portfolioId` → `Portfolio.id` (N:1)
- `Position.corpCode` → `Company.corpCode` (N:1 자연키)
- `Position.positionThesisId` → `PositionThesis.id` (1:1 UNIQUE, nullable)
- `PositionDailySnapshot.positionId` → `Position.id` (N:1)
- `ExitSignal.positionId` → `Position.id` (N:1)
- `ExitSignal.triggerRcpNo` → `Disclosure.rcpNo` (nullable)
- `PortfolioRiskSnapshot.portfolioId` → `Portfolio.id` (N:1)

---

## 14. M9-A 백테스트 엔진 (DAR-13)

### 14.1 BacktestRun 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| name | String | 실행 이름 (예: "SUPPLY_CONTRACT_GROWTH_2023") |
| description | String? | 설명 |
| strategyKey | String? | **DAR-404** 트레이딩 로직(전략 변형) 식별 키. `event-edge`/`short-momentum`/`conservative-value`/`aggressive-diversified`. 단일 트랙 리플레이(DAR-385)는 NULL. `@@index([strategyKey])` |
| strategyParams | Json | 전략 파라미터 (eventTypes·personas·minBuyScore·entryRule·exitRules·sizeRule·maxPositions·initialCapital) |
| startDate / endDate | DateTime | 백테스트 기간 |
| universe | String | "WATCHLIST" / "KOSPI200" / "ALL_LISTED" |
| commissionRate | Decimal(6,5) | 수수료율 (예: 0.00015) |
| taxRate | Decimal(6,5) | 매도세 (예: 0.0018) |
| slippagePct | Decimal(6,5) | 슬리피지 (예: 0.003) |
| status | BacktestStatus | PENDING / RUNNING / COMPLETED / FAILED |
| startedAt / completedAt | DateTime? | 실행 시각 |
| errorMessage | String? | 실패 메시지 |
| summary | Json? | 성과 요약 (totalReturn·winRate·mdd·sharpe·worstTrades·realWorldGate·passedGate 등) |

### 14.2 BacktestTrade 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String (PK, cuid) | |
| backtestRunId | String (FK → backtest_runs.id) | CASCADE DELETE |
| disclosureRcpNo | String | 공시 rcpNo (lookahead bias 방지: rcpDt 기준 진입) |
| corpCode / stockCode | String | 종목 식별 |
| eventType / persona | String | 이벤트 타입·페르소나 |
| disclosureAt | DateTime | 공시 실제 접수 시각 |
| isAfterMarket | Boolean | 장마감(15:30) 후 공시 여부 |
| entryDate | DateTime | **다음 거래일 시가 진입** (공시 당일 종가 진입 금지) |
| entryPrice / entryShares / entryValue | Decimal/Int | 진입 가격·수량·금액 |
| exitDate / exitPrice / exitShares / exitValue | Decimal?/Int? | 청산 정보 |
| exitReason | ExitReason? | TAKE_PROFIT / STOP_LOSS / TRAILING_STOP / THESIS_BREAK / MAX_HOLD_DAYS / CHART_BREAK / LIQUIDITY_EXIT / FORCE_EXIT / **DELISTED**(DAR-486 상폐 감액 청산) |
| commission / tax / slippage | Decimal | 비용 |
| grossPnl / netPnl | Decimal? | 수수료 전/후 손익 |
| returnPct / holdDays | Decimal?/Int? | 수익률·보유기간 |
| wasLimitUp / wasLimitDown / wasTradingSuspended / wasAdminStock | Boolean | 현실 제약 플래그 |
| isPartialFill / fillRate / lowLiquidityFlag | Boolean/Decimal? | 부분체결·유동성 플래그 |
| buyScoreSnapshot / exitScoreSnapshot | Int? | 진입 시점 점수 스냅샷 |

### 14.3 lookahead bias 방지 설계

**핵심 원칙:**
1. 각 시점 의사결정에 **그 시점까지의 데이터만** 사용
2. **공시 당일 종가 진입 절대 금지** — 항상 다음 거래일 시가(`entryRule: "NEXT_OPEN"`)
3. `InMemoryPriceDataAdapter.enableLookaheadAudit(date)`로 미래 데이터 접근 시 예외 발생
4. 진입·청산 판정은 해당 일봉 데이터를 받은 시점에만 수행

### 14.4 현실 제약

| 제약 | 구현 |
|------|------|
| 수수료 | 매수·매도 각각 commissionRate 적용 |
| 세금 | 매도 시 taxRate 적용 |
| 슬리피지 | 진입: open × (1 + slippagePct) / 청산: price × (1 - slippagePct) |
| 거래정지 | 진입 불가 (`isTradingSuspended`) |
| 관리종목 | 진입 불가 (`isAdminStock`) |
| 상한가 | 진입 불가 (`isLimitUp`) |
| 부분체결 | 거래량 기반 fillRate (0~1) |
| 유동성 | 거래량 < 10,000주 시 `lowLiquidityFlag` 경고 |

### 14.5 성과 지표

- **totalReturn**: 총수익률(%), **annualizedReturn**: 연환산 수익률
- **winRate**: 승률, **profitFactor**: 손익비 (avgWin×wonCount / |avgLoss×lossCount|)
- **mdd**: 최대낙폭(%, 음수), **sharpe**: Sharpe Ratio (연환산, 무위험수익률 0)
- **worstTrades**: 최악 10거래, **monthlyReturns**: 월별 수익
- **byEventType / byPersona**: 이벤트·페르소나별 성과
- **realWorldGate**: 실전 투입 기준 6개 판정 (allMarketConditions·netPositiveAfterCost·diversified·sufficientSamples·mddAcceptable·recentPeriodConsistent)

### 14.6 FK 정합

- `BacktestTrade.backtestRunId` → `BacktestRun.id` (N:1, CASCADE DELETE)

---

## 15. Engine5 — 모의투자 (M10-A, DAR-16)

> AI 금지영역: 체결·Risk 로직은 순수 Rule. AI 개입 0.

> ★DAR-364 가격 기준(불가침): 보유 포지션의 손익·손절 평가와 상태 조회 표시는 **동일한 가격**을 쓴다.
> `SimulationPriceSourceService.latestPriceRow` 가 **KIS 실시간 실가(REALTIME) 1순위 → 실 KRX 일봉(REAL)
> → 합성(SYNTHETIC)** 순으로 한 종목 한 소스를 결정하고, `PaperSimulationService` 의 `evaluateExits`(손절/익절
> 평가)·`getSimulationStatus`(표시)·`computeMetrics`(equity)가 모두 그 가격을 쓴다. 결과적으로 사용자가
> 화면에서 보는 손실(예: 실시간 -20%)이 곧 엔진이 손절을 평가하는 손실이며, 실시간 실가가 -8% 이하면 하드
> 스탑로스 EXIT 이 발화한다. 실시간 실가는 환경 시계(2026)와 괴리할 수 있어 source 라벨(REALTIME)·원일자로
> 정직 고지한다(2026 실시세 오인 금지).

### 15.1 PaperTrade 모델

가상 주문·체결 기록. 공시 분석에서 생성된 신호(TradingSignal)와 투자 논리(PositionThesis)를 연결하여 실거래 없이 전략 성과를 측정한다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `corpCode` | String | FK → Company.corpCode |
| `stockCode` | String | 종목코드 6자리 |
| `direction` | PaperTradeDirection | BUY / SELL |
| `orderedShares` | Int | 주문 수량 |
| `filledShares` | Int | 체결 수량 |
| `fillRate` | Decimal(5,4) | 체결률 0~1 |
| `entryPrice` | Decimal(12,2) | 진입 기준가 (다음거래일 시가) |
| `filledPrice` | Decimal(12,2)? | 실제 체결가 (슬리피지 반영) |
| `expectedPrice` | Decimal(12,2)? | **DAR-474** 신호시점 기대가(예약 시점 기준가). 체결기가 `entryPrice`를 체결일 시가로 덮어써도 신호→체결 슬리피지 측정을 위해 보존. 측정 표면 전용(additive nullable, 레거시=null·graceful) |
| `commission` | Decimal(12,2) | 수수료 (KRW) |
| `tax` | Decimal(12,2) | 세금: 매도 시 증권거래세 (KRW) |
| `slippage` | Decimal(12,2) | 슬리피지 비용 (KRW) |
| `grossPnl` | Decimal(12,2)? | 총손익 (체결 완료 후) |
| `netPnl` | Decimal(12,2)? | 순손익 |
| `returnPct` | Decimal(8,4)? | 수익률 |
| `status` | PaperTradeStatus | PENDING/FILLED/PARTIAL/CANCELLED/REJECTED |
| `entryDate` | DateTime | 체결 예정 거래일 |
| `filledAt` | DateTime? | 실제 체결 시각 |
| `tradingSignalId` | String? | FK → TradingSignal.id (optional) |
| `positionThesisId` | String? | FK → PositionThesis.id (optional) |

**Enum:**
- `PaperTradeStatus`: PENDING / FILLED / PARTIAL / CANCELLED / REJECTED
- `PaperTradeDirection`: BUY / SELL

**진입 규칙**: 다음거래일 시가 진입 (lookahead bias 방지, 백테스트 일관성)

### 15.2 체결 시뮬레이터 파라미터

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| commissionRate | 0.00015 | 0.015% 수수료 (매수·매도 공통) |
| sellTaxRate | 0.0018 | 0.18% 증권거래세 (매도만) |
| slippagePct | 0.0005 | 0.05% 슬리피지 |
| partialFillThreshold | 0.1 | 유동성비율 10% 미만 시 부분체결 |

### 15.3 FK 정합

- `PaperTrade.corpCode` → `Company.corpCode` (N:1, RESTRICT)
- `PaperTrade.tradingSignalId` → `TradingSignal.id` (N:1, SET NULL)
- `PaperTrade.positionThesisId` → `PositionThesis.id` (N:1, SET NULL)

---

## 16. Engine5 — Risk 엔진 (M11-A, DAR-18)

> **AI 금지영역**: Risk 판정·주문 승인은 순수 Rule. AI 개입 0.

### 16.1 OrderRequest 모델

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `idempotencyKey` | String (unique) | 멱등 주문키 (중복 방지) |
| `corpCode` | String | 종목 종목코드 (FK → Company) |
| `stockCode` | String | 주식 코드 |
| `side` | OrderSide | BUY / SELL |
| `requestedShares` | Int | 주문 수량 |
| `limitPrice` | Decimal? | 지정가 (null = 시장가) |
| `status` | OrderRequestStatus | PENDING/APPROVED/REJECTED/KILLED/EXECUTED/CANCELLED |
| `rejectionReason` | String? | 거부 사유 (하드룰 위반 내용) |
| `capitalSnapshot` | Decimal | 판정 시점 총자산 |
| `dailyLossSnapshot` | Decimal | 판정 시점 당일 손실 |
| `weeklyLossSnapshot` | Decimal | 판정 시점 주간 손실 |
| `positionWeightSnap` | Decimal | 판정 시점 종목 비중 |
| `buyScoreSnapshot` | Int? | Buy Score 스냅샷 (Risk veto 증적) |
| `paperTradeId` | String? | 연결 PaperTrade (섀도 원장 링크, DAR-498) |
| `executionId` | String? | FK → OrderExecution |
| `createdAt` | DateTime | 생성 시각 |

**인덱스**: `idempotencyKey`(unique), `corpCode`, `stockCode`, `status`, `createdAt`

> **섀도 원장 쓰기(DAR-498, 견고화 W2·P22)**: M11 실주문 루프는 미연동이나, 시스템 모의 예약→체결/취소가
> OrderRequest/OrderExecution 에 **병행 기록**된다(모의·실주문 전송 0). 멱등키 접두 `paper-sim-shadow:`
> (= `paper-sim-shadow:<tradingSignalId>`)로 M11 실주문 OrderRequest 와 네임스페이스 분리. status 는
> 예약 시 판정 결과(APPROVED/REJECTED/KILLED) → 체결 시 EXECUTED 로 전이한다(REJECTED→EXECUTED 는
> M11 ENFORCE 라면 차단됐을 주문이 측정 트랙 SHADOW 에서 체결된 관측 신호). **스키마 변경 0**(기존
> 모델 재사용). 일일 원장 대조 잡이 PaperTrade(파생) 대비 건수·수량·금액 정합을 검사한다(불일치→OPS_ALERT).

### 16.2 OrderExecution 모델

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `corpCode` | String | FK → Company |
| `stockCode` | String | 주식 코드 |
| `side` | OrderSide | BUY / SELL |
| `executedShares` | Int | 체결 수량 |
| `executedPrice` | Decimal | 체결가 |
| `commission` | Decimal | 수수료 |
| `tax` | Decimal | 세금 |
| `slippage` | Decimal | 슬리피지 비용 |
| `netAmount` | Decimal | 체결금액 - 비용 |
| `executedAt` | DateTime | 체결 시각 |

**인덱스**: `corpCode`, `executedAt`

### 16.3 TradingAuditLog 모델 (전 주문 audit)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `action` | AuditAction | ORDER_REQUESTED/RISK_PASSED/RISK_REJECTED/KILL_SWITCH_FIRED/ORDER_EXECUTED/ORDER_CANCELLED/KILL_SWITCH_SET/KILL_SWITCH_RESET |
| `actorKind` | String | SYSTEM / RISK_ENGINE / KILL_SWITCH / USER |
| `summary` | String | 한줄 요약 |
| `orderRequestId` | String? | FK → OrderRequest (nullable — Kill Switch 수동 등) |
| `executionId` | String? | FK → OrderExecution |
| `meta` | Json? | 상세 메타 (위반 내용, veto 증적 등) |
| `createdAt` | DateTime | 기록 시각 |

**인덱스**: `action`, `orderRequestId`, `executionId`, `createdAt`

### 16.4 KillSwitchState 모델

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `isActive` | Boolean | Kill Switch 활성 여부 |
| `reason` | String? | 발동 사유 |
| `triggeredBy` | String | SYSTEM / USER |
| `activatedAt` | DateTime? | 활성화 시각 |
| `deactivatedAt` | DateTime? | 비활성화 시각 |

### 16.5 Risk 하드룰 파라미터 (DEFAULT_RISK_LIMITS)

| 규칙 | 기본값 | 설명 |
|---|---|---|
| singleBuyMaxPct | 3% | 1회 매수 최대 비율 |
| singlePositionMaxPct | 10% | 단일 종목 최대 비중 |
| dailyLossMaxPct | -2% | 일간 손실 한도 |
| weeklyLossMaxPct | -5% | 주간 손실 한도 |
| maxOpenOrders | 5 | 최대 미체결 주문 수 |
| maxDailyTrades | 10 | 일간 최대 거래 횟수 |

### 16.6 FK 관계

- `OrderRequest.corpCode` → `Company.corpCode` (N:1, RESTRICT)
- `OrderRequest.executionId` → `OrderExecution.id` (N:1, SET NULL)
- `OrderExecution.corpCode` → `Company.corpCode` (N:1, RESTRICT)
- `TradingAuditLog.orderRequestId` → `OrderRequest.id` (N:1, SET NULL)
- `TradingAuditLog.executionId` → `OrderExecution.id` (N:1, SET NULL)

---

## 17. Engine2 — AI 비용 거버넌스 (M10-B, DAR-17)

> AI 금지영역: 비용 게이트·한도 가드는 순수 Rule. LLM 개입 0.

### 17.1 AIUsageLog 모델 (기존 M3 모델, 집계 기반)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | String (cuid) | PK |
| `rcpNo` | String | 공시 접수번호 (FK → Disclosure.rcpNo) |
| `task` | AiTaskName | summary / event_classification / persona_interpretation / position_thesis |
| `level` | AiCostLevel | L0 / L1 / L2 / L3 |
| `model` | String | 사용 LLM 모델명 |
| `inputTokens` | Int | 입력 토큰 수 |
| `outputTokens` | Int | 출력 토큰 수 |
| `costUsd` | Float | 비용 (USD) |
| `cacheHit` | Boolean (default false) | **DAR-241**: 멱등 캐시히트(비용0 재사용) 표식. true 행은 실호출 비용/L0 집계에서 제외하고 적중률 관측에만 사용 |
| `createdAt` | DateTime | 기록 시각 |

**인덱스**: `rcpNo`, `task`, `level`, `createdAt`, `cacheHit`

> **DAR-241**: AiAnalystService 의 멱등 캐시히트는 과거 `findAnalysis` 반환 시점에 `logUsage` 전에 즉시 반환되어 AIUsageLog 에 전혀 기록되지 않았다(재처리 시 '비용0 재사용'이 통계에서 소멸 → AI 활용률 과소보고). 이제 캐시히트는 `cacheHit=true · 비용0 · 토큰0` 행으로 경량 기록한다. 실호출 집계(`getUsageSummary`)는 `cacheHit=false` 로 필터해 기존 지표를 보존하고, 적중률은 `getCacheHitCount`(cacheHit=true count)로만 별도 노출한다.

### 17.2 비용 집계 서비스 (AiCostAggregationService)

`AIUsageLog`를 기간별로 집계. 읽기 전용 — DB 직접 쿼리, AI 비호출.

| 지표 | 계산식 |
|---|---|
| `totalCostUsd` | SUM(costUsd) — cacheHit=false 만 |
| `callCount` | COUNT(*) — cacheHit=false 만 |
| `l0Ratio` | COUNT(level=L0) / COUNT(*) — cacheHit=false 만 |
| `costPerDisclosure` | totalCostUsd / DISTINCT(rcpNo) |
| `cacheHitCount` | **DAR-241**: COUNT(cacheHit=true) — 멱등 캐시 적중률 관측(health/metrics 노출) |
| `costPerSignal` | totalAiCostKrw / TradingSignal.count |
| `costPerTrade` | totalAiCostKrw / PaperTrade.count |

### 17.3 비용 한도 가드 (AiCostLimitGuardService — 순수 Rule)

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `DAILY_LIMIT_USD` | 1.0 | 일 누적 한도 초과 시 L0 강등 |
| `MONTHLY_LIMIT_USD` | 20.0 | 월 누적 한도 초과 시 L0 강등 |

- 한도 초과: `forcedLevel = L0` (AI 호출 차단)
- 한도 미달: `forcedLevel = null` (원래 게이트 레벨 유지)

### 17.4 L0 비율 모니터

- 목표: L0 비율 ≥ 70% (AI 미사용 비율 극대화)
- 임계 미달(`l0Ratio < 0.7`) 시 `AiCostMetrics.l0Warning = true`

---

## 18. 리포지토리 영속화 계층 (DAR-35/36)

### 18.1 개요

Engine4·Engine5의 도메인 모델은 **헥사고날 포트/어댑터 패턴**으로 영속화 구현이 교체 가능하다.
Prisma 스키마 변경 없이 기존 모델(§12~§16)을 그대로 사용하여 InMemory → Prisma 어댑터로 전환했다.

### 18.2 Engine4 — PositionThesis · ExitSignal (DAR-35)

| 포트 인터페이스 | InMemory 어댑터 | Prisma 어댑터 |
|----------------|----------------|--------------|
| `IPositionThesisRepository` | `in-memory-position-thesis.repository.ts` | `prisma-position-thesis.repository.ts` |
| `IExitSignalRepository` | `in-memory-exit-signal.repository.ts` | `prisma-exit-signal.repository.ts` |

- **사용 모델**: `PositionThesis` (§12), `ExitSignal` (§13.5)
- **스키마 변경**: 없음. 기존 마이그레이션(`20260604160000_m7_position_thesis` 외) 그대로 사용.
- **전환 결과**: `PositionThesisService`·`ExitSignalService`가 Prisma 어댑터를 주입받아 영구 저장.

### 18.3 Engine5 — PaperTrade · TradingAuditLog (DAR-36)

| 포트 인터페이스 | InMemory 어댑터 | Prisma 어댑터 |
|----------------|----------------|--------------|
| `IPaperTradeRepository` | `in-memory-paper-trade.repository.ts` | `prisma-paper-trade.repository.ts` |
| `IAuditLogRepository` | `in-memory-audit-log.repository.ts` | `prisma-audit-log.repository.ts` |

- **사용 모델**: `PaperTrade` (§15.1), `TradingAuditLog` (§16.3)
- **스키마 변경**: 없음. 기존 모델 사용.
- **전환 결과**: 모의투자 체결 기록·감사 로그가 재시작 후에도 유실되지 않음.

### 18.4 AI 정책

- Engine4·Engine5의 영속화 로직은 **순수 Rule 기반**. AI 개입 없음.
- Prisma 어댑터는 DB 입출력만 담당하며 도메인 계산은 서비스 계층에 위임.

---

## 19. Engine1 — InsiderHoldingChange (DAR-87, 내부자·대량보유 지분변동)

DART 정형 엔드포인트 2종을 수집·정규화한 행. 미공개 펀더멘털 주체(내부자·5%보유자)의
매매는 강한 행동신호 → Main Thesis A 데이터원. 순수 Rule(AI 미개입).

- 출처: `majorstock.json`(주식등의 대량보유상황보고, 5%룰) → `source='MAJOR_STOCK'`,
  `elestock.json`(임원·주요주주 특정증권등 소유상황보고) → `source='EXECUTIVE'`.
- 자연키: `corpCode` FK → `companies`. 멱등키: `@@unique([source, rcptNo, reporter])`.
- 주요 컬럼: `reporter`·`relation`·`isExecutive/isRegistered/isMajorShareholder`(elestock 전용)·
  `sharesAfter`·`sharesChange`·`ratioAfter`·`ratioChange`·`tradeType`(BUY/SELL/MIXED/UNKNOWN)·
  `unitPrice`·`reportReason`·`reportedAt`.
- 인덱스: `corpCode`·`tradeType`·`reportedAt`.
- EventType 가산 3종: `INSIDER_BUY`(POSITIVE)·`INSIDER_SELL`(NEGATIVE)·`MAJOR_HOLDER_5PCT`.
- 마이그레이션: `20260607100000_dar87_insider_holding_change` (★파일만 생성 — 휴먼 적용).

## 20. Engine1 — DisclosureDocument.rawText S3 오프로드 (DAR-395, 용량/경량화)

대용량 공시 원문(`disclosure_documents.rawText`, 약 1.7GB·증가중)은 추출 시점에만 필요한 콜드
데이터다. 멀티이어 백필 시 수십~수백 GB 로 폭증하므로 객체 스토리지(S3/로컬)로 오프로드하고 DB 는
메타데이터 + 구조화 결과(`parsedJson`/`tables`) + 포인터만 보유한다.

- 신규 컬럼: `rawTextS3Key String?` — 오프로드된 원문 객체 키(`disclosure-rawtext/{rcpNo}.txt.gz`).
  미오프로드 행은 NULL(이 경우 `rawText` 컬럼이 원문 보유).
- `rawText String?` 의미 변경: 오프로드 완료 시 NULL 로 비운다(미오프로드/오프로드 실패분은 유지).
  → DB 행 경량화. AI excerpt 조회는 `rawTextS3Key` 로 lazy fetch(`RawTextStoreService`).
- 쓰기: 파싱 완료 시점 gzip 업로드 후 컬럼 비움(멱등). 실패 시 graceful(rawText 보존·데이터 손실 0).
- 마이그레이션: `20260620010000_dar395_rawtext_s3_key` (★파일만 생성 — 휴먼 적용, 순수 가산 nullable 컬럼).
  기존분 이전은 `RawTextOffloadScheduler`(매 10분)·`POST /api/pipeline/rawtext-offload`(멱등) 가 담당.
  디스크 회수는 운영 `VACUUM`(docs/deployment.md §객체 원문 S3 오프로드 운영).

## 21. Engine1 — DisclosureDocument.tables S3 오프로드 (DAR-399, TOAST 진짜 bulk 해소)

rawText 전량 오프로드(§20) 후에도 `disclosure_documents` 가 1.7GB 잔존했다. TOAST 분해(실측)
결과 **진짜 bulk 는 rawText 가 아니라 `tables` JSONB(약 1,619MB·58k 문서)** 였다(`parsedJson` 은 5MB뿐
이라 콜드가 아니며 DB 유지). 따라서 `tables` 도 rawText 와 동일 패턴으로 객체 스토리지로 오프로드한다.

- 신규 컬럼: `tablesS3Key String?` — 오프로드된 표 객체 키(`disclosure-tables/{rcpNo}.json.gz`, JSON+gzip).
  미오프로드 행은 NULL(이 경우 `tables` 컬럼이 표 보유).
- `tables Json?` 의미 변경: 오프로드 완료 시 `Prisma.DbNull`(SQL NULL)로 비운다(미오프로드/실패분은 유지).
  → DB 행 경량화. SHARE_BUYBACK 폴백 스캔(재추출)은 `tablesS3Key` 로 lazy fetch(`TablesStoreService`).
  추출 hot read 입력인 `parsedJson` 은 오프로드하지 않는다(5MB·매 추출 조회).
- 쓰기: 파싱 완료 시점 JSON+gzip 업로드 후 컬럼 비움(멱등). 실패 시 graceful(tables 보존·데이터 손실 0).
- 마이그레이션: `20260621010000_dar399_tables_s3_key` (★파일만 생성 — 휴먼 적용, 순수 가산 nullable 컬럼).
  기존분 이전은 `TablesOffloadScheduler`(매 10분)·`POST /api/pipeline/tables-offload`(멱등) 가 담당.
  디스크 회수는 운영 `VACUUM`(docs/deployment.md §객체 원문 S3 오프로드 운영).

## 22. Engine1 — DisclosureDocument 원본 HTML 저장 S3 고정 (DAR-401, 로컬 디스크 제거)

공시 원본 HTML 은 fetch 시 `LocalStorageService` 가 로컬 디스크 `storage/{rcpNo}/index.html` 에 쓰고
경로를 `rawFilePath` 에 기록했다(23GB·58,683건 누적·런타임 미사용 쓰기전용). 저장 장소를 S3/객체
스토리지로 **고정**하고 로컬 디스크 저장/조회 경로를 제거한다.

- 신규 컬럼: `rawHtmlS3Key String?` — 저장된 원본 HTML 객체 키(`disclosure-rawhtml/{rcpNo}.html.gz`, gzip).
  미저장/레거시 행은 NULL.
- `rawFilePath String?` 의미 변경: 레거시 로컬 디스크 경로였으며 **더 이상 신규 기록하지 않는다**(fetch 시 NULL).
  과거 행의 값은 보존(비파괴).
- 쓰기: fetch 단계에서 원본 HTML 을 gzip 업로드(`RawHtmlStoreService.save`) 후 키만 기록(로컬 디스크 write 0).
  실패 시 graceful(키 NULL·파이프라인 무중단 — 원본 HTML 은 쓰기전용 콜드 데이터). 읽기(재파싱 등)는
  `rawHtmlS3Key` 로 lazy fetch(`RawHtmlStoreService.load`).
- 마이그레이션: `20260621020000_dar401_raw_html_s3_key` (★파일만 생성 — 휴먼 적용, 순수 가산 nullable 컬럼).
  기존 23GB 로컬분의 S3 이전은 별도 데이터 마이그레이션이 담당한다.
- `LocalStorageService`(engine1-disclosure/.../storage/storage.service.ts)는 `@deprecated` — provider 등록 해제.

---

## 23. 횡단 — CompanyOverview (company_overviews)

**목적**: DART 기업개황 API 결과 캐시. 기업 상세 화면의 대표자·주소·홈페이지 등 부가 정보를 제공한다. Company 와 별도 테이블(수집 시점 분리·Prisma relation 없음).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| corpCode | String PK | DART 고유번호 (자연키, Company.corpCode 와 논리 1:1) |
| corpName / corpNameEng / stockName | String / String? | 기업명·영문명·종목명 |
| ceoName / corpCls / address / homepageUrl | String? | 대표자·법인구분·주소·홈페이지 |
| industryCode / estDate / accMonth | String? | 업종코드·설립일·결산월 |
| fetchedAt | DateTime | 수집 시각 (default: now()) |

**관계·인덱스**: PK 외 인덱스 없음. FK 없음(수집 캐시 — corpCode 논리 참조).

## 24. 횡단 — SavedDisclosure (saved_disclosures)

**목적**: 사용자가 저장(북마크)한 공시 목록.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| userId | String | FK → users.id (Cascade) |
| disclosureRcpNo | String | FK → disclosures.rcpNo (Cascade) |
| createdAt | DateTime | 저장 시각 |

**인덱스·제약**:
- Composite Unique: `(userId, disclosureRcpNo)` — 중복 저장 방지
- `(userId, createdAt)` — 저장 목록 최신순 조회

## 25. 횡단 — CronRunLog (cron_run_logs) — DAR-110

**목적**: 자체 로그가 없던 경량 크론(신호생성·모의운용·내부자수집·파싱재처리 등)의 실행 헬스를 통일 기록하는 단일 출처. freshness(데이터 신선도) 판정 입력 — '조용히 멈춘' 수집 인지용 메타 전용. 도메인별 `*CollectionLog`(공시·재무·시세)와 별개. 사용처: `cron-health/`(CronRunRecorderService·DataFreshnessService).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| jobKey | String | 크론 식별 키 (예: "signal.generate", "paper.simulation", "insider.daily", "parse.retry") |
| status | String | RUNNING / SUCCESS / FAILED / SKIPPED (default: RUNNING) |
| itemCount | Int | 처리/신규 건수 (도메인별 의미) |
| durationMs | Int? | 실행 소요 ms (미완료 시 null) |
| errorMessage | String? | 실패 메시지 |
| triggeredBy | String | CRON / MANUAL |
| startedAt / finishedAt | DateTime / DateTime? | 시작·종료 시각 (RUNNING 중 finishedAt=null) |

**인덱스**: `(jobKey, startedAt)` 잡별 최근 실행 · `(jobKey, status, finishedAt)` 잡별 최근 성공 · `status`. FK 없음.

## 26. Engine1 — DisclosureCollectionLog (disclosure_collection_logs) — M0

**목적**: DART 공시 수집(크론/수동) 실행 이력. 수집 정체 진단·관측성의 원본 로그 (MarketDataCollectionLog·FinancialCollectionLog 의 원형 패턴).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | Int PK | autoincrement |
| startedAt / endedAt | DateTime / DateTime? | 수집 시작·종료 (RUNNING 중 endedAt=null) |
| bgnDe / endDe | String | 수집 대상 기간 (YYYYMMDD) |
| fetchedCount / newCount / skippedCount / failedCount | Int | DART 수신·신규 저장·중복 스킵·실패 건수 |
| status | String | RUNNING / SUCCESS / PARTIAL / FAILED |
| errorMessage | String? | 실패 메시지 |
| triggeredBy | String | CRON / MANUAL |

**인덱스**: `startedAt`(최근 N건) · `status` · `triggeredBy`. FK 없음.

## 27. Engine1 — DisclosureEvent (disclosure_events) — M2

**목적**: 공시 원문(DisclosureDocument)에서 Rule 기반으로 추출한 이벤트 분류·핵심 수치. 공시 1건 = 이벤트 1건 원칙(복수 이벤트는 `extractedData.events[]` 배열 + 우선순위 높은 eventType 단일 지정). Event Study·신호 생성의 입력.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| rcpNo | String UNIQUE | FK → disclosures.rcpNo (1:1) |
| corpCode | String | FK → companies.corpCode (역정규화, 조회 성능) |
| eventType | EventType | 이벤트 타입 enum — 우선 추출 7종(SUPPLY_CONTRACT 등) + 지분변동 3종(DAR-87) + 미모델 분류 확대 18종(DAR-346, OTHER 축소) + OTHER |
| extractedData | Json | 이벤트별 핵심 수치 (실패 시 `{}`) |
| polarity | String | POSITIVE / NEGATIVE / MIXED / UNKNOWN |
| confidence | Float | 0.0~1.0 (Rule ≥ 0.85, AI 보조 0.6~0.85) |
| isAiAssisted | Boolean | confidence < 0.85 시 AI L1 개입 여부 |
| extractionStatus | ExtractionStatus | PENDING / SUCCESS / FAILED / NEEDS_REVIEW |
| isAmendment / originalRcpNo | Boolean / String? | 정정공시 연결 |
| extractedAt / updatedAt | DateTime | |

**인덱스**: `corpCode` · `eventType` · `polarity` · `extractionStatus` · `extractedAt` · `isAmendment` · `(corpCode, extractedAt)`(DAR-276 기업별 이벤트 목록 커버).

## 28. Engine1 — DartFiledFact (dart_filed_facts) — DAR-95

**목적**: 공시 본문 정량표의 값을 표준 `factKey`(예: CONTRACT_AMOUNT, CB_CONVERSION_PRICE)로 정규화해 영구 적재하는 분석 자산. 기존에 이벤트당 1회성으로 휘발 소비되던 parsedJson 정량값의 자산화 (Main Thesis A). AI 미개입·신규 외부 호출 0(이미 받은 XML 재활용).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| rcpNo | String | FK → disclosures.rcpNo (Cascade) |
| corpCode | String | FK → companies.corpCode (역정규화) |
| factKey | String | 표준 키 |
| value / numericValue / unit / period | String / Float? / String? / String? | 정규화 값·숫자값·단위·기간 |
| sectionPath / docType | String? | 추출 출처 경로·소스 이벤트 유형 (재처리 추적) |

**인덱스·제약**:
- Composite Unique: `(rcpNo, factKey)` — 한 공시 내 factKey 유일 (멱등 upsert)
- `corpCode` · `factKey`

## 29. Engine1 — CompanyFinancial (company_financials) — DAR-52

**목적**: DART 단일회사 전체 재무제표(fnlttSinglAcntAll) 기반 기업 재무지표. 수집은 `engine1-disclosure/financials/`, 소비는 Engine2 Persona P-B 스코어러·Engine3 BuyScore keyMetric. AI 미개입(순수 데이터/Rule 파생비율).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| corpCode | String | FK → companies.corpCode |
| stockCode | String? | 역정규화 (조회 성능) |
| bsnsYear / reprtCode / fsDiv | String | 사업연도·보고서코드(11011연간/11012반기/11013 1Q/11014 3Q)·연결구분(CFS/OFS) |
| revenue / operatingProfit / netIncome / totalAssets / totalLiabilities / totalEquity | BigInt? | 핵심 지표 (원 — 조 단위 안전 저장) |
| eps / bps | Float? | 주당 지표 |
| roe / roa / debtRatio | Float? | 파생 비율 % (재무제표만으로 산출) |
| per / pbr | Float? | 시세 결합 파생 (가능 시 보강) |
| revenueGrowthYoY / operatingProfitGrowthYoY / epsGrowthYoY / …QoQ | Float? | DAR-93 다년 시계열 성장률 (결측 시 null) |
| rceptNo | String? | 원천 공시 접수번호 (추적용) |

**인덱스·제약**:
- Composite Unique: `(corpCode, bsnsYear, reprtCode, fsDiv)` — 멱등 upsert 자연키
- `corpCode` · `bsnsYear`

## 30. Engine1 — FinancialCollectionLog (financial_collection_logs)

**목적**: 재무지표 수집 실행 로그 — 수집 서비스 멱등성·관측성 (MarketDataCollectionLog 패턴).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| bsnsYear / reprtCode / fsDiv | String | 수집 대상 사업연도·보고서코드·연결구분 |
| triggeredBy | String | MANUAL / CRON |
| status | String | RUNNING / SUCCESS / PARTIAL / FAILED |
| targetCount / savedCount / skippedCount / failedCount | Int | 대상·성공·스킵·실패 기업 수 |
| errorMessage | String? | 실패 메시지 |
| startedAt / endedAt | DateTime / DateTime? | 실행 시각 |

**인덱스**: `bsnsYear` · `status`. FK 없음.

## 31. Engine2 — DisclosureAnalysis (disclosure_analyses) — M3

**목적**: AI 분석 태스크 실행 결과의 멱등 캐시. 같은 공시×태스크 재처리 시 AI 재호출 없이 재사용(비용 0) — AIUsageLog `cacheHit=true` 경량 기록과 연동(DAR-241, §17.1).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| rcpNo | String | FK → disclosures.rcpNo (Cascade) |
| task | AiTaskName | summary / event_classification / persona_interpretation / position_thesis |
| level | AiCostLevel | L0 / L1 / L2 / L3 |
| resultJson | Json | 태스크 실행 결과 |
| createdAt | DateTime | |

**인덱스·제약**:
- Composite Unique: `(rcpNo, task)` — 멱등 캐시 키
- `rcpNo` · `task` · `createdAt`

## 32. Engine2 — PersonaAnalysis (persona_analyses) — M3

**목적**: persona-interpretation 태스크 결과(4 persona 관점 해석)를 공시당 1행으로 구체화. TradingSignal C3(PersonaFitScore)의 입력.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| rcpNo | String UNIQUE | FK → disclosures.rcpNo (1:1, Cascade) |
| resultJson | Json | PersonaInterpretation 전체 JSON |
| philosophyId | String? | FK → investor_philosophies.philosophyId (SetNull) — P-A 철학 연결 |

**인덱스**: `rcpNo` · `philosophyId`.

## 33. Engine2 — InvestorPhilosophy (investor_philosophies)

**목적**: 유명 투자자 철학 마스터 (예: 'BUFFETT', 'LYNCH', 'GREENBLATT', 'DRUCKENMILLER'). P-B 철학 적합도 스코어러가 참조. 기존 4 persona(VALUE/GROWTH/MOMENTUM/EVENT_DRIVEN)와 styleTags 로 연계.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| philosophyId | String PK | 자연키 (예: 'BUFFETT') |
| investorName | String | 투자자 이름 |
| styleTags / corePrinciples / applicableAssets / checklistItems | String[] | 스타일 태그·핵심 원칙·적용 자산군·체크리스트 |
| riskProfile | String | 리스크 성향 |
| scoreFormula | String? | 스코어 산식 설명 (0~100, 참고용) |

**관계·인덱스**: `metrics PhilosophyMetric[]` · `sources PhilosophySource[]` · `personaAnalyses PersonaAnalysis[]`. 인덱스: `investorName`.

## 34. Engine2 — PhilosophyMetric (philosophy_metrics)

**목적**: 철학별 정량 지표 매핑 (ROE·부채비율·PER·해자 등) — 철학 적합도 점수 계산의 Rule 입력.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| philosophyId | String | FK → investor_philosophies (Cascade) |
| metricKey | String | 지표 키 (예: 'ROE', 'DEBT_RATIO', 'PER', 'MOAT_SCORE') |
| operator | PhilosophyMetricOperator | GT / LT / EQ / RANGE |
| threshold / thresholdMax | Float / Float? | 기준값 (RANGE 는 하한/상한) |
| weight | Float | 가중치 0~1 (철학 내 합산 = 1) |
| description | String | 지표 설명 |

**인덱스·제약**: Composite Unique `(philosophyId, metricKey)` — 시드 멱등성 · `philosophyId`.

## 35. Engine2 — PhilosophySource (philosophy_sources)

**목적**: 철학의 공개 자료 출처 (신뢰 근거 — 책·주주서한·인터뷰·공개발언).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| philosophyId | String | FK → investor_philosophies (Cascade) |
| type | PhilosophySourceType | BOOK / SHAREHOLDER_LETTER / INTERVIEW / PUBLIC_STATEMENT |
| title / year / url | String / Int / String? | 자료 제목·연도·공개 URL |

**인덱스·제약**: Composite Unique `(philosophyId, title)` — 시드 멱등성 · `philosophyId`.

## 36. Engine5 — SignalEntryFunnelDaily (signal_entry_funnel_daily)

**목적**: 모의운용 진입 퍼널의 일별 누적 카운트 — '당일 생성 신호 수 → 진입 후보 통과 수 → 실제 체결 수'. M10 졸업 표본(G1/G2/G5) 측정용. fill/adoption rate 는 read 시 파생 산출(저장하지 않음 — 단일 출처). ★모의 전용·실주문 무관·AI 미개입(순수 카운트).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| portfolioId | String | FK → portfolios.id (Cascade) |
| tradeDate | String | 거래일 YYYYMMDD |
| signalsGenerated | Int | 당일 생성된 매수 신호 수 (퍼널 최상단) |
| candidatesPassed | Int | 진입 후보 선정(보유중복·슬롯 필터) 통과 수 |
| filled | Int | 실제 모의 체결(신규 매수) 수 |

**인덱스·제약**: Composite Unique `(portfolioId, tradeDate)` — 멱등키 · `(portfolioId, tradeDate)` 인덱스.

## 37. Engine5 — IntradayScalpTrade (intraday_scalp_trades) — DAR-411

**목적**: 분봉 단타(intraday scalping) 모의전략 트랙. 당일 진입·당일 청산 forward-only 페이퍼 트랙(분봉이 당일 forward-only 라 백테스트 불가). PaperTrade(per-fill)와 달리 **1행 = 1라운드트립(진입+청산)**. 15:20 강제청산(FORCE_CLOSE_EOD).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| corpCode / stockCode | String | 자연키 — 인덱스만, FK 없음 (StockMinutePrice 동일 패턴) |
| tradeDate | String | YYYYMMDD (KST 거래일) |
| entryTs / entryPrice / shares / entryReason | DateTime / Decimal(12,2) / Int / String | 진입 분봉 시각·체결가(슬리피지 반영)·수량·사유 태그(예: VOLUME_BREAKOUT_VWAP) |
| entryVwap / entryVolumeRatio | Decimal? | 진입 시 당일 VWAP·거래량 배수 |
| exitTs / exitPrice / exitReason / holdMinutes | DateTime? / Decimal? / String? / Int? | 청산 정보 — TAKE_PROFIT / STOP_LOSS / FORCE_CLOSE_EOD |
| commission / tax / slippage | Decimal(12,2) | 비용 (KRW) |
| grossPnl / netPnl / returnPct | Decimal? | 손익·수익률 |
| status | String | OPEN / CLOSED |
| styleTag | String | 트랙 식별 태그 (default: "intraday-scalp", SSOT) |

**인덱스**: `status` · `tradeDate` · `stockCode` · `corpCode` · `styleTag`.

## 38. Engine5 — BacktestForwardDivergenceSnapshot (backtest_forward_divergence_snapshots) — DAR-479

**목적**: 백테스트(리플레이) vs forward(실운용) 성과 괴리의 일별 스냅샷(추세 추적용). 리플레이 트랙(`BacktestRun.strategyKey`, 과거 1년 재생)과 forward 트랙(`styleTag='strategy:<key>'`)을 strategyKey 로 조인한 괴리(수익률·승률·거래빈도·보유기간)를 매일 1행 적재. 졸업 판정 핵심 지표. ★측정·적재 전용 — 트레이딩 행동(매수·체결·청산) 무접촉·AI 미개입(순수 산술). 표본 부족(백테스트<20·forward<5)은 `lowSample=true` 정직 표기.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| strategyKey | String | 전략 변형 키(event-edge 등) — 자연 그룹핑 키, 인덱스만(FK 없음) |
| snapshotDate | String | 거래일 YYYYMMDD (KST) |
| backtestReturnPct / backtestWinRate / backtestTradeCount / backtestAvgHoldDays / backtestTradesPerMonth | Float? / Float? / Int / Float? / Float? | 리플레이 기준값(승률 0~1·거래빈도 월 환산). 표본 0이면 null |
| forwardReturnPct / forwardWinRate / forwardTradeCount / forwardAvgHoldDays / forwardTradesPerMonth | Float? / Float? / Int / Float? / Float? | forward 실운용 누적값(동일 척도) |
| returnGapPct / winRateGap / tradeFreqGap / holdDaysGap | Float? | 괴리 = forward − backtest (양쪽 산출 가능할 때만) |
| lowSample | Boolean (default true) | 표본 부족 정직 표기(과신 방지) |
| createdAt / updatedAt | DateTime | 생성·갱신 시각 |

**인덱스·제약**: Composite Unique `(strategyKey, snapshotDate)` — 멱등키 · `(strategyKey, snapshotDate)` 인덱스.

## 39. Engine5 — DualMomentumForwardTrade (dual_momentum_forward_trades) — DAR-494 [견고화 W1·P13]

**목적**: 듀얼모멘텀 코어 forward 트랙(모의)의 ETF 단일 보유 월말 리밸런싱 이력. ETF(360750/069500/153130/273130)는 DART corpCode 가 없어 Position/PaperTrade(→Company FK 필수)에 부적합 → **FK 없는 전용 모델**(EtfDailyPrice·IntradayScalpTrade 전례, 자연키 etfCode). **1행 = 1보유 라이프사이클** — PENDING(익일 시가 매수 예약) → OPEN(체결·보유) → CLOSED(다음 리밸런싱 SWITCH 매도). 결측/이월 상한 초과는 CANCELLED. 활성 근거: 룰북 §9.3.2 위험조정 게이트 통과(사람 승인 2026-07-03). ★가산·데이터층 전용 — 기존 측정 트랙 무접촉(M10 클록 안전). AI 미개입(판정=engine3 순수 함수).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| etfCode | String | 대상/보유 ETF 6자리 단축코드 (자연키, 인덱스 없음 — styleTag 로 조회) |
| styleTag | String | 트랙 식별 태그 (default "alloc:dual-momentum", 룰북 §9.2 SSOT) |
| status | String | PENDING / OPEN / CLOSED / CANCELLED (default PENDING) |
| decisionDate / entryTradeDate | String | 월말 판정 거래일 · 체결 예정 거래일(=nextTradingDay) YYYYMMDD |
| reservedShares / reservedPrice | Int / Decimal(12,2) | 예약 명목 수량·기준가(판정일 종가 — 사이징 근거) |
| entryTs / entryPrice / shares | DateTime? / Decimal(12,2)? / Int | 매수 체결 시각·체결가(슬리피지 반영)·체결 수량 |
| exitTs / exitDate / exitPrice | DateTime? / String? / Decimal(12,2)? | 매도(리밸런싱 SWITCH) 체결 정보 |
| commission / tax / slippage | Decimal(14,2) | 비용 누적 (KRW) — tax 는 ETF 면제 → 0 |
| grossPnl / netPnl / returnPct | Decimal? | 손익·수익률(비용 후) |
| createdAt / updatedAt | DateTime | 생성·갱신 시각 |

**인덱스**: `status` · `styleTag` · `entryTradeDate` · `decisionDate`. (마이그레이션 `20260703160000_dar494_dual_momentum_forward_trade` — create-only)

---

## 40. Engine5 — RiskDecisionLog (risk_decision_logs) — DAR-496 [견고화 W2·P18]

**목적**: RiskGuard 공용 진입 게이트(일일손실 한도 + 현금 불변식)가 전 트랙 진입 확정 직전에 남기는 판정 이력. 측정 트랙(시스템 모의·철학·전략 forward·분봉)은 SHADOW(위반 기록만·차단 0), 듀얼모멘텀 코어 forward 는 ENFORCE(위반 시 BLOCK). 기존 TradingAuditLog 는 OrderRequest/OrderExecution(M11 실주문 루프) 전용 스키마 + 닫힌 AuditAction enum 이라, 주문 FK 없는 페이퍼 진입 게이트의 고빈도 SHADOW 텔레메트리에 부적합 → DAR-494 전례처럼 **FK 없는 전용 additive 모델**로 분리(택1 근거). ★가산·관측층 전용 — 기존 측정 트랙 무접촉(M10 클록 안전). AI 미개입(판정=순수 게이트).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| track | String | paper-simulation / philosophy-style / strategy-forward / intraday-scalp / dual-momentum-forward (인덱스) |
| mode | String | SHADOW / ENFORCE |
| action | String | ALLOW / SHADOW_VIOLATION / BLOCK (인덱스) |
| tradeDate | String | 판정 거래일 YYYYMMDD (일 1회 dedupe 버킷, 인덱스) |
| totalCapital | Decimal(16,2) | 트랙 가상원금 |
| dailyRealizedPnl | Decimal(16,2) | 당일 실현손익(음수=손실) |
| availableCash | Decimal(16,2) | 진입 직전 가용현금 |
| entryBudget | Decimal(16,2) | 이번 진입 예산(체결 예상 진입원가) |
| violationCodes | String | 위반 코드 콤마 구분 (예 "DAILY_LOSS,CASH_GUARD", 없으면 "") |
| corpCode / stockCode | String? | 진입 대상 식별 |
| meta | Json? | 위반 상세·killSwitchActive 등 관측용 부가 컨텍스트. `kind` 로 판정 종류 구분: (없음)=진입 게이트(P18) · `DRAWDOWN_CUT`(P19) · `AUTO_KILL_ADVICE`(P20 — 자동 킬스위치 SHADOW 권고, raw 입력[연속손실·marketDropPct·apiErrorCount] 보존) |
| createdAt | DateTime | 생성 시각 (인덱스) |

**인덱스**: `track` · `tradeDate` · `action` · `createdAt`. (마이그레이션 `20260704090000_dar496_risk_decision_log` — create-only)

> **DAR-502 [견고화 W2·P20] 재사용(스키마 무변경)**: 자동 킬스위치 SHADOW 계측이 이 모델을 재사용한다 — `meta.kind='AUTO_KILL_ADVICE'`, **track+tradeDate 1행 멱등**(장중 매 10분 재호출해도 당일 1행·에스컬레이션만 갱신). money 컬럼(totalCapital 등)은 자동킬 컨텍스트에 부적합 → 0 고정, `meta` 가 권위(산출한 raw 입력 전량 보존 — P23 사후 임계 결정용). ★`activate()` 미호출(발동 0). 새 마이그레이션 없음.

---

## 41. Engine5 — AccountHighWaterMark (account_high_water_marks) — DAR-497 [견고화 W2·P19]

**목적**: 드로다운 컷(룰북 §7.5) 발동 근거가 되는 계좌 고점(High-Water Mark) 영속 추적. 갭 A2(감사의 유일한 absent-high) — 고점 추적·드로다운 임계 트리거가 전무해 룰북 8-6(-15~20% 컷·자동 재개 금지)이 발화 불가능했다. 기간 리셋(일간/주간 캡)은 자동 재개라 요건 상충 → **리셋 없는 영속 고점**이 필요. 일일 사이클 총자산 산출 직후 `max(고점, 현재)` forward-only 갱신하고, 고점 대비 −15%(G6 정합·frozen) 도달 시 측정 트랙은 SHADOW 기록, 코어 forward 는 킬스위치 REDUCE_ONLY 를 발동한다. 기존 PortfolioRiskSnapshot(일별 시계열·재생성 가능)은 forward-only max 고점의 SSOT 로 부적합 + 측정 트랙 집계 오염 방지 → **FK 없는 전용 additive 모델**(택1 근거·RiskDecisionLog·DualMomentumForwardTrade 전례). ★가산·관측층 전용 — 기존 측정 트랙 무접촉(M10 클록 안전). AI 미개입(판정=순수 게이트).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | String PK | cuid |
| portfolioId | String | 트랙 하위 포트폴리오 단위 고점(철학/전략 forward 는 4종 각각). **유니크**(자연키) |
| track | String | RiskGuardTrack — 모드 해석·감사 (인덱스) |
| highWaterMark | Decimal(16,2) | 계좌 고점(총자산, forward-only max) |
| peakDate | String | 고점 도달 거래일 YYYYMMDD |
| lastEquity | Decimal(16,2) | 최근 관측 총자산 |
| lastDate | String | 최근 관측 거래일 YYYYMMDD |
| createdAt / updatedAt | DateTime | 생성·갱신 시각 |

**인덱스**: `portfolioId`(유니크) · `track`. (마이그레이션 `20260704120000_dar497_account_high_water_mark` — create-only). **초기값 = 최초 관측 시점 총자산**(과거 소급 산정 금지 — 룩어헤드·리셋 정합).

---

**작성일**: 2026-03-07
**최종 수정일**: 2026-07-17 (DAR-514 Wave A/cross·P0: 알림 설정 센터 v2 — notification_settings 에 editionPushEnabled·digestPushEnabled(신규 2계열 예약·기본 OFF)·dailyPushCap(일일 푸시 상한·기본 30) 가산 + PushDeliveryLog 신규 테이블·PushDeliveryStatus enum(SENT|SUPPRESSED_CAP — 캡 계산 SSOT·억제 로그, FK 없음). 마이그레이션 20260717010000_dar514_notification_settings_v2, 전부 additive·기존 설정 무손실·알림층 전용·트레이딩 경로 무접촉(M10 무오염). 캡 면제 계열: RISK_ALERT/OPS_ALERT) · 2026-07-15 (갭분석 W0 토대: User.tier(UserTier FREE|PRO 엔티틀먼트 소켓)·ProWaitlistEntry(Pro 사전신청 서버 영속화)·§7.4.2 InvestorFlowDaily·§7.4.3 ShortSellingDaily(수급/공매도 EOD, publishedDate as-of)·SearchMissLog(W8 검색 제로결과 계측)·FunnelEvent(W15 온보딩 퍼널 계측)·notification_settings.priceMovePushEnabled(기본 OFF)·NotificationType 에 PRICE_MOVE 가산·EventType 에 EARNINGS_GUIDANCE 가산 — 마이그레이션 20260715230700_gap_analysis_foundation, 전부 additive·트레이딩 경로 무접촉) · 2026-07-04 (DAR-502 P20: §40 RiskDecisionLog 재사용 — 자동 킬스위치 SHADOW 계측이 `meta.kind='AUTO_KILL_ADVICE'` 로 기록[track+tradeDate 1행 멱등·raw 입력 보존·activate() 미호출], **스키마·마이그레이션 무변경**) · 2026-07-04 (DAR-497 P19: §41 AccountHighWaterMark 신규 — 계좌 고점 forward-only 추적(FK 없음·포트폴리오 단위) + 드로다운 컷 −15% REDUCE_ONLY 발동 근거, 마이그레이션 20260704120000_dar497_account_high_water_mark, 관측·발동층 전용) · 2026-07-04 (DAR-496 P18: §40 RiskDecisionLog 신규 — RiskGuard 공용 진입 게이트(일일손실·현금) 판정 이력(FK 없음·측정 트랙 SHADOW·코어 forward ENFORCE), 마이그레이션 20260704090000_dar496_risk_decision_log, 관측층 전용) · 2026-07-04 (DAR-494 P13: §39 DualMomentumForwardTrade 신규 — 듀얼모멘텀 코어 forward 트랙 ETF 월말 리밸런싱 이력(FK 없음·PENDING→OPEN→CLOSED), 마이그레이션 20260703160000_dar494_dual_momentum_forward_trade, 모의·데이터층 전용) · 2026-07-03 (DAR-486 P25: §7.4.1 StockStatusDaily 신규 — 종목상태 일별 이력(forward-only, 백테스트 생존편향) + ExitReason 에 DELISTED 가산) · 2026-07-03 (DAR-479 P04: §38 BacktestForwardDivergenceSnapshot 추가 — 백테스트 vs forward 괴리 일일 스냅샷, read-only 측정) · 2026-07-03 (DAR-473 P01: NotificationType 에 RISK_ALERT/OPS_ALERT 가산 + notification_settings.opsPushEnabled 추가 — 리스크·운영 알림 채널 신설)
**이전 수정일**: 2026-07-02 (전수 현행화 — 미문서 모델 15종 전용 섹션 추가(§23~§37: CompanyOverview·SavedDisclosure·CronRunLog·DisclosureCollectionLog·DisclosureEvent·DartFiledFact·CompanyFinancial·FinancialCollectionLog·DisclosureAnalysis·PersonaAnalysis·InvestorPhilosophy·PhilosophyMetric·PhilosophySource·SignalEntryFunnelDaily·IntradayScalpTrade), User 카카오 OAuth(password nullable·provider/providerId·(provider,providerId) unique) 반영, NotificationHistory 통합 인박스(type/refId 멱등키) 반영, §17 절 번호 충돌 정리, SSOT 관계(schema.prisma=SSOT·본 문서=해설·총 50개 모델) 헤더 명시)
**버전**: 3.3 (2026-07-17 DAR-514 Wave A/cross·P0: notification_settings 에 editionPushEnabled·digestPushEnabled(예약·기본 OFF)·dailyPushCap(기본 30) 3컬럼 가산 + PushDeliveryLog 신규 테이블·PushDeliveryStatus enum(마이그레이션 20260717010000_dar514_notification_settings_v2) — 계열별 on/off·보수적 기본값·일일 캡·억제 로그, 전부 additive·기존 설정 무손실·알림층 전용; 3.2 2026-07-03 DAR-486 P25: StockStatusDaily 신규 테이블 + ExitReason.DELISTED 가산(마이그레이션 20260703150000_dar486_stock_status_daily_survivorship) — 종목상태 일별 이력 forward-only 축적 + 상폐 감액 청산 옵션, 백테스트 생존편향 처리(측정·데이터층 전용·운용 매매 무접촉); 3.1 DAR-479 P04: BacktestForwardDivergenceSnapshot 신규 테이블(마이그레이션 20260703130000_dar479_backtest_forward_divergence_snapshot) — 백테스트 vs forward 괴리 일일 스냅샷, 조회·적재 전용 측정; 3.0 DAR-473 P01: NotificationType 에 RISK_ALERT/OPS_ALERT 가산(additive 마이그레이션 20260703010000_dar473_risk_ops_notifications) + notification_settings.opsPushEnabled(기본 ON) 추가 — 능동 리스크/운영 알림 채널 신설(카테고리 4 버킷: 공시·신호·체결·운영); 2.9 2026-07-02 전수 현행화; 2.8 DAR-424: NotificationType 에 TRADE_ENTRY/TRADE_EXIT 가산 + notification_settings.tradePushEnabled 추가 — 라이브 페이퍼 체결 알림; 2.7 DAR-404: BacktestRun.strategyKey 비파괴 추가 + @@index — 트레이딩 로직 축 다중 트랙; DAR-401: 원본 HTML S3 고정 + rawHtmlS3Key 포인터 컬럼·로컬 디스크 제거; DAR-399 tables 오프로드; DAR-395 rawText 오프로드; DAR-87 InsiderHoldingChange + DAR-377 StockMinutePrice 반영 유지)
