# 시스템 아키텍처

## 1. 전체 아키텍처 개요

```
┌─────────────────┐
│   Mobile App    │  React Native (Expo) + React Native Paper
│  (React Native) │  - 사용자 UI
└────────┬────────┘  - 푸시 알림 수신 · Deep Link 처리
         │ HTTPS/REST API
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│              NestJS Backend (모놀리스·5엔진 DDD)                      │
├──────────────────────────────────────────────────────────────────────┤
│  5개 Bounded Context 엔진 (backend/src/engine1-* ~ engine5-*)        │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │engine1-disclosure    engine2-ai-analyst   engine3-quant-market│   │
│  │공시 수집·파싱·이벤트  AI 분석·비용게이트   시세·지표·신호     │   │
│  │(M0~M2 ✅)            (L0~L3, M3 🚧)       (M4~M6, M9 ⬜)    │   │
│  └──────────────────────────┬────────────────────────────────────┘   │
│               BullMQ 큐 파이프라인                                    │
│      (disclosure-parse → event-extract → ai-analyze                  │
│       → signal-generate → portfolio-check → exit-evaluate → ...)     │
│  ┌───────────────────────────▼────────────────────────────────────┐  │
│  │ engine4-portfolio-exit           engine5-trading-risk          │  │
│  │ 포트폴리오·포지션·Exit Score     모의투자·Risk 하드룰           │  │
│  │ (M7~M8 ⬜)                       (M11~M12 ⬜)                  │  │
│  │ 헥사고날 포트/어댑터:             헥사고날 포트/어댑터:          │  │
│  │ IPositionThesisRepository         IPaperTradeRepository         │  │
│  │  └─ InMemory / Prisma 어댑터       └─ InMemory / Prisma 어댑터 │  │
│  │ IExitSignalRepository             IAuditLogRepository           │  │
│  │  └─ InMemory / Prisma 어댑터       └─ InMemory / Prisma 어댑터 │  │
│  │                           ⚠ AI 금지영역: Engine5 Risk 독립     │  │
│  │                             (AI 서비스 의존성 0)                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ── 횡단 모듈 (독립 유지) ───────────────────────────────────────    │
│  auth · users · companies · watchlist · notifications                │
│  notification-settings · expo-push · devices · saved-disclosures     │
│  prisma · common                                                     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
                       ┌─────────────────────┐
                       │   PostgreSQL DB      │
                       │  (with Prisma ORM)   │
                       └─────────────────────┘

External APIs:
- DART Open API (공시 수집)
- Expo Push Notification Service (푸시 발송)
- KRX 데이터마켓플레이스 (시세, Phase 5+ 예정)
- 증권사 OpenAPI (실거래, Phase 13+ 예정)
- LLM API: OpenAI/Claude (Engine2 AI 분석, Phase 3+ 예정)
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
- React Native Paper + StyleSheet (UI, NativeWind 미사용)
- Expo Notifications (푸시 알림)

### 2.2 Backend API (NestJS)

**아키텍처 패턴**: DDD Bounded Context (5개 엔진) + 헥사고날 포트/어댑터

백엔드는 기능 모듈의 평면 나열 대신 **5개 독립 엔진(Bounded Context)**으로 조직된다.
엔진 간 통신은 서비스 직접 호출 대신 **BullMQ 큐**를 통해 비동기로 연결된다.

#### Engine 1 — Disclosure Intelligence (`engine1-disclosure/`)
- **책임**: 공시 수집 → HTML/XML 파싱 → 이벤트·수치 추출 (M0~M2, ✅ 완료)
- **하위 모듈**: collection(DART 폴링·재시도), dart-api, disclosures(HTTP 조회), disclosure-documents(파싱), disclosure-events(이벤트 추출·분류)
- **BullMQ 발행**: `disclosure-parse`, `event-extract`
- **주요 엔드포인트**: `GET /disclosures`, `GET /disclosures/:rcpNo`, `POST /scheduler/collect`

#### Engine 2 — AI Analyst (`engine2-ai-analyst/`)
- **책임**: 공시 요약·Persona 해석·Position Thesis AI 초안 생성 (M3, 🚧 스캐폴딩)
- **비용 게이트**: L0(AI 금지) ~ L3(Position Thesis) 4단계 분류. 일/월 한도 초과 시 L0 강등.
- **구성**: tasks/(summary·persona·thesis), cost-gate, cost-metrics, cost-aggregation, usage-log, llm, adapters, ports
- **BullMQ 소비**: `ai-analyze` / **발행**: `signal-generate`

#### Engine 3 — Quant Market (`engine3-quant-market/`)
- **책임**: 시세 수집·기술지표 계산·Event Study·Buy Score 생성 (M4~M6, M9, ⬜ 예정)
- **AI 정책**: Buy Score 계산은 **순수 Rule 기반** (AI 개입 금지)
- **구성**: market-data, indicators, buy-signal, event-study, signals(HTTP), backtest
- **BullMQ 소비**: `signal-generate` / **발행**: `portfolio-check`
- **주요 엔드포인트**: `GET /signals`, `GET /signals/:id`

#### Engine 4 — Portfolio & Exit (`engine4-portfolio-exit/`)
- **책임**: 포트폴리오·포지션 관리·Exit Score 계산 (M7~M8, ⬜ 예정)
- **헥사고날 포트/어댑터**:
  - `IPositionThesisRepository` ↔ InMemory 어댑터 / Prisma 어댑터 (DAR-35)
  - `IExitSignalRepository` ↔ InMemory 어댑터 / Prisma 어댑터 (DAR-35)
- **구성**: domain/(FSM 타입·조건 타입), repositories/, services/, portfolio(HTTP)
- **BullMQ 소비**: `portfolio-check` / **발행**: `exit-evaluate`
- **주요 엔드포인트**: `GET /portfolio`, `GET /positions/:id`, `GET /positions/:id/thesis`

#### Engine 5 — Trading & Risk (`engine5-trading-risk/`)
- **책임**: 모의투자 체결 시뮬레이션·Risk 하드룰 검증 (M10~M12, ⬜ 예정)
- **AI 금지영역**: Risk 판정·주문 승인·손절 하드룰에 AI 개입 절대 불가. `RiskCheckService`는 AI 서비스 의존성 0.
- **헥사고날 포트/어댑터**:
  - `IPaperTradeRepository` ↔ InMemory 어댑터 / Prisma 어댑터 (DAR-36)
  - `IAuditLogRepository` ↔ InMemory 어댑터 / Prisma 어댑터 (DAR-36)
- **구성**: domain/(체결 시뮬·가상 포트·비용지표), repositories/, services/, paper-trading(HTTP)
- **주요 엔드포인트**: `GET /paper-trading`, `POST /paper-trading/order`

#### 횡단 모듈 (독립 유지)
- `auth` · `users` · `companies` · `watchlist` · `notifications` · `notification-settings` · `expo-push` · `devices` · `saved-disclosures` · `prisma` · `common`
- 모든 엔진이 공유하는 인증·알림·기업 마스터 등을 담당한다.
- Scheduler는 engine1-disclosure/scheduler/로 흡수·래핑됨.
- **객체 스토리지 추상화 (DAR-395)**: `common/storage` 의 `StorageModule`(@Global)이 드라이버 비의존
  `ObjectStorageService`(S3/로컬 팩토리, 자격증명 미설정 시 graceful 로컬 폴백) + `RawTextStoreService`
  (공시 원문 오프로드/lazy fetch)를 제공한다. 대용량 콜드 데이터(`DisclosureDocument.rawText`)를 로컬 DB
  밖 객체 스토리지로 내보내 멀티이어 백필 시 DB 폭증을 막는다(쓰기=파싱 완료 시점, 읽기=Engine2 AI excerpt
  lazy fetch, 기존분=`RawTextOffloadScheduler` 점진 마이그레이션). 상세: `docs/workflow.md §2.6`.
  - **tables 오프로드 (DAR-399)**: TOAST 진짜 bulk 는 rawText 가 아니라 `DisclosureDocument.tables`
    JSONB(실측 ~1.6GB)였다. 동일 추상화에 `TablesStoreService` + `TablesOffloadScheduler` 를 추가해
    파싱 표를 객체 스토리지로 오프로드(`tablesS3Key` 포인터, SHARE_BUYBACK 폴백만 lazy fetch).
    상세: `docs/workflow.md §2.7`.

### 2.3 Database (PostgreSQL + Prisma)

**주요 역할**
- 사용자, 공시, 알림 데이터 영구 저장
- 관계형 데이터 관리
- 트랜잭션 지원

**ORM: Prisma**
- 타입 안전한 DB 쿼리
- 마이그레이션 관리
- 스키마 버전 관리

**시계열 저장 엔진: TimescaleDB (DAR-378)**
- 대규모 분봉/일봉(수억 행)을 효율 저장하기 위해 PostgreSQL 위에 TimescaleDB(pg15 기반)를 사용한다.
  pg15 호환 이미지라 기존 `postgres_data` 볼륨을 그대로 쓴다(데이터 손실 0). 확장은 마이그레이션의
  `CREATE EXTENSION IF NOT EXISTS timescaledb` 로 활성화한다.
- **하이퍼테이블**: 분봉 `stock_minute_prices` 를 `ts`(파티션 키)로 7일 chunk 분할. PK 는 파티션 컬럼을
  포함한 복합키 `(stockCode, ts)`(TimescaleDB 요건).
- **압축**: 7일 경과 chunk columnar 압축(segmentby=stockCode) — 실측 ~90% 절감.
- **연속집계**: 분봉→`stock_candles_5m/15m/1d` materialized cagg + refresh policy. 차트·분석·EventStudy 가
  원본 풀스캔 없이 롤업 조회.
- **보존정책**: 원본 분봉 기본 5년 보존(설정가능). 오래된 원본은 집계 롤업으로 대체 가능.
- Prisma 모델은 '일반 정의'만 두고, 하이퍼테이블/압축/집계/보존은 raw SQL 마이그레이션이 담당(공존).
- 조회: `GET /market-data/candles`(구간 + 해상도 + 페이지네이션 + 서버측 다운샘플 — 모바일 대량 전송 방지).
- 데이터 축적 A(일봉)·B(분봉)가 이 기반 위에 적재된다(★선행).

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
- **무효 토큰 처리**:
  - 발송 ticket 단계: `DeviceNotRegistered` 즉시 감지 시 DB에서 자동 삭제
  - 발송 receipt 단계(DAR-182): 발송 ~15분 후 receipt 조회로 드러나는 `DeviceNotRegistered` 정리. **durable BullMQ delayed job(`QUEUE.EXPO_RECEIPT`)** 으로 처리해 배포·크래시·오토스케일 재시작에도 보장(기존 휘발성 `setTimeout` 대체 — 프로세스 생존 의존 제거).
  - 로그아웃 시 클라이언트가 deviceToken을 전달하여 서버에서 삭제

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
│  disclosure/:rcpNo   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  공시 상세 API 호출  │
│  GET /disclosures/:rcpNo│
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
│  - Refresh: 90일│
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
  id               String   @id @default(cuid())
  userId           String
  disclosureRcpNo  String
  sentAt           DateTime @default(now())
  isRead           Boolean  @default(false)

  user         User       @relation(...)
  disclosure   Disclosure @relation(fields: [disclosureRcpNo], references: [rcpNo])

  @@unique([userId, disclosureRcpNo])  // 복합 유니크 제약
  @@index([userId, isRead])
}
```

#### 알림 발송 로직
```typescript
async sendNotification(userId: string, disclosureRcpNo: string) {
  // 1. 이미 알림을 보낸 적이 있는지 체크
  const existing = await prisma.notificationHistory.findUnique({
    where: {
      userId_disclosureRcpNo: {
        userId,
        disclosureRcpNo,
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
      disclosureRcpNo,
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
| **UI** | React Native Paper + StyleSheet | RN Paper 컴포넌트 사용, NativeWind 미사용 |
| **푸시 알림** | Expo Push | Expo와 통합, 간단한 설정 |
| **인프라 (MVP)** | GCP (Cloud Run + Cloud SQL) | Cloud Run 무료 티어(월 200만 요청, vCPU 180,000초), Cloud SQL 소규모 인스턴스 저렴. 1인 개발 MVP 단계에서 비용 부담 최소화 |
| **인프라 (확장 시)** | AWS 이관 예정 | 사용자 증가 시 안정성·세밀한 인프라 제어가 필요해지면 AWS ECS + RDS로 이관. AWS ECS Fargate는 무료 티어가 없어 초기에는 비용 비효율적 |

---

**작성일**: 2026-04-18
**최종 수정일**: 2026-06-05
**버전**: 2.0 (5엔진 DDD 구조·헥사고날 포트/어댑터·BullMQ 큐 반영)
