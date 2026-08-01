# 시스템 아키텍처

## 1. 전체 아키텍처 개요

```
┌─────────────────┐
│   Mobile App    │  React Native (Expo) + React Native Paper
│  (React Native) │  - 사용자 UI · 순수 Rule/Risk Shadow 평가
└────────┬────────┘  - 푸시 · Deep Link · 제한 비상 제어
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
- 공용 순수 evaluator를 이용한 종가 후보의 온디바이스 Rule/Risk Shadow 재평가
- 운영자 권한이 있을 때 신규 진입 Kill Switch 요청과 receipt 확인

**AOS 핵심 IA**

- 판단: 종가 후 운영 브리핑 → 조건부 가격 계획 → 근거 상세
- 포지션: 보유·손익·Risk 조회
- 알림: 거래·공시·위험 알림
- 제어: 계정·환경 설정과 운영자 제한 비상 제어

전략/Rule/Weight 편집, 백테스트 상세, Shadow/Paper 원장, Worker/AI 비용은 `operator-web/`로
이관한다. Legacy 모바일 route는 데이터 삭제 없이 경량 redirect로 유지한다.

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
- **구성**: market-data, indicators, buy-signal, event-study, signal-generation(cron), signals(HTTP), backtest
- **BullMQ 소비**: `signal-generate` / **발행**: `portfolio-check`
- **신호 생성 크론**: `SignalGenerationScheduler.generateDaily` — 평일 19:00 KST(`0 19 * * 1-5`), 18:30 일봉·18:50 지표 이후·19:30 모의운용 이전(`docs/workflow.md` §5.15). 각 신호는 생성 시각(`createdAt` KST)에 귀속돼 그 거래일의 "에디션"이 된다.
- **주요 엔드포인트**: `GET /signals`, `GET /signals/:id`, `GET /signals/daily-editions`(에디션 날짜 목록), `GET /signals/daily/:date`(에디션 상세). 두 에디션 조회는 마이그레이션 0의 **읽기 파생 API**(§3.4).

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

#### AOS 제어평면 — Strategy Management (`aos/strategy-management/`)

- **현재 책임(Phase A2)**: 국내주식 Long Only 2~20거래일 전략·룰 설정 버전화, 불변 해시, 승인 이후 예약과 종가 후 활성화 원장
- **활성화 안전성**: 검증된 KRX 거래일·공휴일·지연개장 세션을 KST로 판정하고, strategy advisory lock + SERIALIZABLE transaction + DB partial unique index로 전략별 ACTIVE를 하나 이하로 유지한다.
- **현재 비배선**: `AppModule`, Cron, Queue, 기존 Signal/Paper/Order에는 연결하지 않았다. 따라서 기존 운영 매매 행동은 바뀌지 않는다.
- **디바이스 계산 경계**: 이번 서버 코드는 버전 저장·활성화 제어평면이다. A3 평가 코어는 서버 전용 DI 서비스가 아니라 모바일에서도 동일 입력+버전으로 재생 가능한 순수 TypeScript 계약으로 분리한다.
- **AI 경계**: AI 산출물은 향후 feature 입력만 제공하며 주문·수량·Hard Risk Gate를 결정하거나 우회하지 않는다.

#### AOS 제어평면 — Risk Policy (`aos/risk-policy/`)

- **현재 책임(Phase A2)**: Hard Risk 한도를 전략 설정과 독립된 `RiskPolicyVersion`으로 버전화하고, strict schema·canonical SHA-256 hash·불변 수명주기를 제공한다.
- **구조적 금지**: `KR_STOCK`·`LONG_ONLY`, 공매도/레버리지 비허용, 장기투자 자산의 트레이딩 손실 자동보전 금지를 애플리케이션과 DB 양쪽에서 강제한다.
- **값 결정 경계**: 이번 기반은 정책 값이나 기본값을 선택·seed하지 않는다. 실제 한도는 후속 ApprovalRecord/RBAC와 Backtest·Shadow 검증을 통과한 사람 승인 입력만 사용할 수 있다.
- **현재 비배선**: 기존 Engine5 상수·`RiskCheck`·Signal/Paper/Order 경로를 읽거나 교체하지 않고, API·Cron·Queue·`AppModule`에도 등록하지 않았다.
- **후속 활성화**: Risk policy 활성화는 승인 원장과 actor 권한을 마련한 뒤 Strategy activation과 같은 종가 후 단일-`ACTIVE` 원칙으로 결합한다.

#### AOS 제어평면 — Governance (`aos/governance/`)

- **현재 책임(Phase A2)**: Strategy/Rule/Risk/Activation 설정 변경과 승인 결정을 대상 hash·evidence hash·actor·correlation 기준의 append-only 원장으로 보존한다.
- **불변 안전성**: 승인·감사 row는 update/delete/truncate할 수 없고, 같은 idempotency key 재시도는 중복 기록하지 않는다.
- **Actor 보존**: 사용자 actor와 시스템 actor를 명시적으로 구분한다. 사용자 actor는 기록 시 존재를 검증한 뒤 불변 logical reference로 남겨 계정 삭제가 감사 원장을 cascade하거나 수정하지 않게 한다.
- **정책 미확정 경계**: 승인자 수, 실제 role key, 권한 매트릭스는 선택하지 않는다. 동일 actor 허용 여부도 기본값 없이 호출자가 명시한 separation policy만 판정한다.
- **현재 비배선**: 기존 Strategy/Risk 상태 전이와 activation 서비스에는 아직 연결하지 않았으며 API·UI·Cron·Queue 등록도 없다.

#### AOS 실행 코어 — Shared Rule Evaluator (`packages/aos-rule-engine/`)

- **현재 책임(Phase A7)**: Android/iOS 디바이스와 백엔드 replay가 같은 버전·Feature Snapshot으로 같은 평가 trace와 canonical receipt를 만드는 동기식 순수 TypeScript 코어다.
- **결정론 경계**: 실행 순서는 `priority → ruleKey`로 고정하고 object key·reason code를 정규화한다. 시스템 시계·난수·비동기·전역 mutable state는 사용하지 않는다.
- **Fail-safe**: Hard Risk 비활성화·입력 누락·FAIL·ABSTAIN·구현 오류는 모두 `BLOCKED`다. AI는 검증된 feature 입력만 제공할 수 있으며 Hard Risk를 우회할 수 없다.
- **플랫폼 경계**: 런타임 dependency 0이며 Node·React Native·Expo·NestJS·Prisma·DB·네트워크·저장소 import를 CI에서 차단한다.
- **현재 배선**: 모바일 종가 에디션은 point-in-time 일봉과 기존 신호 feature를 Snapshot으로 만들어 evaluator를 직접 실행하고, version/hash를 SecureStore에 경량 보존한다. 화면용 Shadow 가격 계획만 만들며 Signal/Paper/Order write에는 연결하지 않는다.
- **상세 계약**: `docs/roadmap/aos-rule-evaluator-core.md`
- **모바일 계약**: `docs/roadmap/aos-mobile-device-rule.md`

#### AOS 자산배분 계획 — Allocation (`aos/allocation/`)

- **현재 책임(Phase A8)**: SYSTEM_TRADING 계정의 닫힌 기간 확정이익을 SPGI 50%, VTI 30%, SYSTEM_TRADING 20%로 나누는 정책·계획·승인·취소·재발행 원장이다.
- **계산 불변식**: 손실/0원/유보액 초과는 plan을 만들지 않고, 원 단위 내림 뒤 잔여 원을 SYSTEM_TRADING에 귀속해 항목 합계가 distributable profit과 정확히 일치한다.
- **운영 경계**: 정책은 작성자와 다른 승인자가 검증된 KRX 거래일 종가 이후 활성화한다. plan도 작성자와 승인자를 분리하고 ACTIVE policy hash를 고정한다.
- **실행 부재**: 송금·환전·매수·브로커 adapter가 없으며 `AosCapitalBucket`의 자금을 변경하거나 장기계좌에서 손실을 보전하지 않는다.
- **표면**: Operator Web은 전체 수명주기를 통제하고 모바일 포지션 화면은 승인된 최근 plan만 조회한다.
- **상세 계약**: `docs/roadmap/aos-allocation-planning.md`

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
  - **원본 HTML 저장 S3 고정 (DAR-401)**: 공시 원본 HTML 저장 장소를 S3/객체 스토리지로 **고정**하고
    레거시 로컬 디스크(`storage/{rcpNo}/index.html`·23GB 누적·쓰기전용) 저장/조회를 제거한다. 동일
    추상화에 `RawHtmlStoreService`(키 `disclosure-rawhtml/{rcpNo}.html.gz`, gzip) 를 추가해 fetch 시점에
    저장하고 `rawHtmlS3Key` 포인터만 DB 에 보유(`rawFilePath` 신규 기록 중단). `LocalStorageService` 는
    `@deprecated`(provider 해제). 저장 실패는 graceful(파이프라인 무중단).

- **저장소 계층화·디스크 회수·모니터링 (DAR-397)**: 개별 오프로드(rawText DAR-395, tables DAR-399,
  원본 HTML DAR-401)가 *무엇*을 S3 로 내보낼지를 정했다면, `storage-ops` 모듈(`StorageOpsModule`)은
  그 계층화(hot=로컬, cold=S3) 상태를 *운영·관측·회수*한다(개별 오프로드와 기능 중복 없음).
  `StorageHealthService`(`GET /storage/health`)는 DB 총/테이블별 용량(`pg_total_relation_size`),
  rawText 오프로드 진행, 객체 스토리지 용량(`ObjectStorageService.stats`), 로컬 임계 경고를 단일
  스냅샷으로 제공한다. `StorageMaintenanceService` 는 디스크 실회수(`POST /storage/vacuum` =
  `VACUUM FULL` 전후 리포트·화이트리스트 테이블), 잔존 레거시 로컬 원시 파일(`rawFilePath`) 회수
  (`POST /storage/cleanup-local-artifacts` — DAR-401 이후 신규 write 는 0이므로 과거분만 정리),
  콜드 라이프사이클 적용(`POST /storage/lifecycle` = `disclosure-rawtext/` 의
  STANDARD_IA@30d→GLACIER@90d, S3만 실적용)을 담당한다. 운영 절차:
  `docs/deployment.md §저장소 계층화·로컬 최소화 운영`.

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

### 3.4 일일 투자판단 에디션 조회 흐름 (읽기 파생 · 마이그레이션 0)

거래일 1일 = 신문 1"호". 각 `TradingSignal`은 자기 생성일(`createdAt` KST)에 귀속돼 그 날의 에디션이 된다. **신규 테이블·컬럼·마이그레이션 없이** 기존 `TradingSignal`/`Disclosure`를 KST 거래일로 재그룹핑하는 읽기 전용 파생 API다.

```
[모바일 신호탭·홈]                         [Engine3 signals(HTTP)]
 useDailyEditions() ──GET /signals/daily-editions──▶ findDailyEditions(before, limit)
 useEdition(date)   ──GET /signals/daily/:date─────▶ findDailyEdition(date)
        │                                                   │
        │                                                   ▼
        │                        ┌────────────────────────────────────────────┐
        │                        │ 날짜 목록: $queryRaw                        │
        │                        │  (created_at AT TIME ZONE 'UTC'             │
        │                        │      AT TIME ZONE 'Asia/Seoul')::date       │
        │                        │  GROUP BY KST 거래일 · to_char YYYYMMDD 커서 │
        │                        │  판단 존재일만(빈 날 미포함)                │
        │                        ├────────────────────────────────────────────┤
        │                        │ 상세: findByCreatedRange(gteUtc, ltUtc)     │
        │                        │  KST 폐구간 [자정, +1일) · findAll 매퍼 재사용│
        │                        │  disclosure.rcpDt 조인(접수일 병기)         │
        │                        │  meta.emptyReason ← 시장캘린더(휴장/미발행) │
        │                        └────────────────────────────────────────────┘
        ▼
 날짜 스트립(건수 dot) + 그 날 매수등급 랭킹 렌더
```

- **읽기 파생·비침습**: 파이프라인·스키마 무변경(마이그레이션 0). `TradingSignal.createdAt` 기존 인덱스 + `Disclosure.rcpDt` 조인만 사용해 M10 모의운용 측정 클록을 오염시키지 않는다.
- **KST 이중 환산**: `created_at`은 UTC 저장 naive timestamp라 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` 이중 변환으로 KST 자정 경계를 맞춘다(단일 환산 금지).
- **정직 규약**: 빈 날짜는 404가 아니라 `data:[]`+`emptyReason`(CLOSED/PENDING/QUIET/COLD_START/FUTURE)으로 응답하고 다른 날 신호로 채우지 않는다. `rcpDt`(공시 접수일)·`expiresAt`(만료) 병기로 신선도를 정직화한다.
- **캐시 이관**: 홈이 에디션 훅으로 전환되며 종목 배지는 공유 피드키 대신 `GET /signals/by-corp/:corpCode`로 조회한다(DAR-507). API 계약은 `docs/api-specification.md` §12.4·§12.5.

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

| 의사결정 항목         | 선택                            | 이유                                                                                                                                  |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **백엔드 프레임워크** | NestJS                          | TypeScript 지원, 모듈화, DI, 생산성                                                                                                   |
| **ORM**               | Prisma                          | 타입 안전, 마이그레이션, 개발자 경험                                                                                                  |
| **DB**                | PostgreSQL                      | 관계형 데이터, 트랜잭션, 안정성                                                                                                       |
| **Scheduler**         | @nestjs/schedule                | NestJS 네이티브 통합, cron 지원                                                                                                       |
| **모바일 프레임워크** | React Native (Expo)             | 빠른 개발, 푸시 알림 간편, Deep Link 지원                                                                                             |
| **상태 관리**         | React Query + Zustand           | 서버/클라이언트 상태 분리, 캐싱, 간결함                                                                                               |
| **UI**                | React Native Paper + StyleSheet | RN Paper 컴포넌트 사용, NativeWind 미사용                                                                                             |
| **푸시 알림**         | Expo Push                       | Expo와 통합, 간단한 설정                                                                                                              |
| **인프라 (MVP)**      | GCP (Cloud Run + Cloud SQL)     | Cloud Run 무료 티어(월 200만 요청, vCPU 180,000초), Cloud SQL 소규모 인스턴스 저렴. 1인 개발 MVP 단계에서 비용 부담 최소화            |
| **인프라 (확장 시)**  | AWS 이관 예정                   | 사용자 증가 시 안정성·세밀한 인프라 제어가 필요해지면 AWS ECS + RDS로 이관. AWS ECS Fargate는 무료 티어가 없어 초기에는 비용 비효율적 |

---

**작성일**: 2026-04-18
**최종 수정일**: 2026-08-01 (AOS Phase A8 확정이익 배분 계획 반영)
**버전**: 2.6 (AOS Allocation Planning 추가) / 이전: 2.5 (AOS Shared Rule Evaluator 실행 코어 추가)

## 11. AOS 운영 제어면

`operator-web`은 모바일과 물리적으로 분리된 정적 React 앱이며, NestJS의
`/api/aos/operator`만 사용한다. 조회와 변경은 같은 화면에 있더라도 서버에서 서로 다른
가드 경로를 지난다.

```text
Operator Web
  ├─ GET ─ JWT ─ Operator membership/RBAC ─ Query Service ─ AOS ledgers
  └─ CMD ─ JWT ─ RBAC ─ mutation flag ─ single-use Step-up ─ Command Service
                                                       ├─ domain invariant
                                                       └─ append-only receipt
```

기본 상태는 read-only다. 변경은 `AOS_OPERATOR_MUTATIONS_ENABLED=true`일 때만 가능하고,
역할 권한과 명령 범위가 일치하는 5분 Step-up 토큰을 한 번 소비한다. 전략 작성자와 승인자는
분리하며, 승인 후에도 활성화는 KRX 종가 후 예약 절차를 거친다. 비상 통제는 발동을 즉시
기록하지만 해제 요청은 자동 해제로 연결하지 않는다. 이 제어면은 LIVE broker adapter와
연결되지 않으며 Shadow/Paper 원장만 관측·통제한다.
