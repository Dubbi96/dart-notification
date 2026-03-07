# 데이터베이스 스키마 설계

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
       │                │ id                   │
       │                │ userId               │
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
                   │    │ disclosureId         │
                   │    │ sentAt               │
                   │    │ isRead               │
                   │    │ readAt               │
                   │    └──────────────────────┘
                   │
┌──────────────┐   │
│ Disclosures  │───┘
├──────────────┤
│ id           │
│ rcpNo        │ (고유번호)
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
│ id           │
│ corpCode     │ (종목코드)
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
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // bcrypt 해싱
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  devices              UserDevice[]
  watchLists           WatchList[]
  notificationSettings NotificationSettings?
  notificationHistory  NotificationHistory[]

  @@index([email])
  @@map("users")
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

// ====================================
// 기업 마스터
// ====================================

model Company {
  id        String   @id @default(cuid())
  corpCode  String   @unique // DART 고유번호 (8자리)
  corpName  String   // 기업명
  stockCode String?  // 종목코드 (6자리, 비상장은 null)
  market    String?  // "KOSPI" | "KOSDAQ" | null

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([corpName]) // 자동완성 검색용
  @@index([stockCode])
  @@map("companies")
}

// ====================================
// 관심 목록
// ====================================

model WatchList {
  id        String   @id @default(cuid())
  userId    String
  corpCode  String   // DART 고유번호
  corpName  String   // 기업명 (중복 저장, 조회 성능)
  createdAt DateTime @default(now())

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
  id              String   @id @default(cuid())
  userId          String   @unique
  disclosureTypes String[] // ["정기공시", "주요사항보고", "발행공시", "지분공시", "기타공시"]
  keywords        String[] // 키워드 배열 (예: ["증자", "배당"])
  isEnabled       Boolean  @default(true)
  updatedAt       DateTime @updatedAt

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("notification_settings")
}

// ====================================
// 공시 데이터
// ====================================

model Disclosure {
  id             String   @id @default(cuid())
  rcpNo          String   @unique // DART 접수번호 (고유키)
  corpCode       String   // 기업 고유번호
  corpName       String   // 기업명
  reportName     String   // 보고서명
  rcpDt          String   // 접수일시 (YYYYMMDD 또는 YYYYMMDDHHmmss)
  flrName        String   // 공시제출인명
  rmk            String   // 비고
  disclosureType String   // 공시 유형 (정기공시, 주요사항보고 등)

  createdAt DateTime @default(now())

  // Relations
  notificationHistory NotificationHistory[]

  @@index([corpCode])
  @@index([rcpDt])
  @@index([disclosureType])
  @@index([createdAt]) // 최근 공시 조회용
  @@map("disclosures")
}

// ====================================
// 알림 히스토리
// ====================================

model NotificationHistory {
  id           String   @id @default(cuid())
  userId       String
  disclosureId String
  sentAt       DateTime @default(now())
  isRead       Boolean  @default(false)
  readAt       DateTime?

  // Relations
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  disclosure Disclosure @relation(fields: [disclosureId], references: [id], onDelete: Cascade)

  @@unique([userId, disclosureId]) // 중복 알림 방지
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
| password | String | bcrypt 해싱된 비밀번호 | NOT NULL |
| name | String | 사용자 이름 | NULLABLE |
| createdAt | DateTime | 가입일시 | default: now() |
| updatedAt | DateTime | 수정일시 | auto update |

**인덱스**:
- `email` (로그인 조회 성능)

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

### 3.3 Company

**목적**: 기업 마스터 데이터 (자동완성 검색용)

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 기업 고유 ID | PK, cuid() |
| corpCode | String | DART 고유번호 (8자리) | UNIQUE, NOT NULL |
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
| id | String | 설정 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id, UNIQUE |
| disclosureTypes | String[] | 공시 유형 배열 | default: [] |
| keywords | String[] | 키워드 배열 | default: [] |
| isEnabled | Boolean | 알림 전체 on/off | default: true |
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
| id | String | 공시 고유 ID | PK, cuid() |
| rcpNo | String | DART 접수번호 | UNIQUE, NOT NULL |
| corpCode | String | 기업 고유번호 | NOT NULL |
| corpName | String | 기업명 | NOT NULL |
| reportName | String | 보고서명 | NOT NULL |
| rcpDt | String | 접수일시 | NOT NULL |
| flrName | String | 공시제출인명 | NOT NULL |
| rmk | String | 비고 | default: "" |
| disclosureType | String | 공시 유형 | NOT NULL |
| createdAt | DateTime | DB 저장일시 | default: now() |

**인덱스**:
- `rcpNo` (중복 체크, 조회 성능)
- `corpCode` (기업별 공시 조회)
- `rcpDt` (날짜별 공시 조회)
- `disclosureType` (유형별 공시 조회)
- `createdAt` (최근 공시 목록 조회)

**DART 원문 URL 생성 규칙**:
```
https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcpNo}
```

### 3.7 NotificationHistory

**목적**: 알림 발송 이력 및 중복 방지

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 알림 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id |
| disclosureId | String | 공시 ID | FK -> disclosures.id |
| sentAt | DateTime | 발송일시 | default: now() |
| isRead | Boolean | 읽음 여부 | default: false |
| readAt | DateTime | 읽은 일시 | NULLABLE |

**인덱스**:
- `(userId, isRead)` (읽지 않은 알림 조회)
- `(userId, sentAt)` (알림 목록 조회, 최신순 정렬)
- Composite Unique: `(userId, disclosureId)` (중복 알림 방지)

**중복 알림 방지 메커니즘**:
- `(userId, disclosureId)` 조합이 유니크
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
pnpm prisma migrate dev --name init
```

### 5.2 프로덕션 환경
```bash
pnpm prisma migrate deploy
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

## 7. 백업 및 복구 전략

### 7.1 정기 백업
- PostgreSQL `pg_dump` 사용
- 매일 자정 자동 백업 (크론)
- 백업 파일은 S3 또는 GCS에 저장

### 7.2 복구
```bash
pg_restore -d dart_notification backup.sql
```

## 8. 데이터 정리 정책 (향후)

### 8.1 오래된 공시 삭제
- 2년 이상 된 공시는 Archive 테이블로 이동 또는 삭제
- NotificationHistory와의 FK 관계 고려

### 8.2 읽은 알림 삭제
- 90일 이상 지난 읽은 알림은 삭제

---

**작성일**: 2026-03-07
**버전**: 1.0 (MVP)
