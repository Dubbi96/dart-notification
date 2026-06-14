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
  isEnabled       Boolean  @default(true)
  updatedAt       DateTime @updatedAt

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notification_settings")
}

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
  @@map("disclosures")
}

// ====================================
// 알림 히스토리
// ====================================

model NotificationHistory {
  id               String    @id @default(cuid())
  userId           String
  disclosureRcpNo  String    // DART 접수번호 (FK → Disclosure.rcpNo)
  sentAt           DateTime  @default(now())
  isRead           Boolean   @default(false)
  readAt           DateTime?

  // Relations
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  disclosure Disclosure @relation(fields: [disclosureRcpNo], references: [rcpNo], onDelete: Cascade)

  @@unique([userId, disclosureRcpNo]) // 중복 알림 방지
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

**목적**: 알림 발송 이력 및 중복 방지

| 컬럼명 | 타입 | 설명 | 제약 조건 |
|--------|------|------|----------|
| id | String | 알림 고유 ID | PK, cuid() |
| userId | String | 사용자 ID | FK -> users.id |
| disclosureRcpNo | String | DART 접수번호 | FK -> disclosures.rcpNo |
| sentAt | DateTime | 발송일시 | default: now() |
| isRead | Boolean | 읽음 여부 | default: false |
| readAt | DateTime | 읽은 일시 | NULLABLE |

**인덱스**:
- `(userId, isRead)` (읽지 않은 알림 조회)
- `(userId, sentAt)` (알림 목록 조회, 최신순 정렬)
- Composite Unique: `(userId, disclosureRcpNo)` (중복 알림 방지)

**중복 알림 방지 메커니즘**:
- `(userId, disclosureRcpNo)` 조합이 유니크
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

### 7.1b SimulatedDailyPrice (simulated_daily_prices) — DAR-124 ★모의 전용·실시세 아님

모의운용 전용 **결정적 합성 일봉**. 환경 시계가 미래(2026)라 실 KRX 일봉이 없어
모의운용이 가격변동을 평가하지 못하는 문제를 해소한다. 자연키: `(stockCode, tradeDate)`.

★신뢰 원칙(불가침): 이 테이블은 '모의/시뮬레이션' 전용이다. 절대 실시세로 표시하지 않으며
실데이터(`stock_daily_prices`)와 **혼합하지 않는다**(물리 분리·Company FK 없음). 오직
`PaperSimulation`(`SimulationPriceSourceService`)만 읽고, 기업 현재가/지표/신호 등 실가격
표시 경로는 이 테이블을 절대 참조하지 않는다. 활성: `PAPER_SIM_SYNTHETIC_FEED=1`.

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

시장 지수 (KOSPI=0001, KOSDAQ=1001, 업종지수). 자연키: `(indexCode, tradeDate)`.

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
| avgArD1 / D3 / D5 / D20 | FLOAT | D+N 평균 초과수익 AR (%) |
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
| C4 HistoricalEventScore | 0.10 | EventStudyResult avgArD5 기반 |
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
| currentPrice / currentValue / unrealizedPnl / unrealizedPnlPct | 현재 평가 | |
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
| exitReason | ExitReason? | TAKE_PROFIT / STOP_LOSS / TRAILING_STOP / THESIS_BREAK / MAX_HOLD_DAYS / CHART_BREAK / LIQUIDITY_EXIT / FORCE_EXIT |
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
| `executionId` | String? | FK → OrderExecution |
| `createdAt` | DateTime | 생성 시각 |

**인덱스**: `idempotencyKey`(unique), `corpCode`, `stockCode`, `status`, `createdAt`

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

### 16.1 AIUsageLog 모델 (기존 M3 모델, 집계 기반)

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
| `createdAt` | DateTime | 기록 시각 |

**인덱스**: `rcpNo`, `task`, `level`, `createdAt`

### 16.2 비용 집계 서비스 (AiCostAggregationService)

`AIUsageLog`를 기간별로 집계. 읽기 전용 — DB 직접 쿼리, AI 비호출.

| 지표 | 계산식 |
|---|---|
| `totalCostUsd` | SUM(costUsd) |
| `callCount` | COUNT(*) |
| `l0Ratio` | COUNT(level=L0) / COUNT(*) |
| `costPerDisclosure` | totalCostUsd / DISTINCT(rcpNo) |
| `costPerSignal` | totalAiCostKrw / TradingSignal.count |
| `costPerTrade` | totalAiCostKrw / PaperTrade.count |

### 16.3 비용 한도 가드 (AiCostLimitGuardService — 순수 Rule)

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `DAILY_LIMIT_USD` | 1.0 | 일 누적 한도 초과 시 L0 강등 |
| `MONTHLY_LIMIT_USD` | 20.0 | 월 누적 한도 초과 시 L0 강등 |

- 한도 초과: `forcedLevel = L0` (AI 호출 차단)
- 한도 미달: `forcedLevel = null` (원래 게이트 레벨 유지)

### 16.4 L0 비율 모니터

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

---

**작성일**: 2026-03-07
**최종 수정일**: 2026-06-07
**버전**: 2.3 (DAR-87: Engine1 InsiderHoldingChange + EventType 지분변동 3종 추가)
