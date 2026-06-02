> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 13 — 반자동매매 (Semi-Auto Trading)

---

## 1. 목적 & 범위

### 목적

모의투자(Phase 12)를 통과한 전략에 한해, 사용자가 주문을 **직접 승인**하는 조건 하에 실제 증권사 API(KIS OpenAPI)로 주문을 집행한다.
AI는 분석·추천까지만 관여하며, **최종 주문 승인 권한은 오직 사용자와 Risk Engine**에게 있다.

### 포함

- `OrderRequest` / `OrderExecution` / `TradingAuditLog` 데이터 모델
- 공시→분석→Signal→Risk 사전체크→주문안 제시→사용자 승인→KIS API 주문→체결 저장→포트폴리오 반영 전체 흐름
- KIS OpenAPI 인증(OAuth2), 주문, 체결 조회 연동
- 멱등 주문키(`idempotencyKey`) 설계
- 매수·매도 승인 카드 UI (Expo 모바일)
- 전 주문 Audit 로그

### 제외

- 자동 주문 승인 (Phase 14에서만 검토)
- 모의계좌 이외 고객 자산 대리 운용
- 레버리지·공매도·선물·옵션
- 동시 다수 계좌 운용

---

## 2. 현재 코드베이스 연결점

| 계층 | 현재 존재하는 자원 | Phase 13 활용 |
|------|-------------------|---------------|
| DB | `User`, `Company`(corpCode PK), `Disclosure`(rcpNo PK), `WatchList` | OrderRequest.userId → User.id, corpCode FK |
| 백엔드 모듈 | `DisclosureModule`, `SchedulerModule` | Signal 이벤트 수신 기반 |
| Phase 6 산출물 | `TradingSignal` (Buy Score, 진입 조건) | OrderRequest 생성 트리거 |
| Phase 7 산출물 | `PositionThesis` | 매수 근거 참조 |
| Phase 8 산출물 | `ExitSignal` (Exit Score, 매도 이유) | 매도 OrderRequest 생성 트리거 |
| Phase 12 산출물 | `PaperTrade` (체결 시뮬레이션 이력) | 전략 통과 여부 판단 기준 |

---

## 3. 선행 조건 & 의존성

| # | 조건 | 이유 |
|---|------|------|
| 1 | Phase 6 완료 — `TradingSignal` 존재 | 매수 주문안 생성의 입력 |
| 2 | Phase 7 완료 — `PositionThesis` 존재 | 매수 근거·무효화 조건 참조 |
| 3 | Phase 8 완료 — `ExitSignal` 존재 | 매도 주문안 생성의 입력 |
| 4 | Phase 10 완료 — 백테스트 통과 전략만 허용 | 무검증 전략의 실매매 금지 |
| 5 | Phase 12 완료 — 모의투자 2주 이상 운영, 전략 검증 | 반자동 투입 전 필수 검증 |
| 6 | KIS OpenAPI 계정·AppKey/AppSecret 확보 | 실주문 API 인증 |
| 7 | `Portfolio`, `Position` 모델 완료 (Phase 8) | 포트폴리오 반영 대상 존재 |

---

## 4. 상세 설계

### 4-1. 주문 흐름 (전체 시퀀스)

```
[공시 수집·파싱·AI 분석] (Phase 1~4)
        ↓
[TradingSignal 생성 — Buy Score / Exit Score] (Phase 6/8)
        ↓
[Risk Engine 사전체크]
  · 종목 일 최대 주문 한도 초과?
  · 포트폴리오 단일 종목 비중 한도 초과?
  · 당일 실현 손실 한도 초과?
  · 거래정지·관리종목 상태?
  · API 연결 정상?
  → BLOCKED: OrderRequest 생성 안 함, AuditLog에 RISK_BLOCKED 기록
  → PASS: OrderRequest 생성 (status=PENDING_USER)
        ↓
[모바일 푸시 + 승인 카드 UI 표시]
  사용자 선택: [승인] [거절] [관망]
  · 승인 → status=USER_APPROVED, KIS API 주문 호출
  · 거절 → status=USER_REJECTED, AuditLog 기록
  · 관망 → status=WATCHING, TTL 만료 시 자동 취소
        ↓
[KIS API 주문 전송]
  · 멱등 주문키(idempotencyKey) 헤더 첨부
  · 응답: 주문번호(ordNo)
  → OrderExecution 생성 (status=SUBMITTED)
        ↓
[체결 조회 폴링 / 웹소켓 수신]
  · 체결 확인 → status=FILLED, 체결가·수량 저장
  · 부분 체결 → status=PARTIAL_FILL
  · 미체결 취소 → status=CANCELLED
        ↓
[Portfolio / Position 반영]
  · 매수 체결: Position upsert (avgPrice, qty, cost 갱신)
  · 매도 체결: Position qty 감소, realizedPnl 기록
        ↓
[TradingAuditLog 최종 기록]
```

### 4-2. Prisma 모델 스케치

```prisma
// ====================================
// 주문 요청 (사용자 승인 대기 단위)
// ====================================
model OrderRequest {
  id               String   @id @default(cuid())
  userId           String
  corpCode         String                         // FK → Company.corpCode
  stockCode        String                         // 6자리 종목코드
  side             OrderSide                      // BUY | SELL
  orderType        OrderType                      // MARKET | LIMIT
  qty              Int                            // 주문 수량 (Risk Engine 산출, 사용자 변경 불가)
  limitPrice       Decimal? @db.Decimal(12, 2)    // 지정가 주문 시 가격
  suggestedPrice   Decimal  @db.Decimal(12, 2)    // 시스템이 제안한 진입 기준가
  status           OrderRequestStatus             // 상태 FSM
  idempotencyKey   String   @unique               // 멱등 주문키 (cuid 또는 rcpNo+userId+ts)
  signalId         String?                        // FK → TradingSignal.id (nullable: 수동도 허용)
  thesisId         String?                        // FK → PositionThesis.id
  exitSignalId     String?                        // FK → ExitSignal.id
  riskCheckResult  Json                           // Risk Engine 사전체크 결과 JSON
  userDecisionAt   DateTime?
  userDecisionNote String?                        // 거절/관망 사유 (선택)
  expiresAt        DateTime                       // 관망 TTL (기본 생성+30분)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // Relations
  user       User            @relation(fields: [userId], references: [id])
  company    Company         @relation(fields: [corpCode], references: [corpCode])
  executions OrderExecution[]
  auditLogs  TradingAuditLog[]

  @@index([userId, status])
  @@index([corpCode])
  @@index([createdAt])
  @@index([expiresAt])   // TTL 만료 배치 쿼리용
  @@map("order_requests")
}

enum OrderSide {
  BUY
  SELL
}

enum OrderType {
  MARKET
  LIMIT
}

enum OrderRequestStatus {
  PENDING_USER       // Risk 통과, 사용자 승인 대기
  USER_APPROVED      // 사용자 승인 완료, 주문 전송 중
  USER_REJECTED      // 사용자 거절
  WATCHING           // 관망 선택 (TTL 내 재승인 가능)
  EXPIRED            // TTL 만료 자동 취소
  RISK_BLOCKED       // Risk Engine 차단 (주문안 생성 안 됨 — AuditLog만)
  SUBMITTED          // KIS API 전송 완료
  FILLED             // 전량 체결
  PARTIAL_FILL       // 부분 체결
  CANCELLED          // 취소
  ERROR              // API 오류
}

// ====================================
// 체결 실행 기록
// ====================================
model OrderExecution {
  id              String   @id @default(cuid())
  orderRequestId  String
  kisOrderNo      String?  @unique  // KIS 주문번호 (응답값)
  kisOrdGrpNo     String?           // KIS 주문그룹번호
  filledQty       Int      @default(0)
  remainQty       Int      @default(0)
  avgFilledPrice  Decimal? @db.Decimal(12, 2)
  filledAt        DateTime?
  execStatus      ExecStatus
  rawResponse     Json?              // KIS API 원본 응답 (디버깅)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  orderRequest OrderRequest @relation(fields: [orderRequestId], references: [id])

  @@index([orderRequestId])
  @@index([kisOrderNo])
  @@map("order_executions")
}

enum ExecStatus {
  SUBMITTED       // 주문 접수
  PARTIAL_FILL    // 부분 체결
  FILLED          // 전량 체결
  CANCELLED       // 취소
  REJECTED_BY_KIS // 증권사 거부 (한도·수량 오류 등)
  ERROR           // 네트워크/API 오류
}

// ====================================
// 전 주문 Audit 로그 (불변, append-only)
// ====================================
model TradingAuditLog {
  id             String   @id @default(cuid())
  userId         String
  orderRequestId String?           // 주문과 연결 (Risk 차단이면 null)
  event          AuditEvent
  actor          AuditActor        // USER | RISK_ENGINE | SYSTEM
  payload        Json              // 이벤트별 상세 데이터
  ipAddress      String?
  deviceInfo     String?
  createdAt      DateTime @default(now())

  // Relations
  user         User          @relation(fields: [userId], references: [id])
  orderRequest OrderRequest? @relation(fields: [orderRequestId], references: [id])

  @@index([userId, createdAt])
  @@index([orderRequestId])
  @@index([event])
  @@map("trading_audit_logs")
}

enum AuditEvent {
  SIGNAL_GENERATED       // Signal 생성
  RISK_CHECK_PASS        // Risk 사전체크 통과
  RISK_CHECK_BLOCKED     // Risk 사전체크 차단
  ORDER_REQUEST_CREATED  // OrderRequest 생성
  USER_APPROVED          // 사용자 승인
  USER_REJECTED          // 사용자 거절
  USER_WATCHING          // 사용자 관망
  ORDER_SUBMITTED        // KIS API 주문 전송
  ORDER_FILLED           // 체결 완료
  ORDER_PARTIAL_FILL     // 부분 체결
  ORDER_CANCELLED        // 주문 취소
  ORDER_ERROR            // 주문 오류
  POSITION_UPDATED       // 포트폴리오 반영 완료
  ORDER_EXPIRED          // TTL 만료
}

enum AuditActor {
  USER
  RISK_ENGINE
  SYSTEM
}
```

**기존 자연키 정합:**
- `OrderRequest.corpCode` → `Company.corpCode` (String @id — DART 8자리)
- `OrderRequest.userId` → `User.id` (cuid)
- `Disclosure.rcpNo` → `idempotencyKey`에 `rcpNo + userId + timestamp` 복합 포함 가능

### 4-3. NestJS 모듈·서비스·엔드포인트

```
TradingModule
├── trading.module.ts
├── order-request/
│   ├── order-request.service.ts
│   ├── order-request.controller.ts
│   └── dto/
│       ├── create-order-request.dto.ts
│       ├── update-order-status.dto.ts
│       └── order-request-response.dto.ts
├── order-execution/
│   ├── order-execution.service.ts
│   └── kis-order-polling.service.ts  // 체결 조회 폴링
├── risk-engine/
│   └── risk-check.service.ts          // 주문 전 사전 검증
├── kis-api/
│   ├── kis-auth.service.ts            // OAuth2 토큰 발급·갱신
│   ├── kis-order.service.ts           // 주문 전송
│   └── kis-inquiry.service.ts         // 체결 조회
└── audit/
    └── trading-audit.service.ts
```

**엔드포인트 시그니처:**

```typescript
// 주문 요청 목록 조회 (사용자 승인 대기 포함)
GET /trading/order-requests
  query: { status?: OrderRequestStatus; page?: number; limit?: number }
  response: { data: OrderRequestResponseDto[]; total: number }
  auth: JWT 필수

// 특정 주문 요청 상세
GET /trading/order-requests/:id
  response: OrderRequestResponseDto
  auth: JWT 필수 + 본인 소유 검증

// 사용자 승인/거절/관망
PATCH /trading/order-requests/:id/decision
  body: { decision: 'APPROVED' | 'REJECTED' | 'WATCHING'; note?: string }
  response: OrderRequestResponseDto
  auth: JWT 필수 + 본인 소유 검증
  // AI는 이 엔드포인트를 호출할 수 없음 — 사용자 JWT 토큰만 허용

// 체결 내역 조회
GET /trading/order-requests/:id/executions
  response: OrderExecutionDto[]

// Audit 로그 조회
GET /trading/audit-logs
  query: { from?: string; to?: string; event?: AuditEvent }
  response: TradingAuditLogDto[]
  auth: JWT 필수

// 내부용 — Risk Engine 트리거 (Signal 이벤트 핸들러, 외부 노출 없음)
// @EventPattern('signal.created') createOrderRequestFromSignal(signal: TradingSignal)
```

### 4-4. Risk Engine 사전체크 의사코드

```typescript
// risk-check.service.ts
async function checkPreOrderRisk(
  userId: string,
  corpCode: string,
  side: OrderSide,
  qty: number,
  price: Decimal
): Promise<RiskCheckResult> {
  const checks: RiskCheckItem[] = []

  // 1. 종목 상태 확인
  const companyStatus = await getCompanyTradingStatus(corpCode)
  if (companyStatus.isSuspended || companyStatus.isManaged) {
    return { passed: false, blockedReason: 'COMPANY_SUSPENDED_OR_MANAGED', checks }
  }

  // 2. 단일 종목 비중 한도
  const portfolio = await getPortfolioByUser(userId)
  const totalAsset = portfolio.totalAssetValue  // 원화
  const positionValue = qty * price.toNumber()
  const currentPosition = await getPositionValue(userId, corpCode)
  const newPositionRatio = (currentPosition + positionValue) / totalAsset
  if (newPositionRatio > MAX_SINGLE_STOCK_RATIO) {  // 기본 0.10 (10%)
    return { passed: false, blockedReason: 'SINGLE_STOCK_RATIO_EXCEEDED', checks }
  }

  // 3. 당일 실현 손실 한도 (하드스탑)
  const todayRealizedLoss = await getTodayRealizedLoss(userId)
  if (todayRealizedLoss < -MAX_DAILY_LOSS_LIMIT) {  // 기본 -0.02 (총자산 2%)
    return { passed: false, blockedReason: 'DAILY_LOSS_LIMIT_EXCEEDED', checks }
  }

  // 4. 1회 주문 금액 한도
  if (positionValue > MAX_SINGLE_ORDER_AMOUNT) {  // 기본 총자산 3%
    return { passed: false, blockedReason: 'SINGLE_ORDER_AMOUNT_EXCEEDED', checks }
  }

  // 5. KIS API 연결 상태
  const kisApiHealthy = await kisHealthCheck()
  if (!kisApiHealthy) {
    return { passed: false, blockedReason: 'KIS_API_UNAVAILABLE', checks }
  }

  // 6. 연속 손실 횟수 제한
  const consecutiveLosses = await getConsecutiveLosses(userId)
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {  // 기본 5회
    return { passed: false, blockedReason: 'CONSECUTIVE_LOSS_LIMIT', checks }
  }

  return { passed: true, blockedReason: null, checks }
}
```

> **AI 금지선:** Risk Engine은 규칙 기반(Rule-based)이다. AI가 리스크 임계값을 동적으로 조정하거나, 한도 초과 상황에서 주문을 승인하는 로직을 생성해선 안 된다.

### 4-5. KIS OpenAPI 연동

```typescript
// kis-auth.service.ts
// 토큰 발급 (1일 유효, Redis 캐시)
POST https://openapi.koreainvestment.com:9443/oauth2/tokenP
body: { grant_type: 'client_credentials', appkey, appsecret }
response: { access_token, token_type, expires_in }

// kis-order.service.ts
// 주식 현금 매수 주문
POST https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash
headers: {
  'authorization': `Bearer ${accessToken}`,
  'appkey': process.env.KIS_APP_KEY,
  'appsecret': process.env.KIS_APP_SECRET,
  'tr_id': 'TTTC0802U',   // 매수: TTTC0802U / 매도: TTTC0801U
  'custtype': 'P',
  'hashkey': hmacSha512(requestBody),  // 멱등성 보장
}
body: {
  CANO: accountNo,       // 계좌번호 앞 8자리
  ACNT_PRDT_CD: '01',   // 계좌상품코드
  PDNO: stockCode,       // 종목코드
  ORD_DVSN: '00',        // 주문 구분 (00=지정가, 01=시장가)
  ORD_QTY: qty.toString(),
  ORD_UNPR: limitPrice || '0',
}

// 체결 조회 (폴링 30초 간격, 최대 10회)
GET https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-daily-ccld
```

**멱등 주문키 생성:**
```typescript
// idempotencyKey = SHA256(userId + signalId + side + corpCode + timestamp(분 단위))
// 동일 분 내 동일 조건 중복 요청 차단
const idempotencyKey = crypto
  .createHash('sha256')
  .update(`${userId}:${signalId}:${side}:${corpCode}:${minuteTimestamp}`)
  .digest('hex')
```

### 4-6. 매수·매도 승인 카드 UI 사양 (Expo 모바일)

```
┌─────────────────────────────────────────────────┐
│ [매수 제안]  삼성전자 (005930)                    │
│ ─────────────────────────────────────────────── │
│ Buy Score   82 / 100  ████████░░ 강한 매수후보   │
│                                                  │
│ 📋 근거 (Phase 6 TradingSignal)                  │
│  · 대규모 공급계약 공시 (매출 대비 24%)           │
│  · 공시 후 거래량 20일 평균 +320%               │
│  · 20일선 위 추세 유지                           │
│                                                  │
│ ⚠️ 리스크                                        │
│  · 최근 5거래일 +18% (단기 과열 가능성)          │
│  · 시장 전반 약세 구간                           │
│                                                  │
│ 💡 주문 제안 (Risk Engine 산출 — 변경 불가)      │
│  주문 유형  지정가                               │
│  수  량     50 주                                │
│  희망가     78,500 원                            │
│  총 금액    3,925,000 원 (포트폴리오 2.8%)       │
│                                                  │
│  [ 승인 ✓ ]   [ 거절 ✗ ]   [ 관망 👀 ]          │
│  (30분 내 미결정 시 자동 만료)                   │
└─────────────────────────────────────────────────┘
```

**컴포넌트 구조 (Expo):**
```
screens/trading/
├── OrderApprovalScreen.tsx        // 승인 카드 목록 (탭: 매수/매도)
├── OrderApprovalCardDetail.tsx    // 개별 카드 상세
├── OrderHistoryScreen.tsx         // 체결 내역 + Audit 로그
└── TradingSettingsScreen.tsx      // KIS 계좌 연결, Risk 한도 설정

components/trading/
├── OrderApprovalCard.tsx          // 메인 승인 카드 컴포넌트
├── ScoreBar.tsx                   // Buy/Exit Score 시각화 바
├── RiskBadge.tsx                  // 리스크 항목 배지
├── OrderSummaryRow.tsx            // 주문 수량·가격·금액 요약
└── DecisionButtons.tsx            // [승인][거절][관망] 버튼 그룹
```

**DecisionButtons 동작 규칙:**
- 승인: `PATCH /trading/order-requests/:id/decision { decision: 'APPROVED' }` → 즉시 KIS 주문
- 거절: 이유 입력 모달 표시 후 기록
- 관망: TTL 타이머 표시, 만료 전 다시 열어 재결정 가능
- 주문 수량·가격은 UI에서 **읽기 전용** (Risk Engine 산출값 고정, 사용자 수정 불가)

---

## 5. 작업 분해

### 백엔드

- [ ] `TradingModule`, `OrderRequestModule`, `OrderExecutionModule`, `TradingAuditModule` 생성
- [ ] Prisma 마이그레이션: `OrderRequest`, `OrderExecution`, `TradingAuditLog` 테이블 및 enum 추가
- [ ] `RiskCheckService.checkPreOrderRisk()` 구현 (6개 체크 항목)
- [ ] Risk 임계값 `TradingRiskConfig` 환경변수/DB 설정 테이블 분리
- [ ] `KisAuthService`: 토큰 발급·갱신, Redis(또는 메모리 캐시) 저장
- [ ] `KisOrderService`: 매수·매도 주문 전송, 멱등 주문키 헤더 처리
- [ ] `KisInquiryService`: 체결 조회 폴링 (30초 간격, 10회 재시도)
- [ ] `OrderRequestService.createFromSignal()`: Signal 이벤트 수신 → Risk 체크 → OrderRequest 생성
- [ ] `OrderRequestService.applyUserDecision()`: 승인/거절/관망 처리 FSM
- [ ] `TradingAuditService.log()`: 모든 상태 변이에 AuditLog append-only 기록
- [ ] TTL 만료 배치: 매 5분 cron — `WATCHING` & `expiresAt < now` → `EXPIRED` 업데이트
- [ ] 체결 후 `Position` / `Portfolio` 반영 로직 (Phase 8 연동)
- [ ] `GET /trading/order-requests`, `PATCH /trading/order-requests/:id/decision`, `GET /trading/audit-logs` 엔드포인트
- [ ] Swagger 문서화 (모든 엔드포인트·DTO)
- [ ] KIS API 오류 시 자동 재시도 (지수 백오프, 최대 3회) + 최종 실패 → `ERROR` 상태 기록

### 모바일

- [ ] `trading/` 라우트 디렉터리 생성 (Expo Router)
- [ ] `OrderApprovalScreen`: 승인 대기 카드 목록, 실시간 갱신 (React Query polling 10초)
- [ ] `OrderApprovalCard`: Score 바, 근거 목록, 리스크 배지, 주문 요약, 결정 버튼
- [ ] TTL 카운트다운 타이머 컴포넌트
- [ ] `OrderHistoryScreen`: 상태별 탭 (전체/체결/거절/관망), Audit 요약
- [ ] 승인 결정 후 체결 진행 상태 토스트/모달 (SUBMITTED→FILLED)
- [ ] `TradingSettingsScreen`: KIS 계좌번호 입력, Risk 한도 표시 (읽기 전용, 변경은 문의)
- [ ] 홈 탭에 '승인 대기 주문 N건' 배지 추가

---

## 6. AI 사용 정책

| 항목 | 내용 |
|------|------|
| AI 사용 | 허용 없음 (Phase 13 자체는 AI 신규 호출 없음) |
| AI 입력 재사용 | Phase 4~6에서 생성된 `DisclosureAnalysis.analysisJson`, `TradingSignal.scoreBreakdown`을 승인 카드 UI에 표시 |
| **AI 절대 금지** | 최종 주문 승인 결정 · 주문 수량 산출 · 손절 하드룰 변경 · Risk Engine 임계값 우회 · 포트폴리오 한도 결정 |
| 근거 | 비전 문서 §4 "AI 금지(절대)" 항목과 일치. 주문 승인은 반드시 사람(사용자)의 UI 액션으로만 실행. |

---

## 7. 비용·성능 고려사항

| 항목 | 수치 목표 | 비고 |
|------|-----------|------|
| KIS API 토큰 발급 | 1일 1회, Redis 캐시 | 불필요한 재발급 방지 |
| 체결 조회 폴링 주기 | 장중 30초, 장외 10분 | KIS API Rate Limit 준수 |
| 승인 카드 UI 갱신 | React Query 10초 간격 | 네트워크 효율 vs 실시간성 균형 |
| DB 쓰기 | TradingAuditLog는 INSERT만 (UPDATE 없음) | 감사 무결성 보장 |
| OrderRequest 보관 | 90일 후 아카이브 (cold storage) | AuditLog는 영구 보관 |
| 동시 승인 대기 한도 | 사용자당 최대 5건 | 주문 폭발 방지 |
| KIS API 오류율 목표 | < 0.5% | 재시도 로직으로 보완 |

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| 이중 주문 (네트워크 재전송) | `idempotencyKey` @unique 제약 + KIS 멱등 헤더 |
| 사용자 승인 직후 장 마감 | 주문 전 장 운영 여부 확인 → 장 마감이면 `CANCELLED` 처리 |
| KIS API 인증 토큰 만료 (장중) | 만료 5분 전 자동 갱신, 갱신 실패 시 신규 주문 차단 |
| 부분 체결 후 사용자 취소 | `PARTIAL_FILL` 상태에서 미체결 잔량만 취소 주문 전송 |
| 가격 급변 (승인 후 진입가 이탈) | 지정가 주문 미체결 → 30분 후 자동 취소 (별도 TTL) |
| Risk 임계값 설정 오류 | 임계값 변경 시 반드시 AuditLog에 관리자 기록 + Slack 알림 |
| 포트폴리오 조회 지연 | Risk 체크 시 캐시된 포트폴리오 값 사용 (5분 TTL) + 실시간 미반영 위험 경고 |
| 모바일 앱 오프라인 중 TTL 만료 | 앱 복귀 시 EXPIRED 상태 표시, 재주문 여부 사용자 선택 |
| 증권사 시스템 장애 | 전 주문 `ERROR` 기록, 사용자에게 장애 안내 푸시 |
| 연속 손실 한도 도달 | Risk Engine이 신규 매수 OrderRequest 생성 차단 + 사용자 알림 |

---

## 9. 완료 기준 (DoD)

### 기능 완료 조건

- [ ] `OrderRequest`, `OrderExecution`, `TradingAuditLog` 테이블 마이그레이션 적용, 기존 자연키(Company.corpCode, Disclosure.rcpNo) FK 정합 확인
- [ ] Risk Engine 6개 체크 항목 전부 동작 — 각 차단 케이스 수동 테스트 완료
- [ ] KIS API 샌드박스 환경에서 매수·매도 주문 전송 및 체결 조회 성공
- [ ] 멱등 주문키 동작 확인 — 동일 키로 두 번 요청 시 두 번째 DB INSERT 차단
- [ ] 사용자 승인 → KIS 주문 → 체결 → Position 반영 전체 흐름 E2E 통과
- [ ] 사용자 거절 → AuditLog 기록 확인
- [ ] 관망 TTL 만료 → `EXPIRED` 상태 자동 전환 확인
- [ ] 모바일 승인 카드 UI 렌더링 및 [승인][거절][관망] 버튼 동작 확인
- [ ] 주문 수량·가격 UI 읽기 전용 강제 확인
- [ ] `GET /trading/audit-logs` 응답에 전 상태 변이 이벤트 포함 확인
- [ ] Swagger 문서 모든 엔드포인트 정상 노출

### 품질 완료 조건

- [ ] `RiskCheckService` 단위 테스트 커버리지 80% 이상
- [ ] KIS API 오류 시 3회 재시도 후 `ERROR` 상태 기록 테스트
- [ ] AuditLog 테이블에 DELETE / UPDATE 트리거 차단 (RLS 또는 애플리케이션 레이어 강제)
- [ ] `docs/api-specification.md` 반자동매매 엔드포인트 섹션 갱신
- [ ] `docs/database-schema.md` 3개 신규 모델 추가 반영
- [ ] `PROJECT_STRUCTURE.md` `TradingModule` 디렉터리 트리 추가
- [ ] `NEXT_STEPS.md` Phase 13 체크 표시 `[x]` 갱신
