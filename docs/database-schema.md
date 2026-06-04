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

  createdAt DateTime @default(now())

  // Relations
  company             Company              @relation(fields: [corpCode], references: [corpCode])
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
| createdAt | DateTime | DB 저장일시 | default: now() |

**인덱스**:
- `rcpNo` (PK, 자연키)
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
- 고유 제약: `(rcpNo, persona)` UNIQUE

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

**작성일**: 2026-03-07
**최종 수정일**: 2026-06-05
**버전**: 1.9 (M10-A DAR-16: PaperTrade 모의투자 체결 모델 추가, engine5-trading-risk 신규 도메인)
