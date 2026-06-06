# 업무 흐름도

## 1. 사용자 시나리오 플로우

### 1.1 회원가입 및 초기 설정

```mermaid
graph TD
    A[앱 실행] --> B{로그인 여부}
    B -->|미로그인| C[회원가입 화면]
    B -->|로그인됨| D[홈 화면]

    C --> E[이메일/비밀번호 입력]
    E --> F[회원가입 API 호출]
    F --> G[JWT 토큰 저장]
    G --> H[푸시 토큰 등록]
    H --> I[온보딩 화면]

    I --> J[관심 기업 검색]
    J --> K[최소 1개 기업 등록]
    K --> L[공시 유형 선택]
    L --> M[알림 설정 완료]
    M --> D
```

**단계별 설명**:

1. **앱 실행 및 로그인 체크**
   - AsyncStorage에서 Refresh Token 확인
   - 있으면 자동 로그인, 없으면 회원가입 화면

2. **회원가입**
   - `POST /auth/signup` 호출
   - 이메일, 비밀번호, 이름 입력
   - 서버에서 JWT 발급
   - 로컬에 Access Token (메모리) + Refresh Token (AsyncStorage) 저장

3. **푸시 토큰 등록**
   - Expo Notifications.getExpoPushTokenAsync() 호출
   - `POST /devices/register` 호출

4. **온보딩 - 관심 기업 등록**
   - "어떤 기업의 공시를 받아보시겠어요?" 안내
   - 검색창에서 기업명 입력 → `GET /companies/search?query=삼성`
   - 자동완성 목록에서 선택
   - `POST /watchlist` 호출하여 등록
   - 최소 1개 등록 필수

5. **온보딩 - 공시 유형 선택**
   - 5개 공시 유형 체크박스 표시
   - 기본값: 모두 선택
   - `PATCH /notification-settings` 호출

6. **완료**
   - 홈 화면으로 이동

---

### 1.2 공시 알림 수신 및 확인

```mermaid
sequenceDiagram
    participant Scheduler
    participant DART API
    participant DB
    participant Backend
    participant Expo Push
    participant Mobile
    participant User

    Note over Scheduler: 매 10분마다 실행

    Scheduler->>DART API: 최근 공시 조회
    DART API-->>Scheduler: 공시 목록 반환

    Scheduler->>DB: 신규 공시 저장
    DB-->>Scheduler: 저장 완료

    Scheduler->>DB: 사용자 매칭 쿼리
    DB-->>Scheduler: 매칭된 사용자 목록

    loop 각 사용자
        Scheduler->>DB: NotificationHistory 중복 체크
        alt 중복 아님
            Scheduler->>Expo Push: 푸시 알림 발송
            Expo Push-->>Mobile: 푸시 수신
            Scheduler->>DB: NotificationHistory 생성
        end
    end

    User->>Mobile: 푸시 알림 클릭
    Mobile->>Backend: GET /disclosures/:rcpNo
    Backend-->>Mobile: 공시 상세 반환
    Mobile->>User: 공시 상세 화면 표시

    User->>Mobile: DART 원문 보기 클릭
    Mobile->>User: DART 웹사이트로 이동
```

**단계별 설명**:

1. **공시 수집 (Scheduler)**
   - 매 10분마다 cron 실행
   - DART API 호출: `GET /api/list.json?bgn_de=20260307&end_de=20260307`
   - 중복 체크: `rcpNo` 기준으로 DB 조회
   - 신규 공시만 `Disclosures` 테이블에 저장

2. **사용자 매칭**
   ```sql
   SELECT DISTINCT u.id, ud.deviceToken
   FROM users u
   JOIN user_devices ud ON u.id = ud.userId
   JOIN watch_lists wl ON u.id = wl.userId
   JOIN notification_settings ns ON u.id = ns.userId
   WHERE ns.isEnabled = true
     AND wl.corpCode = '00126380'  -- 신규 공시의 corpCode
     AND '정기공시' = ANY(ns.disclosureTypes)  -- 신규 공시의 disclosureType
     AND (
       ns.keywords = '{}' OR  -- 키워드 설정 없음
       '주주총회' ILIKE ANY(ns.keywords)  -- 키워드 매칭
     )
   ```

3. **중복 알림 방지**
   - `NotificationHistory` 테이블에서 `(userId, disclosureRcpNo)` 조합 조회
   - 이미 존재하면 알림 발송 스킵

4. **푸시 알림 발송**
   - Expo Push API 호출
   - Payload:
     ```json
     {
       "to": "ExponentPushToken[...]",
       "title": "새 공시: 삼성전자",
       "body": "주주총회소집공고",
       "data": {
         "type": "disclosure",
         "disclosureRcpNo": "20260307000123"
       }
     }
     ```

5. **알림 히스토리 저장**
   - `NotificationHistory` 테이블에 레코드 생성
   - `isRead: false`

6. **사용자 알림 수신**
   - 모바일 앱에서 푸시 알림 수신
   - 알림 클릭 → Deep Link 처리
   - `disclosure/:rcpNo` 화면으로 이동

7. **공시 상세 조회**
   - `GET /disclosures/:rcpNo` 호출
   - 공시 정보 표시:
     - 기업명, 공시명, 접수일시, 공시 유형, 제출인명
     - "DART 원문 보기" 버튼

8. **알림 읽음 처리**
   - 공시 상세 화면 진입 시 자동으로 읽음 처리
   - `PATCH /notifications/:id/read` 호출
   - `isRead: true, readAt: now()`

9. **DART 원문 보기**
   - 버튼 클릭 시 인앱 브라우저 또는 외부 브라우저로 이동
   - URL: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcpNo}`

---

### 1.3 관심 기업 관리

```mermaid
graph TD
    A[설정 화면] --> B[관심 기업 목록]
    B --> C{액션}

    C -->|추가| D[기업 검색]
    D --> E[자동완성 목록]
    E --> F[기업 선택]
    F --> G{개수 체크}
    G -->|30개 미만| H[POST /watchlist]
    G -->|30개 이상| I[에러: 최대 개수 초과]
    H --> J[목록에 추가]

    C -->|삭제| K[스와이프 또는 버튼]
    K --> L[DELETE /watchlist/:id]
    L --> M[목록에서 제거]

    J --> B
    M --> B
```

**단계별 설명**:

1. **관심 기업 목록 조회**
   - `GET /watchlist` 호출
   - 등록 순서대로 표시 (최신순)

2. **기업 추가**
   - 검색창에 기업명 입력 (예: "삼성")
   - 2글자 이상 입력 시 `GET /companies/search?query=삼성` 호출
   - 자동완성 목록 표시
   - 기업 선택 → `POST /watchlist` 호출
   - 30개 초과 시 에러 표시: "최대 30개까지 등록 가능합니다"

3. **기업 삭제**
   - 스와이프 제스처 또는 삭제 버튼
   - 확인 다이얼로그: "정말 삭제하시겠습니까?"
   - `DELETE /watchlist/:id` 호출

---

### 1.4 알림 설정 관리

```mermaid
graph TD
    A[설정 화면] --> B[알림 설정]
    B --> C{변경}

    C -->|공시 유형| D[체크박스 선택]
    C -->|키워드| E[키워드 입력]
    C -->|알림 on/off| F[토글 스위치]

    D --> G[PATCH /notification-settings]
    E --> G
    F --> G

    G --> H[설정 저장 완료]
```

**단계별 설명**:

1. **공시 유형 선택**
   - 5개 체크박스: 정기공시, 주요사항보고, 발행공시, 지분공시, 기타공시
   - 최소 1개 이상 선택
   - 변경 시 즉시 `PATCH /notification-settings` 호출

2. **키워드 설정**
   - 쉼표로 구분하여 입력 (예: "증자, 감자, 배당")
   - 최대 10개
   - 키워드는 공시명에서 대소문자 구분 없이 매칭

3. **알림 전체 on/off**
   - 토글 스위치
   - OFF 시 모든 알림 발송 중단
   - ON 시 설정에 따라 알림 발송 재개

---

## 2. 백엔드 배치 작업 플로우

### 2.1 공시 수집 및 알림 발송 (10분마다)

```typescript
// 의사코드
@Cron('*/10 * * * *')  // 매 10분마다
async collectDisclosuresAndNotify() {
  try {
    // 1. DART API 호출
    const now = new Date();
    const disclosures = await this.dartApiService.getDisclosures({
      bgn_de: format(now, 'yyyyMMdd'),
      end_de: format(now, 'yyyyMMdd'),
      page_no: 1,
      page_count: 100,
    });

    // 2. 신규 공시 필터링 및 저장
    for (const disclosure of disclosures) {
      const exists = await this.prisma.disclosure.findUnique({
        where: { rcpNo: disclosure.rcpNo },
      });

      if (!exists) {
        // 신규 공시 저장
        const newDisclosure = await this.prisma.disclosure.create({
          data: {
            rcpNo: disclosure.rcpNo,
            corpCode: disclosure.corpCode,
            corpName: disclosure.corpName,
            reportName: disclosure.reportName,
            rcpDt: disclosure.rcpDt,
            flrName: disclosure.flrName,
            rmk: disclosure.rmk,
            disclosureType: this.classifyDisclosureType(disclosure.reportName),
          },
        });

        // 3. 사용자 매칭 및 알림 발송
        await this.notifyMatchedUsers(newDisclosure);
      }
    }

    this.logger.log(`공시 수집 완료: ${disclosures.length}개`);
  } catch (error) {
    this.logger.error('공시 수집 실패', error);
    // 실패 시 재시도 로직 또는 알림
  }
}

async notifyMatchedUsers(disclosure: Disclosure) {
  // 1. 매칭되는 사용자 조회
  const matchedUsers = await this.prisma.$queryRaw`
    SELECT DISTINCT u.id, ud.device_token
    FROM users u
    JOIN user_devices ud ON u.id = ud.user_id
    JOIN watch_lists wl ON u.id = wl.user_id
    JOIN notification_settings ns ON u.id = ns.user_id
    WHERE ns.is_enabled = true
      AND wl.corp_code = ${disclosure.corpCode}
      AND ${disclosure.disclosureType} = ANY(ns.disclosure_types)
      AND (
        array_length(ns.keywords, 1) IS NULL OR
        ${disclosure.reportName} ILIKE ANY(
          SELECT '%' || keyword || '%' FROM unnest(ns.keywords) AS keyword
        )
      )
  `;

  // 2. 각 사용자에게 알림 발송
  for (const user of matchedUsers) {
    // 중복 체크
    const existing = await this.prisma.notificationHistory.findUnique({
      where: {
        userId_disclosureRcpNo: {
          userId: user.id,
          disclosureRcpNo: disclosure.rcpNo,
        },
      },
    });

    if (existing) {
      continue; // 이미 알림 보냄
    }

    // 푸시 알림 발송
    try {
      await this.expoPushService.send({
        to: user.deviceToken,
        title: `새 공시: ${disclosure.corpName}`,
        body: disclosure.reportName,
        data: {
          type: 'disclosure',
          disclosureRcpNo: disclosure.rcpNo,
        },
      });

      // 알림 히스토리 저장
      await this.prisma.notificationHistory.create({
        data: {
          userId: user.id,
          disclosureRcpNo: disclosure.rcpNo,
        },
      });
    } catch (error) {
      this.logger.error(`푸시 발송 실패: ${user.id}`, error);
      // 실패 로그 남기고 계속 진행
    }
  }
}
```

---

### 2.2 공시 유형 분류 로직

**공시명 기반 분류**:

```typescript
classifyDisclosureType(reportName: string): string {
  // 정기공시
  if (
    reportName.includes('사업보고서') ||
    reportName.includes('반기보고서') ||
    reportName.includes('분기보고서') ||
    reportName.includes('결산서류') ||
    reportName.includes('주주총회')
  ) {
    return '정기공시';
  }

  // 주요사항보고
  if (
    reportName.includes('주요사항보고') ||
    reportName.includes('합병') ||
    reportName.includes('분할') ||
    reportName.includes('영업양수도') ||
    reportName.includes('자산양수도')
  ) {
    return '주요사항보고';
  }

  // 발행공시
  if (
    reportName.includes('증자') ||
    reportName.includes('감자') ||
    reportName.includes('전환사채') ||
    reportName.includes('신주인수권부사채') ||
    reportName.includes('교환사채')
  ) {
    return '발행공시';
  }

  // 지분공시
  if (
    reportName.includes('지분공시') ||
    reportName.includes('대량보유상황보고') ||
    reportName.includes('임원ㆍ주요주주특정증권등소유상황보고')
  ) {
    return '지분공시';
  }

  // 기타공시
  return '기타공시';
}
```

---

### 2.3 만료 토큰 정리 (매일 자정)

```typescript
@Cron('0 0 * * *')  // 매일 00:00
async cleanupExpiredTokens() {
  try {
    // 7일 이상 사용하지 않은 디바이스 토큰 삭제
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const deleted = await this.prisma.userDevice.deleteMany({
      where: {
        lastUsedAt: {
          lt: sevenDaysAgo,
        },
      },
    });

    this.logger.log(`만료 토큰 정리 완료: ${deleted.count}개`);
  } catch (error) {
    this.logger.error('토큰 정리 실패', error);
  }
}
```

---

## 3. 에러 처리 및 재시도 전략

### 3.1 DART API 호출 실패

**문제**: DART API가 일시적으로 응답하지 않음

**해결**:
1. Axios Retry 플러그인 사용
2. 최대 3회 재시도, 지수 백오프 (1초, 2초, 4초)
3. 3회 실패 시 에러 로그 남기고 다음 주기에 재시도

```typescript
const axiosInstance = axios.create({
  baseURL: 'https://opendart.fss.or.kr',
});

axiosRetry(axiosInstance, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           error.response?.status === 500;
  },
});
```

---

### 3.2 푸시 알림 발송 실패

**문제**: 디바이스 토큰 만료 또는 Expo Push 서비스 장애

**해결**:
1. 토큰 만료 에러 (`DeviceNotRegistered`) → 해당 디바이스 토큰 삭제
2. 일시적 에러 → 로그 남기고 계속 진행 (다음 공시 때 재발송)
3. 배치 발송 시 실패한 토큰만 필터링

```typescript
async sendPushNotifications(notifications: PushNotification[]) {
  const chunks = chunk(notifications, 100); // Expo는 최대 100개씩

  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error') {
        if (ticket.details?.error === 'DeviceNotRegistered') {
          // 토큰 삭제
          await this.prisma.userDevice.delete({
            where: { deviceToken: chunk[i].to },
          });
        } else {
          this.logger.error('푸시 발송 실패', ticket.details);
        }
      }
    }
  }
}
```

---

### 3.3 DB 연결 실패

**문제**: PostgreSQL 일시적 연결 끊김

**해결**:
1. Prisma 자동 재연결 활성화
2. Connection Pool 설정 (최소: 5, 최대: 20)
3. 연결 실패 시 재시도 로직

```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Connection pool 설정
  // postgresql://user:password@localhost:5432/db?connection_limit=20
}
```

---

## 4. 로깅 및 모니터링 포인트

### 4.1 주요 로깅 포인트

| 구분 | 로그 내용 | 레벨 |
|------|-----------|------|
| **공시 수집** | 수집 시작/완료, 신규 공시 개수 | INFO |
| **공시 수집 실패** | DART API 호출 실패, 에러 메시지 | ERROR |
| **알림 발송** | 발송 성공/실패, 수신자 수 | INFO |
| **토큰 만료** | 디바이스 토큰 삭제 | WARN |
| **API 요청** | 엔드포인트, 사용자 ID, 응답 시간 | DEBUG |
| **에러** | Exception 발생, 스택 트레이스 | ERROR |

---

### 4.2 모니터링 지표 (향후)

- 공시 수집 성공률 (%)
- 알림 발송 성공률 (%)
- API 평균 응답 시간 (ms)
- DB 쿼리 평균 실행 시간 (ms)
- 일일 활성 사용자 (DAU)
- 알림 읽음률 (%)

---

## 5. KRX 시세 수집 플로우 (M4-C, DAR-8)

### 5.1 EOD 일봉 수집 (평일 18:30)

```
KrxMarketDataScheduler.collectDailyPricesForDate()
  ├─ 주말·휴장일 체크 → 스킵
  ├─ isCollecting 락 → 중복 방지
  ├─ Company.findMany (stockCode NOT NULL)
  └─ for each company:
       KrxApiService.fetchStockDaily(basDd, stockCode)
         └─ GET /sto/stk_bydd_trd?basDd=&isuCd=&auth=
              (axios-retry 3회, exponential backoff)
       StockDailyPrice.upsert(stockCode, tradeDate)
```

### 5.2 시장지수 수집 (평일 18:45)

```
KrxMarketDataScheduler.collectMarketIndicesForDate()
  └─ for KOSPI, KOSDAQ:
       KrxApiService.fetchIndexDaily(indexType, basDd)
         └─ GET /idx/kospi_dd_trd | /idx/kosdaq_dd_trd
       MarketIndex.upsert(indexCode, tradeDate)
```

### 5.3 종목상태 수집 (평일 08:50, 장 시작 전)

```
KrxMarketDataScheduler.collectStockStatusesForDate()
  └─ KrxApiService.fetchStockStatus(basDd)
       └─ GET /sto/isu_mrktact_info
            (거래정지=11, 관리=12, 투자주의=21, 이상급등=31)
     StockStatus.upsert(stockCode) — 거래정지/관리/투자주의/이상급등 플래그
```

### 5.4 KRX API 에러 처리

| 상황 | 처리 |
|------|------|
| KRX_API_KEY 미설정 | KrxApiUnavailableError → graceful 로그, 수집 스킵 (앱 정상 부팅 유지) |
| 429 Too Many Requests | axios-retry exponential backoff 3회 |
| 503 / 네트워크 오류 | 동일 backoff 재시도 |
| 주말 호출 | isWeekend() 체크 후 즉시 스킵 |
| 수집 중 개별 종목 실패 | 경고 로그, skipped++ 증가, 나머지 계속 |

### 5.5 수동 트리거 (관리자)

```
POST /market-data/collect/all?basDd=YYYYMMDD
  → collectAll() — 일봉+지수+종목상태 병렬 + MarketDataCollectionLog 기록
GET  /market-data/collection-logs?tradeDate=YYYYMMDD
  → MarketDataCollectionLog 조회 (최근 20건)
```

### 5.6 히스토리컬 백필 (DAR-50)

데이터 최대수집 — 과거 N거래일 일봉 + 기술지표 적재로 chart 점수·entryReady 해금 → 모의매수 작동.

```
POST /market-data/backfill/daily?days=60&endDate=YYYYMMDD
  → backfillDailyPrices() — endDate부터 과거 N거래일 일봉을 StockDailyPrice에 멱등 적재
     (주말 스킵·휴장일 0행 자동 스킵·createMany skipDuplicates·날짜간 delay)
POST /indicators/backfill?mode=latest|all
  → IndicatorBackfillService.backfill() — DB 일봉 → 순수함수 지표 계산 → technical_indicators 멱등 upsert
     (latest=종목별 최신 거래일 / all=보유 전 거래일)
POST /signals/regenerate
  → 기존 trading_signals 재채점(upsert) — TI 백필 후 chart/entryReady 반영, 파생 신호만 갱신
```

수동 스크립트(관리자):
```
npx ts-node -r dotenv/config src/engine3-quant-market/market-data/backfill-history.manual.ts [days] [endDate]
npx ts-node -r dotenv/config src/engine3-quant-market/indicators/indicator-backfill.manual.ts [latest|all]
```

---

## 6. Portfolio & Exit 엔진 점검 스케줄 (M8-A DAR-12)

### 6.1 하루 3회 점검 (평일만)

| 점검 시간 | Cron | CheckTime 레이블 | 설명 |
|-----------|------|-----------------|------|
| 09:00 | `0 9 * * 1-5` | `PRE_MARKET` | 장 시작 전 — 전날 종가·overnight 리스크 점검 |
| 13:00 | `0 13 * * 1-5` | `INTRADAY` | 장중 — VWAP·장중 이탈 점검 |
| 16:30 | `30 16 * * 1-5` | `POST_MARKET` | 장 마감 후 — 종가 기준 일별 스냅샷 업데이트 |

### 6.2 점검 흐름

```
IExitCheckScheduler.runPreMarketCheck() / runIntradayCheck() / runPostMarketCheck()
  └─ ExitEngineService.checkAllPositions(checkTime)
       └─ for each OPEN Position:
            IPositionProvider.getTechnicalSnapshot(stockCode)
            IPositionProvider.getThesisSnapshot(positionId)
            IPositionProvider.getDisclosureEvents(corpCode, since)
            calculateExitScore(pos, tech, thesis, events)   ← 순수 Rule, AI 0
              ├─ calcLossRiskScore()     — 손실 리스크 (0~20)
              ├─ calcThesisBreakScore()  — 투자논리 훼손 (0~20, invalidConditions 평가)
              ├─ calcChartBreakScore()   — 차트 훼손 (0~20)
              ├─ calcTimeExceededScore() — 시간 초과 (0~10)
              ├─ calcOverweightScore()   — 과다 비중 (0~10)
              └─ calcPositiveMomentumBonus() — 긍정 모멘텀 감산 (0~20)
            → Exit Score 합산 → ExitAction 결정
            IExitSignalRepository.save(ExitSignal)
```

### 6.3 Exit Action 판정 기준 (순수 Rule)

| Exit Score | ExitAction | 의미 |
|-----------|-----------|------|
| 0~29 | HOLD | 보유 유지 |
| 30~49 | WATCH | 주의 관찰 |
| 50~69 | REDUCE | 일부 축소 (25~50% 매도 제안) |
| 70~89 | EXIT | 전량 매도 후보 |
| 90~100 | BLOCK_REBUY | 즉시 리스크 매도 + 재매수 금지 |

### 6.4 AI 금지영역

- Exit Score 공식·트리거 가중치·비중 한도: 순수 Rule 전용, AI 개입 절대 금지
- 손절/익절 하드룰·주문 수량: Engine5(Risk)가 독립 강제 — 이 엔진은 신호/점검만
- `ExitSignal.aiUsed = false` 원칙 (논리훼손 해석 보조 시에만 true 허용, AIUsageLog 기록 필수)

---

**작성일**: 2026-03-07
**버전**: 1.2 (M8-A DAR-12: Portfolio & Exit 엔진 점검 스케줄 추가)
