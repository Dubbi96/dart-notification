> 상위 문서: [비전](./00-vision-and-principles.md) · 작성: Agent Team

# Phase 14 — 제한적 자동매매

> 작성일: 2026-06-02 · 상태: 설계 초안

---

## 1. 목적 & 범위

### 목적

Phase 12(모의투자)와 Phase 13(반자동매매)을 통과한 **검증된 이벤트 전략에 한해**, 사용자 승인 없이 소액·소비중 범위에서 자동으로 주문을 실행한다. 이 단계는 로드맵의 **마지막 단계**다. 백테스트 성과 기준과 모의투자 기간 요건을 충족하지 못한 전략은 절대 자동화 대상이 될 수 없다.

핵심 설계 원칙:
- **Risk Engine veto 우선:** AI가 아무리 긍정적으로 판단해도, Risk Engine이 거부하면 주문이 생성되지 않는다.
- **하드 리스크 룰은 코드 상수(HARD-CODED):** AI·사용자 설정이 우회할 수 없다.
- **Kill Switch는 항상 즉시 동작:** 어떤 상황에서도 수동 정지 가능.

### 범위 — 포함

- 자동 허용 이벤트 화이트리스트 정의 및 실행 로직
- 자동 금지 이벤트 블랙리스트 및 사전 차단 로직
- 하드 리스크 룰 전체 (1회/종목/일/주 한도, 연속손실 중단, 시장급락 차단)
- Risk Engine 컴포넌트 (`RiskEngineService`) 설계
- 자동매매 전용 감사 로그 (`TradingAuditLog` 확장, `AutoTradingConfig`)
- 점진 롤아웃 게이트 (소액 → 확대)
- Kill Switch API 및 모바일 UI
- 자동매매 활성화 기준 (전략별 DoD 게이트)

### 범위 — 제외

- **최종 주문 승인을 AI가 담당하는 구조** (AI 금지 영역, 절대 불가)
- **손절·익절 하드 룰의 AI 재정의** (코드 상수로만 관리)
- **포트폴리오 한도·주문 수량의 AI 결정** (Rule Engine 전담)
- 자동매매 전략 자체의 학습·자동 파라미터 튜닝
- 초저유동성·정치 테마·관리종목 등 블랙리스트 종목에 대한 어떠한 자동화도 불가

---

## 2. 현재 코드베이스 연결점

| 현재 존재하는 것 | Phase 14와의 연결 |
|----------------|-----------------|
| `Disclosure` (`rcpNo` PK, `corpCode` FK) | 이벤트 트리거 공시 식별 기준 |
| `Company` (`corpCode` PK, `stockCode`, `market`) | 블랙리스트 종목 상태(관리종목/거래정지) 확인 |
| `WatchList` (`userId`, `corpCode`) | 자동매매 허용 유니버스 필터 |
| Phase 6 `TradingSignal` | Buy Score → 자동주문 트리거 조건 입력값 |
| Phase 7 `PositionThesis` | 진입 사유·손절 기준·최대 비중 → Risk Engine 참조 |
| Phase 8 `ExitSignal` | Exit Score → 자동매도 트리거 조건 입력값 |
| Phase 10 `BacktestRun`/`BacktestTrade` | 전략별 활성화 게이트 검증 데이터 |
| Phase 12 `PaperTrade` | 모의투자 성과 → 활성화 게이트 검증 데이터 |
| Phase 13 `OrderRequest`/`OrderExecution` | 자동매매는 승인 단계를 건너뛰는 동일 주문 파이프라인 |

---

## 3. 선행 조건 & 의존성

| 조건 | 필요 Phase | 충족 기준 |
|------|-----------|----------|
| Buy Score 신뢰성 확보 | Phase 6 | 이벤트 타입별 Buy Score 정확도 70% 이상 |
| PositionThesis 저장·훼손 감지 동작 | Phase 7 | 진입/훼손 판단 로직 단위 테스트 통과 |
| Exit Engine 6종 매도 기준 동작 | Phase 8 | 손절·익절·논리훼손 자동 감지 E2E 테스트 |
| 이벤트 타입별 통계 반응 존재 | Phase 9 | 대상 이벤트 각 50건 이상 표본 |
| 백테스트 통과 | Phase 10 | 섹션 9의 전략별 DoD 게이트 전부 충족 |
| AI 비용 통제 동작 | Phase 11 | AI Cost/Net Profit < 20% |
| 모의투자 4주 이상 실운용 | Phase 12 | 가상 포트폴리오 총 손익 0% 이상 또는 MDD < 10% |
| 반자동매매 증권사 API 연동 완료 | Phase 13 | 체결 성공률 95% 이상, 주문 오류 처리 로직 검증 |

---

## 4. 상세 설계

### 4-1. 자동 허용 이벤트 화이트리스트

자동매매는 패턴이 명확하고 과거 통계에서 긍정 신호가 검증된 이벤트에만 허용한다.

| 이벤트 enum | 허용 조건 |
|------------|---------|
| `SHARE_BUYBACK` | 취득 예정금액 > 시가총액 1%, 기간 내 실제 취득 이력 존재 |
| `SHARE_CANCELLATION` | 소각 규모 > 발행주식 1%, 주가 희석 요인 없음 |
| `SUPPLY_CONTRACT` | 계약금액/최근매출 비율 ≥ 10%, 계약 상대방 신뢰도 MEDIUM 이상 |
| `DIVIDEND_INCREASE` | 전년 대비 배당 증가율 ≥ 10%, 무상감자·유상증자 없음 |
| `EARNINGS_SURPRISE` | 실적 컨센서스 대비 +10% 이상, 영업이익 흑자 전환 또는 지속 |
| `AUDIT_RISK_RESOLVED` | 기존 감사의견 한정→적정 전환, 관리종목 해제 공시 |

### 4-2. 자동 금지 이벤트 블랙리스트

아래 이벤트가 감지되면 해당 종목의 **모든 자동매수를 즉시 차단**한다. 기존 보유 포지션은 Phase 8 Exit Engine이 정상 처리한다.

| 이벤트 / 상태 | 차단 범위 |
|-------------|---------|
| `PAID_IN_CAPITAL_INCREASE` (유상증자) | 공시 발생 → 30거래일 자동매수 금지 |
| `CB_ISSUANCE` / `BW_ISSUANCE` | 희석 효과 해소 전까지 자동매수 금지 |
| `AUDIT_OPINION_RISK` (감사의견 한정·거절·의견거절) | 즉시 영구 차단 (수동 해제만 가능) |
| `TRADING_SUSPENSION` (거래정지) | 정지 해제 후 5거래일 자동매수 금지 |
| `DELISTING_RISK` (상장폐지 위험) | 즉시 영구 차단 |
| `LAWSUIT` / 횡령 / 배임 공시 | 즉시 영구 차단 |
| 관리종목 (`managementIssue = true`) | 즉시 영구 차단 |
| 일 평균 거래대금 < 5억 원 (초저유동성) | 자동매수 금지 |
| 정치 테마·단기 급등 (`priceChangeRate5d > 30%`) | 자동매수 금지 |

### 4-3. 하드 리스크 룰 (코드 상수 — AI·사용자 설정 우회 불가)

```typescript
// backend/src/trading/constants/risk-hard-rules.ts
export const RISK_HARD_RULES = {
  // 1회 주문 한도
  MAX_SINGLE_ORDER_RATIO: 0.03,        // 총 자산 대비 3% (최소 1%)

  // 단일 종목 최대 비중
  MAX_SINGLE_STOCK_RATIO: 0.10,        // 총 자산 대비 10% (최소 5%)

  // 일 최대 손실 한도
  MAX_DAILY_LOSS_RATIO: 0.02,          // 총 자산 대비 -2%

  // 주간 최대 손실 한도
  MAX_WEEKLY_LOSS_RATIO: 0.05,         // 총 자산 대비 -5%

  // 재진입 제한
  REENTRY_COOLDOWN_DAYS: 5,            // 손절 후 N거래일 동일 종목 재진입 금지

  // 연속 손실 자동 중단
  CONSECUTIVE_LOSS_HALT: 3,            // 연속 N회 손실 시 자동매매 일시중단
  HALT_RESUME_HOURS: 24,               // 중단 후 재개 대기 시간 (수동 재개 or 24h 후)

  // 시장 급락 신규매수 차단
  MARKET_CRASH_THRESHOLD: -0.03,       // 코스피/코스닥 당일 -3% 이하 시 신규매수 중단
  MARKET_CRASH_COOLDOWN_MINUTES: 60,   // 급락 감지 후 최소 60분 신규매수 금지

  // API 오류 자동 중단
  MAX_API_ERROR_COUNT: 3,              // N회 연속 증권사 API 오류 시 주문 중단
  API_ERROR_COOLDOWN_MINUTES: 30,      // 오류 감지 후 재시도 대기 시간
} as const;
```

### 4-4. Risk Engine 설계

```typescript
// backend/src/trading/risk-engine/risk-engine.service.ts

export interface RiskCheckInput {
  userId:        string;
  stockCode:     string;
  corpCode:      string;
  orderSide:     'BUY' | 'SELL';
  orderAmount:   number;         // 주문 금액 (원)
  totalAssets:   number;         // 현재 총 자산 (원)
  currentStockPosition: number;  // 해당 종목 현재 보유 금액 (원)
  triggerEventType: string;      // 트리거된 이벤트 enum
  buyScore?:     number;         // Phase 6 TradingSignal.buyScore
}

export interface RiskCheckResult {
  approved:        boolean;
  vetoReasons:     string[];      // 거부 시 사유 목록
  adjustedAmount?: number;        // 한도 조정 후 실행 가능 금액 (approved=true일 때만)
  riskLevel:       'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
}

// Risk Engine veto 체크 순서 (순서 중요 — 앞 조건에서 막히면 이후 검사 없이 BLOCKED 반환)
async function checkRisk(input: RiskCheckInput): Promise<RiskCheckResult> {
  // 1. Kill Switch 활성화 여부
  if (await isKillSwitchActive(input.userId)) return veto('KILL_SWITCH_ACTIVE');

  // 2. 자동매매 활성화 여부 (사용자 설정)
  if (!await isAutoTradingEnabled(input.userId)) return veto('AUTO_TRADING_DISABLED');

  // 3. 블랙리스트 이벤트 차단
  if (isBlacklistedEvent(input.triggerEventType)) return veto('BLACKLISTED_EVENT');

  // 4. 종목 상태 차단 (관리종목 / 거래정지 / 상폐 위험)
  if (await isStockBlocked(input.stockCode)) return veto('STOCK_BLOCKED');

  // 5. 시장 급락 차단
  if (await isMarketCrashActive()) return veto('MARKET_CRASH_HALT');

  // 6. API 오류 차단
  if (await isBrokerApiErrorHalt(input.userId)) return veto('BROKER_API_ERROR_HALT');

  // 7. 연속 손실 중단 상태
  if (await isConsecutiveLossHalt(input.userId)) return veto('CONSECUTIVE_LOSS_HALT');

  // 8. 일 최대 손실 도달
  if (await isDailyLossLimitReached(input.userId, input.totalAssets)) return veto('DAILY_LOSS_LIMIT');

  // 9. 주간 최대 손실 도달
  if (await isWeeklyLossLimitReached(input.userId, input.totalAssets)) return veto('WEEKLY_LOSS_LIMIT');

  // 10. 재진입 제한
  if (input.orderSide === 'BUY' && await isReentryCooldown(input.userId, input.stockCode)) return veto('REENTRY_COOLDOWN');

  // 11. 단일 종목 비중 초과
  const maxStockAmount = input.totalAssets * RISK_HARD_RULES.MAX_SINGLE_STOCK_RATIO;
  if (input.currentStockPosition >= maxStockAmount) return veto('SINGLE_STOCK_LIMIT');

  // 12. 1회 주문 한도 초과 → 한도 내로 조정
  const maxOrderAmount = input.totalAssets * RISK_HARD_RULES.MAX_SINGLE_ORDER_RATIO;
  const adjustedAmount = Math.min(input.orderAmount, maxOrderAmount, maxStockAmount - input.currentStockPosition);

  return { approved: true, vetoReasons: [], adjustedAmount, riskLevel: 'LOW' };
}
```

### 4-5. Prisma 모델 스케치

```prisma
// 자동매매 전략 설정 (사용자별 + 이벤트 타입별)
model AutoTradingConfig {
  id              String   @id @default(cuid())
  userId          String
  eventType       String   // 허용된 이벤트 enum (화이트리스트)
  isEnabled       Boolean  @default(false)
  maxOrderRatio   Float    @default(0.02)  // 기본 2%, 최대 3% (RISK_HARD_RULES 이하)
  maxStockRatio   Float    @default(0.05)  // 기본 5%, 최대 10%
  minBuyScore     Int      @default(70)    // 최소 Buy Score 진입 기준
  activatedAt     DateTime?               // 게이트 통과 후 활성화 시각
  rolloutLevel    Int      @default(1)    // 1=소액(1%), 2=중간(2%), 3=정상(3%)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, eventType])
  @@index([userId, isEnabled])
  @@map("auto_trading_configs")
}

// Kill Switch 상태
model KillSwitch {
  id          String   @id @default(cuid())
  userId      String   @unique
  isActive    Boolean  @default(false)
  activatedAt DateTime?
  reason      String?
  activatedBy String?  // "USER" | "SYSTEM_CONSECUTIVE_LOSS" | "SYSTEM_DAILY_LIMIT" | "SYSTEM_API_ERROR"

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("kill_switches")
}

// 자동매매 감사 로그 (Phase 13 OrderExecution 확장)
// 기존 OrderExecution에 autoTriggered 필드 추가
// — 아래는 자동매매 전용 추적 레코드
model AutoTradingAuditLog {
  id                  String   @id @default(cuid())
  userId              String
  stockCode           String
  corpCode            String
  orderExecutionId    String?  // Phase 13 OrderExecution FK (체결 성공 시)
  triggerRcpNo        String   // 트리거 공시 FK → Disclosure.rcpNo
  triggerEventType    String
  buyScore            Int?
  riskCheckResult     Json     // RiskCheckResult 전체 JSON
  riskApproved        Boolean
  vetoReasons         String[]
  orderSide           String   // "BUY" | "SELL"
  requestedAmount     Float
  adjustedAmount      Float?
  executedAt          DateTime?
  status              String   // "RISK_VETOED" | "ORDER_SENT" | "EXECUTED" | "FAILED"
  errorMessage        String?

  createdAt           DateTime @default(now())

  user                User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  disclosure          Disclosure  @relation(fields: [triggerRcpNo], references: [rcpNo])

  @@index([userId, createdAt])
  @@index([userId, status])
  @@index([stockCode])
  @@index([triggerRcpNo])
  @@map("auto_trading_audit_logs")
}

// 연속 손실 추적
model ConsecutiveLossTracker {
  id              String   @id @default(cuid())
  userId          String   @unique
  count           Int      @default(0)   // 현재 연속 손실 횟수
  haltedAt        DateTime?              // CONSECUTIVE_LOSS_HALT 발생 시각
  lastResetAt     DateTime?

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("consecutive_loss_trackers")
}
```

### 4-6. NestJS 모듈/서비스/엔드포인트

```
backend/src/trading/
├── risk-engine/
│   ├── risk-engine.module.ts
│   ├── risk-engine.service.ts          # checkRisk(), isKillSwitchActive() 등
│   └── market-status.service.ts        # 시장 급락 감지 (KIS API 지수 조회)
├── auto-trading/
│   ├── auto-trading.module.ts
│   ├── auto-trading.service.ts         # executeAutoTrade(), evaluateTrigger()
│   ├── auto-trading.controller.ts
│   ├── kill-switch.service.ts          # activate(), deactivate(), getStatus()
│   └── rollout-gate.service.ts         # checkActivationGate(), upgradeRolloutLevel()
└── constants/
    └── risk-hard-rules.ts
```

**엔드포인트 시그니처:**

```typescript
// 자동매매 설정 조회/수정
GET    /auto-trading/config                   // 사용자 전체 전략 설정 목록
PATCH  /auto-trading/config/:eventType        // { isEnabled, maxOrderRatio, minBuyScore }

// Kill Switch
POST   /auto-trading/kill-switch/activate     // { reason?: string } — 즉시 전체 자동매매 정지
POST   /auto-trading/kill-switch/deactivate   // 수동 재개
GET    /auto-trading/kill-switch/status       // { isActive, activatedAt, reason }

// 롤아웃 게이트 검증
GET    /auto-trading/rollout-gate/:eventType  // { gateStatus, passed, failedConditions[] }
POST   /auto-trading/rollout-gate/:eventType/upgrade  // 관리자 전용: 다음 레벨로 승급

// 감사 로그
GET    /auto-trading/audit-logs               // 자동매매 실행 이력 (페이지네이션)
GET    /auto-trading/audit-logs/:id           // 개별 실행 상세 (riskCheckResult 포함)
```

### 4-7. 자동매매 실행 플로우 (의사코드)

```
[이벤트 트리거 발생]
  공시 수집 → Phase 3 DisclosureEvent 생성
  → Phase 6 TradingSignal 생성 (buyScore 계산)

[자동매매 평가 루프] — AutoTradingService.evaluateTrigger()
  1. 이벤트 화이트리스트 확인
     → 포함 안 됨: 건너뜀 (자동매매 대상 아님)

  2. 사용자별 AutoTradingConfig 조회
     → isEnabled = false: 건너뜀

  3. minBuyScore 기준 확인
     → buyScore < config.minBuyScore: 건너뜀

  4. Phase 11 AI 비용 게이트 통과 여부 확인 (L2~L3 호출 필요 시)
     → AI 비용 초과 상태: L1 분석만 사용

  5. Risk Engine checkRisk() 호출
     → approved = false: AuditLog 기록(RISK_VETOED), 주문 생성 안 함 — 종료
     → approved = true: adjustedAmount 확정

  6. Phase 13 OrderRequest 생성 (autoTriggered = true, manualApproval = false)
     → 증권사 API 주문 전송
     → 체결 성공: OrderExecution 저장, AuditLog(EXECUTED)
     → 체결 실패 / API 오류: AuditLog(FAILED), API 오류 카운터 +1
       → 오류 N회 달성: Kill Switch 자동 활성화

  7. 체결 결과 → PositionThesis 업데이트 or 신규 생성
     → Exit Engine 구독 시작

[손절/익절 자동 감지] — ExitEngineService (Phase 8)
  ExitScore ≥ 70 → AutoTradingService.executeAutoSell()
  → Risk Engine checkRisk(orderSide='SELL') — 매도는 한도 검사 생략, Kill Switch만 확인
  → 주문 전송 → AuditLog 기록
  → 손절인 경우: ConsecutiveLossTracker.count += 1
    → count ≥ CONSECUTIVE_LOSS_HALT: Kill Switch 자동 활성화(SYSTEM_CONSECUTIVE_LOSS)
```

### 4-8. 점진 롤아웃 게이트

| 레벨 | 주문 한도 | 활성화 조건 |
|------|---------|-----------|
| Level 1 (소액) | 자산 1% / 종목 3% | 백테스트 DoD 통과 + 모의투자 2주 성과 확인 |
| Level 2 (중간) | 자산 2% / 종목 6% | Level 1 실거래 4주 경과, 실거래 MDD < 5%, 연속손실 0회 |
| Level 3 (정상) | 자산 3% / 종목 10% | Level 2 실거래 8주 경과, 실거래 MDD < 8%, 실거래 승률 55% 이상 |

레벨 업그레이드는 `RolloutGateService.upgradeRolloutLevel()`로 관리자가 수동 승인하며, 조건 미충족 시 API에서 거부한다.

---

## 5. 작업 분해

### 백엔드

- [ ] `RISK_HARD_RULES` 상수 파일 생성 (`risk-hard-rules.ts`)
- [ ] `RiskEngineModule` / `RiskEngineService` 구현 (12단계 veto 체크)
- [ ] `MarketStatusService` 구현 (KIS API 지수 조회, 급락 감지 캐시)
- [ ] `KillSwitchService` 구현 (활성화/비활성화/상태조회, DB 저장)
- [ ] `ConsecutiveLossTracker` Prisma 모델 마이그레이션
- [ ] `KillSwitch` Prisma 모델 마이그레이션
- [ ] `AutoTradingConfig` Prisma 모델 마이그레이션
- [ ] `AutoTradingAuditLog` Prisma 모델 마이그레이션
- [ ] `AutoTradingService.evaluateTrigger()` 구현 (전체 플로우 의사코드 구현)
- [ ] `AutoTradingService.executeAutoSell()` 구현 (Exit Engine 연동)
- [ ] `RolloutGateService` 구현 (게이트 조건 검증, 레벨 업그레이드)
- [ ] `AutoTradingController` REST 엔드포인트 구현 (5개 그룹)
- [ ] Phase 13 `OrderRequest`에 `autoTriggered: Boolean` 필드 추가 마이그레이션
- [ ] 이벤트 화이트리스트·블랙리스트 상수 파일 생성
- [ ] 종목 블랙리스트 상태 조회 서비스 구현 (관리종목/거래정지 실시간 확인)
- [ ] API 오류 카운터 서비스 구현 (자동 Kill Switch 연동)
- [ ] 자동매매 트리거 리스너 구현 (TradingSignal 생성 이벤트 구독)
- [ ] Risk Engine 단위 테스트 (12가지 veto 케이스 각각 테스트)
- [ ] 자동매매 E2E 테스트 (화이트리스트 이벤트 → 체결 → 감사로그 확인)
- [ ] Kill Switch 즉시 동작 테스트 (진행 중인 주문 처리 포함)
- [ ] Swagger 문서 업데이트 (`/auto-trading/**`)

### 모바일

- [ ] 자동매매 설정 화면 (이벤트별 on/off 토글, 롤아웃 레벨 표시)
- [ ] Kill Switch 버튼 (홈 화면 상단 고정 또는 설정 탭 최상단)
- [ ] Kill Switch 활성 상태 배너 (자동매매 정지 중 알림)
- [ ] 자동매매 실행 알림 (체결 성공/Risk Veto/연속손실 중단 Push)
- [ ] 자동매매 감사 로그 화면 (실행 이력, veto 사유, 체결 금액)
- [ ] 롤아웃 레벨 표시 및 다음 레벨 조건 안내

---

## 6. AI 사용 정책

### 허용 (AI 보조)

- 이벤트 타입 최종 확인 (Phase 4 Disclosure Summary AI 결과 재사용, 추가 호출 최소화)
- PositionThesis 생성 시 진입 사유 요약 (Phase 7 결과 재사용)
- Exit 판단 근거 설명 (사용자 알림 메시지용, Exit Score ≥ 70인 경우만)

### 금지 (절대 AI 금지 영역)

> 아래 영역은 3대 설계 원칙 ②③항에 따라 AI가 개입할 수 없다.

| 금지 영역 | 이유 |
|----------|------|
| **최종 주문 승인 여부 결정** | Risk Engine만이 주문을 승인/거부한다 |
| **손절·익절 하드 룰 수치 결정** | `RISK_HARD_RULES` 코드 상수만이 기준이다 |
| **포트폴리오 한도·주문 수량 결정** | Rule Engine 전담 |
| **리스크 룰 예외 처리** | AI가 "이 경우는 예외"라고 판단하는 구조 금지 |
| **Kill Switch 해제 결정** | 사용자 또는 조건 충족 후 자동 재개만 가능 |

**AI가 긍정적으로 분석해도 Risk Engine이 veto하면 주문은 생성되지 않는다. 이 원칙은 코드 레벨에서 강제된다.**

---

## 7. 비용·성능 고려사항

### AI 비용

- Phase 14에서 추가되는 AI 호출 없음 (Phase 4·6·7·8 분석 결과를 재사용)
- 자동매매 체결 건당 AI 직접 비용: 0원 (이미 계산된 Score·Thesis 참조)
- 단, 종목 상태 확인(관리종목/거래정지) API는 매 주문 전 1회 호출 → KIS API 호출 비용 고려

### 성능

| 항목 | 목표 | 비고 |
|------|------|------|
| Risk Engine checkRisk() 응답 | < 200ms | DB 조회 최소화, 캐시 활용 |
| 공시 수집 → 자동주문 전송까지 E2E | < 3분 | 장중 기준, 지연 모니터링 필수 |
| Kill Switch 활성화 → 주문 차단 반영 | < 5초 | Redis 캐시 또는 인메모리 플래그 |
| 감사 로그 저장 | 비동기 처리 | 주문 전송 블로킹 안 함 |

### 증권사 API 비용

- KIS Open API (개인): 무료 (실시간 체결 API 호출 수 제한 확인 필요)
- 주문 건당 증권사 수수료: 0.015% 수준 → 백테스트 비용 반영 확인

---

## 8. 리스크 & 엣지 케이스

| 리스크 | 대응 |
|--------|------|
| 공시 오류·정정공시로 인한 잘못된 이벤트 분류 | 정정공시(`isAmendment=true`) 감지 시 자동매수 즉시 블랙리스트 추가, 기존 포지션 Exit Engine 재평가 |
| 증권사 API 응답 지연·타임아웃 | 타임아웃 3초 설정, N회 실패 시 Kill Switch 자동 활성화, 알림 발송 |
| 장 시작 동시 다발 공시 (어닝 시즌) | 이벤트 큐 처리, 우선순위 기반 순차 실행, 동시 주문 수 제한 |
| 상·하한가 도달로 체결 불가 | 미체결 주문 30초 후 자동 취소, 재시도 없음 |
| 부분 체결 | 체결 금액만 포지션 반영, 잔량 자동 취소 |
| 네트워크 단절 중 연속 손실 추적 누락 | 재연결 시 OrderExecution 테이블 재집계 후 카운터 동기화 |
| 사용자가 Kill Switch 모르고 앱 삭제 | 계정 로그인 복구 시 Kill Switch 기본 활성 상태로 복원, 수동 재개 필수 |
| 동일 공시로 복수 사용자 자동주문 동시 집중 | 종목별 일 자동주문 건수 상한 설정 (동일 종목 동일 이벤트 1일 1회) |
| AI 분석 결과와 Rule 판단 불일치 | AI 결과는 참고용. Rule/Risk Engine 결과가 최종. 충돌 시 감사로그 기록 |
| 롤아웃 레벨 조건 충족 착각 | 레벨 업 API에서 DB 조회로 조건 재검증 후 승급, 수동 재정의 금지 |

---

## 9. 완료 기준 (DoD)

### 전략별 활성화 게이트 (자동매매 허용 전 필수)

각 이벤트 타입별 자동매매 활성화 전에 아래 항목을 모두 충족해야 한다.

- [ ] Phase 9 Event Study: 해당 이벤트 표본 50건 이상, 통계 결과 존재
- [ ] Phase 10 백테스트: 수수료·세금·슬리피지 반영 후 연환산 수익 > 0%, MDD < 15%, 최근 1년 성과 유지
- [ ] Phase 12 모의투자: 해당 이벤트 4주 이상 모의 실행, 가상 MDD < 10%
- [ ] Phase 13 반자동매매: 해당 이벤트 실거래 10건 이상 체결 성공, 주문 오류 0건

### 코드·기능 완료 기준

- [ ] Risk Engine 12단계 veto 단위 테스트 전체 통과
- [ ] Kill Switch 활성화 → 진행 중 주문 취소 E2E 테스트 통과
- [ ] 화이트리스트 이벤트 자동주문 → 체결 → AuditLog 저장 E2E 통과
- [ ] 블랙리스트 이벤트 차단 테스트 (각 케이스별 veto 확인)
- [ ] 연속 손실 N회 → Kill Switch 자동 활성화 테스트 통과
- [ ] 시장 급락 감지 → 신규매수 차단 테스트 통과
- [ ] `RISK_HARD_RULES`의 어떤 값도 사용자 API 요청으로 변경 불가함을 확인
- [ ] 롤아웃 레벨 1 실거래 4주 경과 후 Level 2 업그레이드 게이트 정상 동작
- [ ] 감사 로그 전수 저장 확인 (체결·거부·오류 모두)
- [ ] Swagger `/auto-trading/**` 문서 완성
- [ ] 모바일 Kill Switch 버튼 즉시 동작 확인 (5초 이내 차단 반영)
- [ ] 자동매매 체결 Push 알림 정상 수신 확인
