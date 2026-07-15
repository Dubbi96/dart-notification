# 업무 흐름도

## 1. 사용자 시나리오 플로우

### 1.1 로그인(카카오 OAuth) 및 초기 설정

```mermaid
graph TD
    A[앱 실행] --> B{로그인 여부}
    B -->|미로그인| C[로그인 화면]
    B -->|로그인됨| D[홈 화면]

    C -->|카카오로 로그인| E[시스템 브라우저 OAuth 인증]
    C -->|둘러보기| P[게스트 모드]
    E --> F[백엔드 콜백에서 JWT 발급]
    F --> G[expo-secure-store에 토큰 저장]
    G --> H[푸시 토큰 등록]
    H --> I[온보딩 화면]

    I --> J[1단계: 관심 기업 선택 - 선택사항]
    J --> K[2단계: 푸시 알림 동의]
    K --> L[3단계: 신호·포트폴리오 가치 안내]
    L --> D
```

**단계별 설명**:

1. **앱 실행 및 로그인 체크**
   - expo-secure-store 에 영속된 인증 상태(Zustand persist `auth-storage` — accessToken/refreshToken) 확인
   - 있으면 자동 로그인, 없으면 로그인 화면 (AsyncStorage 미사용 — Expo Go 미지원)

2. **로그인 — 카카오 OAuth 전용** (모바일에 이메일/비밀번호 회원가입 없음)
   - "카카오로 로그인" 버튼 → `WebBrowser.openAuthSessionAsync` 로 kauth.kakao.com authorize 진입
   - 카카오 인증 완료 → 백엔드 `GET /auth/kakao/callback` 이 code 를 교환해 JWT 발급·임시 저장(state 키)
   - 앱이 `GET /auth/kakao/result?state=...` 폴링으로 Access + Refresh Token 수령
     (앱이 code 를 직접 획득한 경우 `POST /auth/kakao` 경로도 지원)
   - 토큰은 `useAuthStore`(Zustand) → expo-secure-store 에 저장. 서버 User 데이터는 React Query(`useMe`)가 SSOT — 스토어에 복제하지 않음(DAR-262)
   - 로그인 없이 **게스트(둘러보기)** 진입 가능 — 공시 둘러보기 동선(DAR-43)

3. **푸시 토큰 등록**
   - Expo Notifications.getExpoPushTokenAsync() 호출
   - `POST /devices/register` 호출

4. **온보딩 1단계 - 관심 기업 선택 (선택사항)**
   - 검색창에서 기업명 입력 → `GET /companies/search?query=삼성`
   - 자동완성 목록에서 선택 → `POST /watchlist` 등록
   - 마찰 제거(DAR-65): 0개여도 다음 단계 진행 가능 (공시 유형 선택은 설정 화면 §1.4 로 이동)

5. **온보딩 2단계 - 푸시 알림 동의**
   - OS 알림 권한 요청. 거부 시 인라인 안내 후 진행(무음 실패 방지)

6. **온보딩 3단계 - 신호·포트폴리오 가치 안내 (DAR-209)**
   - 서비스 핵심 가치 안내 후 '신호 보러 가기' 또는 '홈으로' 이동

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

    Note over Scheduler: 평일 08~18시 10분 간격<br/>(장외 06~07·18~22시 1시간 간격)

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
   - 평일 08:00~17:50 10분 간격 cron 실행(`*/10 8-17 * * 1-5` KST) + 장외 시간대(06~07시·18~22시) 1시간 간격 보조 슬롯(`0 6-7,18-22 * * 1-5`)
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

### 2.1 공시 수집 및 알림 발송 (평일 08~18시 10분 간격)

실제 크론: `SchedulerService.collectDisclosures` — `@Cron('*/10 8-17 * * 1-5')`(KST) +
장외 보조 슬롯 `collectDisclosuresOffHours` — `@Cron('0 6-7,18-22 * * 1-5')`(이른 아침/저녁 공시 대비, 동일 경로 재호출).

```typescript
// 의사코드
@Cron('*/10 8-17 * * 1-5', { timeZone: KST })  // 평일 08:00~17:50 10분 간격
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

### 2.4 AI 평가 백필 드레인 (매일 02:00, DAR-379)

EventStudy 실현결과(사후)와 결합할 **AI 평가자료(사전)** 코퍼스를 늘리기 위해, 이벤트 추출은
됐으나(`SUCCESS`/`NEEDS_REVIEW`) 아직 AI 분석(`summary`)이 없는 **과거 미분석 공시**를 비용게이트
내에서 점진 드레인한다. `AiBackfillScheduler`(`@Cron('0 2 * * *')`) → `AiBackfillDrainService.drainOnce()`.

```typescript
@Cron('0 2 * * *', { timeZone: KST })  // 매일 02:00
async drainBackfill() {
  // 1) 예산 판정: AiCostLimitGuard.getLimitStatus()
  //    dailyExceeded/monthlyExceeded → 발행 0건(skippedByBudget). 예산 회복 시 다음 날 진척.
  // 2) 배치 상한 = min(MAX_BATCH_PER_RUN=200, floor(remainingDaily / $0.01 추정단가))
  // 3) 미분석 후보(extractedAt asc, 오래된 순) 조회 → AI_ANALYZE 큐에 발행
  //    (jobId = ai-<rcpNo> 자연키 → 멱등, consumer (rcpNo,task) 캐시로 중복 LLM 호출 0)
}
```

**비용 폭주 방지(이중 방어)**: 드레이너는 예산 잔액이 감당하는 만큼만 '소프트' 페이싱 발행하고,
실제 일 $1/월 $20 캡의 **하드 보장**은 consumer 의 `AiCostLimitGuard.enforceLimit`(호출별 L0
강등)이 담당한다. 추정 단가가 빗나가도 비용은 캡을 넘지 못한다.

**AIUsageLog 누락 0**: 드레이너는 발행만 하고, AI 호출/스킵의 비용 기록은 기존 consumer 경로가
모든 태스크에 대해 보장한다(신규 기록 경로 없음 = 누락 위험 0).

**기존 `reprocessMissingAi`(수동 전용)와의 차이**: 수동 경로는 예산 소진 시에도 L0 스킵 대상을
무한 재발행해 큐 노이즈가 되므로 cron 미연결이었다. 본 드레이너는 **예산이 남았을 때만** 발행하므로
노이즈 없이 일자별 안전 드레인이 가능하다.

**AI 금지영역 불가침**: 생성되는 것은 참고 평가자료(`DisclosureAnalysis`/`PersonaAnalysis`)뿐이다.
Buy/Exit Score·Risk 하드룰·주문 승인·손절에는 일절 개입하지 않는다.

### 2.5 이벤트 추출 백필 드레인 (주말 03:00, DAR-391 → DAR-503 주말 전용)

**진단(상위 병목)**: 공시는 161K+ 연중 백필됐으나 `DisclosureEvent` 추출이 최근 월에만 집중되어
(`202506`·`202507`·`202606`) **2025-08~2026-05 추출 0** → 신호·백테스트가 6월만 거래하는 진짜 게이트.
라이브 공시는 수집 직후 `onDocumentParsed` 체이닝으로 즉시 추출되지만, 과거 백필 공시는 파싱·추출
적체가 `rcpDt` 분포로 가시화되지 않아 사일런트로 비어 있었다. (실측: 백필 241,700건 중 문서 DONE
648건뿐 → 174,772 PENDING + 65,903 문서레코드 부재가 **파싱 게이트**에 적체.)

`EventBackfillScheduler`(`@Cron('0 3 * * *')` 발화, **주말 창에서만 드레인** — 주중은 `WINDOW_SKIPPED`+`recordSkip`)
→ `EventBackfillDrainService.drainOnce()`. rcpDt 시간순 2단계:

> **2026-07 라이브 파싱 기아 후속**: 본 드레인의 야간 파싱등록(1,000건/일)이 자정(KST) 쿼터 리셋 직후
> 문서 fetch 벌크 소비로 이어져 낮의 라이브 공시 문서 fetch 를 굶겼다(성공 추출이 전부 KST 00~04시에
> 몰린 prod 물증 → 라이브 이벤트 0 → 매수 신호 0). `isHeavyCollectionWindow` 게이트로 주말 전용 전환.

```typescript
@Cron('0 3 * * *', { timeZone: KST })  // 매일 03:00 발화 — 주중은 WINDOW_SKIPPED(DAR-503)
async drainBackfill() {
  // Phase 1 — 추출(AI 무관 Rule 우선, DART 호출 0): isBackfill 공시 중 문서는 DONE 이나
  //   이벤트가 없는 건을 rcpDt 오름차순으로 processDisclosure(보유 parsedJson 재사용).
  //   → DisclosureEvent rcpDt 분포를 과거로 직접 확장(멱등 upsert rcpNo).
  // Phase 2 — 파싱 피드(throttle-safe): 문서 레코드가 없는 백필 공시를 rcpDt 오름차순으로
  //   enqueueParsing(PENDING 등록)만. 실제 DART fetch·레이트리밋 준수는 기존 throttled
  //   파싱 드레인(PipelineDrainScheduler)이 소유 → 중복 호출·폭주 없음.
}
```

**진행성(정직)**: 1회 배치 상한(추출 200·파싱등록 1000) — 일배치로 점진. 즉시 전량 처리 불가이며
잔여 백로그(`remainingUnextracted`/`remainingUnparsed`)로 정직 표기한다. 파싱 throughput(지배 게이트)은
기존 파싱 드레인의 throttle(BATCH_CONCURRENCY=5)이 상한을 고정 → DART 레이트리밋 준수.

**커버리지 가시화**: `GET /pipeline/event-coverage` 가 `rcpDt` 월(YYYYMM)별 공시 대비 이벤트 분포를
LEFT JOIN 으로 노출(빈 구간 events=0 가시화) → '연중화' 진척을 측정한다. 수동 1회 실행은
`POST /pipeline/event-backfill`(extractLimit·parseEnqueueLimit, 인증 필수).

**AI 금지영역 불가침**: 추출은 전부 Rule(L0). AI는 기존 큐 체이닝(비용게이트 #335)에 위임 — 본 경로
신규 AI 호출 0. 손절·주문(Engine5)과 무관.

### 2.6 거래대상 우선 fetch — DART 쿼터 최적화 (DAR-394)

**진단(실측)**: 연속 드레인이 백필 공시 전부의 문서를 **무차별 fetch** 하는데, DART 일일 fetch
쿼터는 하드 상한이다. 그러나 백테스트 신호는 **거래대상 이벤트유형**(공급계약·자사주·유상증자·
CB/BW·실적·배당·소송·감사의견·거래정지·상장폐지 등 17종)에서만 나온다 — 비거래 유형(대다수)은
fetch 해도 신호 0 → 쿼터 낭비. (라이브 dev DB 실측: PENDING 195,667건 중 거래대상은 34,398건(≈17.6%)
뿐 → 무차별 FIFO 드레인은 매 배치의 ≈82%를 신호-0 공시에 소진.)

**해결 — 메타데이터 선별 우선순위(문서 fetch 전, 추가 쿼터 0)**:
- `classifyByReportName`(event-classifier SSOT 재사용) + `isTradeRelevantReportName` —
  이미 백필된 **보고서명**만으로 거래대상 후보를 L0 Rule(정규식)로 식별. 원문 fetch 불필요.
- `TRADE_RELEVANT_EVENT_TYPES` = persona-view 의 FAVORED ∪ DILUTIVE ∪ NEGATIVE 와 1:1 정합
  (이 집합 밖은 모든 persona view 가 NEUTRAL → 신호 0).
- `processPendingBatch(limit, { prioritizeTradeRelevant=true, skipNonTrade=false })`:
  거래대상 후보를 보고서명 키워드로 DB prefilter 후 정밀 정규식으로 확정, **최신 접수일(rcpDt desc)
  우선** 선택(백테스트 최근 구간 빠르게 충전). 거래대상이 limit 미만이면 비거래로 채워 **전량
  커버리지 보존**(순서만 바뀜·누락 0). `skipNonTrade=true` 면 쿼터를 거래대상에만 집중.
- **쿼터 인지**: 기존 적응형 백오프(DAR-392)가 레이트리밋/쿼터 소진을 흡수(자정 리셋 후 자동 재개).
  `GET /pipeline/drain-progress` 에 `tradeRelevant{ total·done·pending·donePercent }` 커버리지 추가.

**효과(실측)**: 무차별 FIFO 드레인의 큐 헤드는 7/8 이 비거래(효력발생안내·감사보고서·타법인주식취득 등)
였으나, 거래대상 우선 선택은 배치를 거의 100% 신호 공시로 채운다 → 동일 쿼터로 신호 커버리지 ≈5.7×.
미해결(옵션): 동일 우선순위 내 **월별 라운드로빈**(연중 균형). 현재는 최신월 우선(rcpDt desc).

---

### 2.7 공시 원문(rawText) S3 오프로드 드레인 (주말 매 10분, DAR-395·DAR-503)

> **DAR-503(주말 스케줄링)**: 이 드레인은 대형 스캔이라 주중 DB 커넥션 풀·DART 쿼터와 경쟁했다.
> 이제 매 10분 발화하되 실제 드레인은 **주말 창**(`isHeavyCollectionWindow`)에서만 수행하고, 주중
> 사이클은 즉시 `WINDOW_SKIPPED`(드레인 미수행) + CronRunLog `SKIPPED` 기록으로 크론 생존만 남긴다.
> cron-health `rawtext.offload-drain` stale 임계는 주말 주기에 맞춰 8일로 상향(§2.12).

**진단(용량)**: DB TOP `disclosure_documents` 약 1.7GB — `rawText` 원문이 본질이며 증가 중. 1년치만으로
1.7GB → 멀티이어 백필 시 수십~수백 GB 폭증. rawText 는 추출 시점에만 필요한 콜드 데이터.

**해법**: 원문을 객체 스토리지(S3/로컬)로 오프로드하고 DB 는 메타데이터 + 구조화 결과 + 포인터
(`rawTextS3Key`)만 보유 → 로컬 DB 경량화. `common/storage` 의 `ObjectStorageService`(드라이버 선택
팩토리: S3/로컬, 자격증명 미설정 시 graceful 로컬 폴백) + `RawTextStoreService`(오프로드/lazy fetch).

- **쓰기(신규)**: 파싱 완료(`disclosure-documents.service`) 시점에 rawText 를 gzip 업로드 후 DB 컬럼
  비움(멱등). 실패 시 graceful — rawText 보존(데이터 손실/차단 0).
- **읽기**: Engine2 AI excerpt 조회가 `rawTextS3Key` 로 S3 lazy fetch(소량 캐시). 추출 완료분은 콜드.
- **기존분 마이그레이션**: `RawTextOffloadScheduler`(`@Cron('*/10 * * * *')`) → `RawTextOffloadDrainService.drainOnce()`.
  `parseStatus=DONE` + rawText 보유 문서를 rcpNo 오름차순 배치(기본 200)로 오프로드 후 컬럼 비움. 점진·재개가능·멱등.

```typescript
@Cron('*/10 * * * *', { timeZone: KST })  // 매 10분 발화(주말만 실제 드레인·DAR-503)
async drainOffload(now = new Date()) {
  // DAR-503: 헤비 수집 창(기본 주말) 밖이면 WINDOW_SKIPPED + recorder.recordSkip(주중 정지).
  // 주말: DONE + rawText 보유 문서를 배치만큼 gzip 업로드(disclosure-rawtext/{rcpNo}.txt.gz) 후 rawText=null.
  // 한 건 실패는 배치를 깨지 않고 rawText 보존(다음 회차 재시도). 잔여 0이어도 주말엔 계속 RAN.
}
```

**가시화/수동**: `GET /pipeline/rawtext-offload-progress`(잔여/완료율/활성 드라이버 s3|local),
`POST /pipeline/rawtext-offload?limit=200`(멱등, 인증 필수). 디스크 회수(VACUUM)는 운영 단계
(docs/deployment.md). S3 수명주기(표준→IA→Glacier)·gzip 으로 콜드 원문 비용 절감.

**AI/Risk 무관**: 순수 인프라/용량 작업. 신규 AI 호출 0, Engine5 하드룰과 무관.

### 2.8 공시 파싱 표(tables) S3 오프로드 드레인 (주말 매 10분, DAR-399·DAR-503)

> **DAR-503(주말 스케줄링)**: `tables` LEFT JOIN 대형 스캔(건당 50~75초)이 7/4~5 프로드 풀 고갈
> (health 503 플래핑)의 주범이었다. §2.7 과 동일하게 매 10분 발화·**주말 창에서만 드레인**(주중
> `WINDOW_SKIPPED`). cron-health `tables.offload-drain` stale 임계 8일로 상향(§2.12).

**진단(용량)**: rawText 전량 오프로드(§2.7) 후에도 `disclosure_documents` 가 1.7GB 잔존. TOAST 분해
실측 — **진짜 bulk 는 rawText 가 아니라 `tables` JSONB(약 1,619MB·58k 문서)**. `parsedJson` 은 5MB뿐
(콜드 아님 → DB 유지). 즉 로컬 대용량은 파싱된 표였다.

**해법**: rawText 와 동일 패턴으로 `tables` 를 객체 스토리지로 오프로드하고 DB 는 `tablesS3Key` 포인터만
보유. `common/storage` 의 `TablesStoreService`(JSON 직렬화 + gzip, key `disclosure-tables/{rcpNo}.json.gz`,
오프로드/lazy fetch + 읽기 캐시).

- **쓰기(신규)**: 파싱 완료(`disclosure-documents.service`) 시점에 `tables` 를 JSON+gzip 업로드 후 DB 컬럼을
  `Prisma.DbNull` 로 비움(멱등) → 신규 문서 로컬 누적 0. 실패 시 graceful(tables 보존).
- **읽기**: `disclosure-events.service` SHARE_BUYBACK 폴백 스캔이 `tablesS3Key` 로 lazy fetch. 추출 입력
  `parsedJson` 은 그대로 DB 에서 읽으므로 추출 동작 무변경.
- **기존분 마이그레이션**: `TablesOffloadScheduler`(`@Cron('*/10 * * * *')`, **주말만 드레인**·DAR-503) →
  `TablesOffloadDrainService.drainOnce()`. `parseStatus=DONE` + `tables` 보유 문서를 rcpNo 오름차순 배치
  (기본 200)로 오프로드 후 컬럼 비움. 점진·재개가능·멱등.

**가시화/수동**: `GET /pipeline/tables-offload-progress`, `POST /pipeline/tables-offload?limit=200`(멱등, 인증
필수). 디스크 회수(VACUUM)는 운영 단계(docs/deployment.md). 실측: live 200문서 byte-identical 라운드트립
200/200·gzip 4.2x. 투영: `disclosure_documents` 1772MB → 약 85MB(offload + VACUUM 후).

**AI/Risk 무관**: 순수 인프라/용량 작업. 신규 AI 호출 0, Engine5 하드룰과 무관.

### 2.9 과거 메타데이터 연속 확장 백필 (주말 매시간, DAR-396·DAR-503)

> **DAR-503(주말 스케줄링)**: 연속 백필은 DART 일일쿼터 대량 소비원이라 주중 라이브 수집과
> 경쟁했다. 이제 매시간 발화하되 실제 백필은 **주말 창에서만** 수행하고 주중 사이클은 즉시
> `WINDOW_SKIPPED`(백필 미수행) + CronRunLog `SKIPPED` 기록한다. 기존 `quotaExceeded`·라이브
> 예약분 2000 가드(§2.11)는 주말에도 그대로 적용된다. stale 임계 8일로 상향(§2.12).

**진단**: 공시 `rcpDt` 범위가 최근 1년(`20250619~20260619`)에 머물러 있다(실측: 총 247,766건, 그중
백필 241,700건, 최소 rcpDt 20250619). DART 는 과거 수년치(대략 1999~)를 제공하나, 기존 백필(DAR-129
manual / DAR-391 event)은 '1년 윈도'를 채우는 데 그쳤고 **더 과거로 연속 내려가는 자동화가 없었다**.
list/document 공유 일일 쿼터(20,000건)가 자주 소진되어 일회성 스크립트로는 멈추기 쉬웠다.

**해법**: `ContinuousBackfillScheduler`(`@Cron('0 * * * *')`, 매시간 발화·**주말만 백필**·DAR-503) →
`ContinuousBackfillDrainService.drainOnce()`. 현재 프런티어(가장 과거 완주 스캔 지점) 직전부터
**월(30일) 단위 청크로 과거로 내려가며** 수집한다.

```
프런티어 = min( status='SUCCESS' 인 BACKFILL_EXTEND 수집로그의 최소 bgnDe,
                전체 공시 최소 rcpDt )   // 둘 중 더 과거(작은 값)
윈도 endDe = 프런티어 하루 전,  윈도 bgnDe = max(하한 19990101, endDe − 29일)
→ getAllDisclosuresWithMeta(쿼터 인지) → dedup createMany(isBackfill=true) → enqueueParsing(#344 체이닝)
→ DisclosureCollectionLog(triggeredBy='BACKFILL_EXTEND') 기록
```

- **쿼터 인지**: `DartApiService.getAllDisclosuresWithMeta` 가 list 응답 `020`(일일한도)·`021`(회사수) 을
  감지하면 `quotaExceeded=true` — 그 윈도를 **PARTIAL** 로 남기고(프런티어 미advance) 드레인을 멈춘다.
  **throw 금지**. 다음 정각 사이클(자정 리셋 후)이 그 윈도를 처음부터 재시도 → 완주하면 SUCCESS 가 되어
  비로소 프런티어가 내려간다(문서 드레인 #344 와 동일 정신).
- **멱등·재개**: rcpNo dedup(createMany skipDuplicates) — 중단 후 재실행 = 재개. **완주(SUCCESS)한 윈도만
  프런티어를 내린다** → 쿼터로 절단된 윈도는 재시도되어 갭이 생기지 않는다. 빈 윈도(0건이지만 완주)도
  SUCCESS 로 기록되어 프런티어가 계속 내려가다 하한(19990101)에서 `reachedEarliest` 로 종료된다.
- **체이닝**: 신규 저장분은 문서 드레인(#344)+거래대상 우선 fetch→이벤트 추출(2.5)→신호·백테스트로 흐른다.
- **격리**: `isBackfill=true` — 라이브 신호·푸시 알림 불간섭(DAR-129). 과거 공시 푸시 폭탄 방지(알림 미발송).
- **진행 가시성**: `GET /scheduler/backfill-coverage`(최소·최대 rcpDt·총건수·프런티어·하한 도달).
  수동 드레인 `POST /scheduler/backfill-extend`(maxChunks, 인증 필수).

**대용량 주의**: 과거 다년치 수집 시 `disclosure_documents` 가 폭증한다 → 문서 본문 S3 오프로드(§2.7 DAR-395)
및 파싱 표 오프로드(§2.8 DAR-399)로 흡수. **메타 수집(본 경로)은 경량(list API)이라 우선 진행 가능**하다.

### 2.10 전략 변형 다중 트랙 갱신 (매일 05:00, DAR-404)

**배경**: 단일 모의매매(라이브 1년 리플레이, DAR-385)를 진입/청산/사이징 룰이 다른 **전략 변형 4종**
(`event-edge`/`short-momentum`/`conservative-value`/`aggressive-diversified`)으로 분기해 각각
point-in-time 백테스트 트랙을 쌓는다. 과거 공시 신호·일봉이 누적될수록 더 깊은 표본을 반영하도록
매일 새벽 트랙을 재산출한다.

```typescript
@Cron('0 5 * * *', { timeZone: KST })  // 매일 05:00 (off-hours)
async refreshDaily() { /* StrategyTrackService.refreshAll() */ }
```

- **멱등**: 전략별 직전 run 은 새 run 성공 후 정리(최신 1개 유지). `BacktestRun.strategyKey` 그룹핑.
- **부분 성공**: 한 전략 실패해도 나머지는 계속(throw 금지 — cron 유지, recorder FAILED 기록).
- **point-in-time 불가침**: 실행은 BacktestReplayService(다음 거래일 시가 진입·asOf 절단)에 위임 — 미래정보 0.
- **신선도**: cron-health `strategy.track-refresh`(48h 임계). 비교/거래내역 엔드포인트는 항상 최신 완료 트랙을 읽는다.

### 2.11 DART 라이브 쿼터 예약분 가드 (횡단 가드, DAR-445)

**진단(prod 실측)**: DART 무료키는 **일일 20,000콜 하드 쿼터**를 list/문서 fetch 가 공유한다.
문서 파싱 드레인(벌크)이 쿼터를 먼저 소진하면 **라이브 목록수집(오늘치 공시)이 굶어** 공시가
며칠씩 정체됐다(2026-06 공시 6/19 정체의 근본 원인). 크론이 아니라 `DartApiService` 의 모든
DART 호출에 적용되는 **횡단 일일 콜 예산 가드**로 수정했다.

```typescript
// engine1-disclosure/dart-api/dart-api.service.ts
const DART_DAILY_BUDGET = 19_000;       // 무료키 한도(20,000) 아래 보수 상한(시계 오차·키 공유 마진)
const DART_LIVE_RESERVE = 2_000;        // ★라이브 목록수집 전용 예약분 — 아무도 침범 못 함
const DART_LIVE_PARSE_RESERVE = 3_000;  // ★라이브(비백필) 문서 fetch 전용 예약분(2026-07 신설)
const DART_LIVE_PARSE_CEILING = DART_DAILY_BUDGET - DART_LIVE_RESERVE;             // = 17,000
const DART_BULK_CEILING = DART_LIVE_PARSE_CEILING - DART_LIVE_PARSE_RESERVE;       // = 14,000
```

- **라이브 통과**: 라이브 목록수집(`bulk=false`, 10분 카덴스 ≈ 1,200콜/일)은 누적이 예약분 구간에
  닿아도 **차단 없이 실제 호출**된다 — 오늘치 공시 수집이 항상 최우선.
- **벌크 사전 차단(쿼터 비소모)**: 누적 콜이 `BULK_CEILING` 도달 시 —
  벌크 list(`getAllDisclosuresWithMeta`)는 HTTP 없이 **합성 `020`**(quotaExceeded=true)으로 종료,
  문서 fetch(`downloadDocument`)는 `DartQuotaReservedError` throw(QUOTA 로 분류 — `retryCount`
  비소모 → 멀쩡한 문서가 영구 SKIPPED 되지 않음).
- **라이브 문서 fetch 예약분(2026-07 라이브 파싱 기아 후속)**: `downloadDocument(rcpNo, { priority })` —
  비백필 공시는 `priority: 'live'` 로 `LIVE_PARSE_CEILING`(17,000)까지 허용, 백필은 `'bulk'`(14,000).
  야간 벌크가 벌크 상한을 소진해도 당일 라이브 공시 파싱은 예약분 3,000으로 계속 진행된다.
  (DAR-445 가 목록수집만 보호하고 문서 fetch 를 전부 벌크로 분류했던 구조적 공백의 해소.)
- **리셋**: 콜 카운터는 KST 자정 리셋. 실제 `020` 관측 시 `quotaExhaustedDay` 하드스톱 백스톱(라이브 문서 fetch 포함 — 실쿼터 소진은 예약분으로도 못 살림; 라이브 목록수집만 계속 시도).
- 기존 적응형 백오프(DAR-392)·PARTIAL 재시도(§2.9)와 결합 — 자정 리셋 후 벌크 드레인 자동 재개.

### 2.12 헤비 수집·스캔 잡 주말 스케줄링 (DAR-503)

**배경(사용자 지시 2026-07-05 + 프로드 풀 고갈 실측)**: 사용자 지시 = "수집(헤비 작업)은 주말에 진행 —
실시간 정보에 API 를 쓰지 않아도 되는 날". 7/4~5 프로드에서 engine1 대형 스캔(§2.7·2.8 오프로드 LEFT
JOIN, 건당 50~75초)이 DB 커넥션 풀을 독점해 health 503 플래핑이 발생했고(connection_limit=6 상향으로
1차 완화), DART 일일쿼터도 주중 라이브 수집과 백필(§2.9)이 경쟁 중이었다.

**공용 게이트**: `engine1-disclosure/common/heavy-collection-window.ts` 의 순수 함수
`isHeavyCollectionWindow(now, mode?)`. 기본 정책 = **주말(토·일 KST) 전일 true, 주중 false**.
env `HEAVY_COLLECTION_WINDOW` 로 오버라이드: `weekend`(기본) | `always`(개발·수동 드레인) |
`weekend+night`(주말 + 주중 심야 00:00~06:30 KST, 향후 옵트인). M10 클록 무접점 — 수집층 스케줄링만
게이트하며 매매·신호 생성 로직은 무변경(신호는 기수집 데이터 기반으로 주중 정상 동작).

| 잡 | 크론(발화) | DAR-503 적용 | 주중 거동 | stale 임계 |
|---|---|---|---|---|
| 연속 백필(§2.9) | `0 * * * *` | 주말 전용 | `WINDOW_SKIPPED`+`recordSkip` | 8일(상향) |
| tables 오프로드(§2.8) | `*/10 * * * *` | 주말 전용 | `WINDOW_SKIPPED`+`recordSkip` | 8일(상향) |
| rawText 오프로드(§2.7) | `*/10 * * * *` | 주말 전용 | `WINDOW_SKIPPED`+`recordSkip` | 8일(상향) |
| 파이프라인 드레인 | `* * * * *` | **이원화**(정지 아님) | 최근 7일 경량 세이프티넷 | 45분(무변경) |
| 이벤트 백필(§2.5) | `0 3 * * *` | **주말 전용**(2026-07 라이브 파싱 기아 후속) | `WINDOW_SKIPPED`+`recordSkip` | 8일(상향) |
| 내부자·재무 | 야간 | 무변경(이미 야간) | 정상 | — |

- **파이프라인 드레인 이원화**(`PipelineDrainScheduler`): 정지시키지 않는다 — 라이브 신규 공시의 BullMQ
  체이닝 실패(DQ-1) 복구 세이프티넷이기 때문. 주중엔 `drainOnce` 에 조회 범위 `{ sinceCreatedAt: now−7일 }`
  를 넘겨 **최근 7일 공시만** 드레인(2026-07 상향: 쿼터 기아 등 수일 장애 시 미파싱 라이브가 주말까지 방치되지 않게)(과거 백필 24만+ 건의 무차별 fetch·대형 스캔 배제 → 풀·쿼터 경쟁 회피).
  주말엔 범위 무제한(전체 드레인)으로 백필 적체를 소진한다. 두 경로 모두 매 사이클 RAN(SUCCESS 기록)이라
  freshness 신선도가 유지되어 임계 무변경.
- **cron-health 정합**: 주말 전용 잡은 주중 내내 `SKIPPED`(freshness `lastSuccessAt` 미갱신)라 주말→다음
  주말 공백(일요일 성공 → 다음 토요일 ≈ 6일)을 흡수하도록 stale 임계를 8일(11,520분)로 상향(오탐 방지).
  주중 무발화가 stale 오탐이 되지 않고, 주말 가동 자체가 멈춰야만 `DataFreshnessMonitorScheduler`(P02)가
  OPS_ALERT 로 표면화한다. `recordSkip` 은 크론이 '살아 있으나 정책상 스킵함'을 CronRunLog 에 남긴다.
- **무변경(라이브 수집)**: 라이브 목록수집(`*/10 8-17 * * 1-5`·`0 6-7,18-22 * * 1-5`)·시세 수집(engine3)·
  트레이딩 사이클 전부 주중 실시간 유지. 내부자(03:30)·재무(새벽)는 이미 야간이라 무변경(단 벌크 분류라 14,000 상한 적용). 이벤트 백필(§2.5)은 2026-07 라이브 파싱 기아 후속으로 **주말 전용** 전환.
- **경량 잡 유지(판단 근거)**: `ParseRetryScheduler`(30분, `runRetryQueue(20)` — FETCH/PARSE_FAILED 재처리
  ≤20건·인덱스 조회)와 `FailedEventRecoveryScheduler`(매시간, `reprocessForNewExtractors(200)` — **DART 호출
  0**·보유 parsedJson 재사용·상태 인덱스 조회)는 저장 문서 기반의 경량·바운드 라이브 세이프티넷이라 가드
  미적용(주중 정상 유지). 대형 스캔·대량 쿼터 소비가 아니므로 풀 고갈과 무관.

### 2.13 격주 트랙 성과 순위 리포트 (격주 일요일 10:00 KST)

모의투자 **전 트랙의 트레일링 14일(캘린더, KST) 실현 성과**를 집계·순위화하고 시장국면
(market-regime Rule 재사용)을 태깅해 "지금 장에 맞는 트랙" 판단 데이터를 OPS_ALERT 로 발송한다.
일일 운영 리포트(§31.4 API 명세)가 '어제 하루' 운영 관점이라면 이 리포트는 '최근 2주' 트랙 간
상대 성과 관점. ★read-only 관측·알림 전용 — 매매/주문/Kill Switch 무접점(M10 클록 보호)·AI 개입 0.

```
BiweeklyTrackReviewScheduler.runWeekly()   @Cron('0 10 * * 0', KST)  ← 매주 일요일 발화
  └─ 격주 게이트 isReviewSunday(ymd) — 순수 함수·결정론: 고정 앵커('20260712' 일요일)로부터
     일수 차/7 이 짝수인 일요일만 실행. 오프 주는 recordSkip(SKIPPED) 기록 후 무발송.
     └─ BiweeklyTrackReviewService.buildReview(now) — 트레일링 14일(생성일 KST 포함) 윈도
        · Position 기반 트랙: 시스템 모의 + 철학 4종 + 전략 forward N종 — 모의운용 포트폴리오
          이름 규약으로 동적 수집, CLOSED Position(closedAt∈윈도)의 고정 실현손익 합산
        · 분봉 단타: IntradayScalpTrade(CLOSED·exitTs∈윈도) / 듀얼모멘텀 코어:
          DualMomentumForwardTrade(CLOSED·exitDate∈윈도)
        · 트랙별 지표: 청산 건수·승률·실현손익 합·수익률(각 트랙 원금 상수 분모)·평균 보유·
          lowSample(청산<5 정직 표기 — 순위에는 포함)
        · 시장국면: MarketRegimeService(DAR-130) 현재 레짐 태깅(실패 시 null graceful)
  → NotificationProducer.enqueueOpsAlert('INFO', 'biweekly-track-review', body)
     멱등키 biweekly-track-review:<앵커기준 회차> (회차당 1건) · deepLink=/portfolio · 이모지 미사용
  → CronRunRecorder(jobKey=ops.biweekly-track-review) 기록 + FRESHNESS_JOB_SPECS 등록
     (격주 카덴스 — stale 임계 17일: 14일 + 3일 지연 흡수. 오프 주 SKIPPED 는 성공 미갱신이 정상)
```

- **온디맨드 조회**: `GET /ops/track-review`(JWT) — 발송 주기와 무관하게 현재 시점 기준 즉시 계산
  (영속 모델 없음·스키마 변경 0). API 명세 §31.5.
- **PaperTrade.styleTag 대신 Position→포트폴리오 귀속인 이유**: 시스템 모의 청산(SELL)은
  styleTag=null 로 기록되고, 장중 모니터의 공용 executeSell 이 철학/전략 포트폴리오 청산에도
  태그를 남기지 않아 태그 기반 귀속이 체계적으로 오귀속된다. CLOSED Position 의 unrealizedPnl 은
  청산 시점 고정 실현 순손익(일일 리포트·RiskGuard 월간손실 산정과 동일 SSOT 관점).

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

### 5.1 EOD 일봉 캐치업 수집 (평일 18:30 + 재시도 21:00, DAR-375·DAR-438)

```
@Cron('30 18 * * 1-5')  KrxMarketDataScheduler.collectDailyPrices()
  └─ CronRunRecorder.record(DAILY_PRICE_COLLECT='market.daily-collect')  // ★DAR-428 헬스 래핑
       → catchUpDailyPrices()
            ├─ target = resolveLatestAvailableTradeDate()  // ★KRX 프로브로 실제 최신 가용일 산출
            ├─ lastLoaded = StockDailyPrice 최신 tradeDate
            ├─ dates = (lastLoaded, target] 평일 갭 전체  // 단일일이 아니라 누락분 전부
            ├─ MarketDataCollectionLog(RUNNING) 기록
            └─ for each basDd in dates:
                 collectDailyPricesBulkForDate(basDd)  // createMany skipDuplicates(멱등)
                   └─ KRX fetchStockDaily/fetchKosqdaqDaily → rowsFetched=0 면 휴장일 스킵(emptyDates)
               → MarketDataCollectionLog(SUCCESS, savedCount)
       → CronRunLog(market.daily-collect, SUCCESS, itemCount=totalSaved)  // 락 조기반환만 SKIPPED
```

> **DAR-428 — EOD 일봉 크론이 조용히 멈춘 정체를 안전망에 표면화.** 일봉 전진수집 cron 은
> DAR-8 이래 존재하나(`@Cron 30 18`), 그 헬스는 `MarketDataCollectionLog`(= '무엇을 적재했나')
> 에만 남고 `CronRunLog`(= '크론이 살아 돌았나')엔 없어, 분봉(`market.minute-collect`)과 달리
> cron-health 의 CronRunLog 기반 잡 목록에 부재했다. 그 결과 EOD 일봉 cron 이 가동을 멈춰
> **일봉이 6/18 에 정체**(분봉/단타는 KIS 로 6/23 진행)돼도 표면 신호가 약했다. 처방: `collectDailyPrices`
> 를 `CronRunRecorder(DAILY_PRICE_COLLECT='market.daily-collect')` 로 감싸 분봉과 대칭으로
> cron 실행 헬스를 남기고, `FRESHNESS_JOB_SPECS` 에 동일 키(EOD·72h 임계)를 추가해 가동 중단을
> stale 로 표면화한다. 캐치업 본문·MarketDataCollectionLog 는 무변경(이중 기록 = 데이터 신선도 +
> cron 생존 분리 관측). 실측(2026-06-23 라이브): before daily_max=6/18 → catchUp filled=[6/19,6/22]
> saved=5065 → after daily_max=**6/22**(최신 완료 거래일·6/23 미게시는 제외) → CronRunLog
> market.daily-collect SUCCESS itemCount=5065.

> **DAR-375 근본 버그 — 최신일이 6/5 에 영원히 정체.** 과거 `resolveLatestAvailableTradeDate`
> 는 "최신 가용일"을 **StockDailyPrice 최신 tradeDate**(= 마지막으로 적재한 날)로 해석했다.
> 저장소가 6/5 에 멈추면 resolver 가 영영 6/5 만 반환 → 크론이 매번 6/5 만 재수집 → KRX 에
> 6/8~6/18 데이터가 존재함에도 전진 못 하는 self-fulfilling stale 이 발생했다. 정정: ①resolver
> 가 **KRX 를 직접 프로빙**(today 부터 과거로 지수 응답이 존재하는 첫 평일 = 실제 최신 가용일)해
> 저장소 정체와 무관하게 전진, ②크론이 단일일이 아니라 `lastLoaded~target` **갭 전체를 멱등 백필**.
> 실측(2026-06-19 라이브 KRX): 6/19=미게시, **6/18=가용(KOSPI close 9063.84)** → 프로브가 6/18 채택.

> **DAR-438 — KRX EOD 지연 게시 대비 당일 재시도 슬롯 추가.** KRX 는 EOD(종가) 일봉·지수를
> 장 마감(15:30) 후 **지연 게시**하며 18:30/18:45 엔 미게시가 잦다. 그 경우 프로브 `target` 이
> 직전 거래일에 머물러 캐치업이 `lastLoaded ≥ target` 으로 **noop(갭 0)** 되고, 당일분은 다음 평일
> 18:30/18:45 까지(금요일분은 주말 건너 약 사흘) 스킵된다 — `1830 단일 발화`의 구조적 한계(갭 채움
> 로직 자체는 정상). 처방: **평일 21:00(일봉)·21:05(지수) 재시도 슬롯**(`@Cron('0 21 …')`/`@Cron('5 21 …')`,
> `retryCollectDailyPrices`/`retryCollectMarketIndices`)을 추가해 게시 완료된 저녁에 **동일 멱등 캐치업을
> 재호출**한다. 그새 KRX 가 게시했으면 `target` 이 당일로 전진해 같은 날 자가복구되고, 이미 적재됐으면
> `skipDuplicates`/upsert 로 무해(0건). 일봉 재시도는 18:30 정시와 **동일 경로**(`runDailyCollectWithHealth`
> = CronRunLog `market.daily-collect` 헬스 래핑 SSOT)를 공유하고, 지수 재시도가 직후라 spine(일봉↔지수)이
> 같은 날 함께 전진한다. 캐치업 본문·신선도 임계(72h)·도메인 로그 무변경(카덴스만 보강). 결정론 검증:
> 프로브 2단계 mock(18:30→직전일 noop → 21:00→당일 fill)으로 같은 날 적재 증명(일봉·지수 양쪽).

### 5.2 시장지수 캐치업 수집 (평일 18:45 + 재시도 21:05, DAR-375·DAR-438)

```
KrxMarketDataScheduler.collectMarketIndices() → catchUpMarketIndices()
  ├─ target = resolveLatestAvailableTradeDate()  // KRX 프로브 최신 가용일
  ├─ lastLoaded = MarketIndex 최신 tradeDate (지수 독립 spine)
  ├─ dates = (lastLoaded, target] 평일 갭 전체
  └─ for each basDd in dates:
       collectMarketIndicesForDate(basDd)
         └─ for KOSPI, KOSDAQ: fetchIndexDaily(indexType, basDd)
              └─ 종합지수(IDX_NM=='코스피'/'코스닥') 행 1건만 선별 (DAR-367)
            연속성 sanity 가드: 직전 거래일 종가 대비 |Δ| > 20% → 격리+WARN (DAR-367)
            MarketIndex.upsert(indexCode, tradeDate)  // 가드 통과분만
```

> 단일일 수집(`collectMarketIndicesForDate`)·단일일 일봉(`collectDailyPricesForDate`)은 수동
> 트리거·`collectAll` EOD 배치용으로 그대로 유지된다. 크론만 갭 캐치업으로 전환했다.

> **DAR-367 데이터 정합 가드.** `kospi_dd_trd`/`kosdaq_dd_trd` 는 종합지수 외에 KOSPI 200·
> 업종지수 등 수십 개 시리즈를 함께 반환한다. 이전 구현은 모든 행을 동일 indexCode('0001')로
> 적재해 `@@unique([indexCode,tradeDate])` upsert 에서 마지막 행(업종지수 등)이 종합지수를
> 덮어썼고, 일자별로 3132/8639 같은 오염값이 저장돼 홈 배지에 `-63.75%` 가 노출됐다.
> 정정: ① 파서가 종합지수 행만 선별, ② 적재 단계 연속성 가드(±20% 초과 격리),
> ③ 표시 단계(`fetchLatestIndices`)도 등락률이 임계를 넘으면 등락 필드를 숨기고 `suspect=true`
> 로 표기해 사용자에게 불가능한 수치를 노출하지 않는다.

### 5.3 종목상태 수집 (평일 08:50, 장 시작 전)

```
KrxMarketDataScheduler.collectStockStatusesForDate()
  └─ KrxApiService.fetchStockStatus(basDd)
       └─ GET /sto/isu_mrktact_info
            (거래정지=11, 관리=12, 투자주의=21, 이상급등=31)
     StockStatus.upsert(stockCode) — 거래정지/관리/투자주의/이상급등 플래그
```

### 5.3a 시장분류 동기화 (월요일 08:40, DAR-328)

```
KrxMarketDataScheduler.syncCompanyMarkets()
  └─ KrxApiService.fetchStkIsuBaseInfo + fetchKsqIsuBaseInfo (KOSPI/KOSDAQ 기준정보)
     Company.update(market: KOSPI|KOSDAQ) — 멱등(이미 정확하면 스킵), KONEX·미상 제외
```

- 배경: `company.market` 이 일반값(`'LISTED'`)·null 이면 EventStudy 가 시장지수(0001/1001)에
  매핑하지 못해 관측 0건(`noStockOrMarket`) → 공시↔주가 상관분석 차단. KRX 기준정보의
  시장구분을 정본으로 백필해 해소한다(AI 미개입 순수 데이터 정합).
- 주 1회 Cron + `collectAll()` EOD 배치에 포함(forward 매퍼). 수동: `POST /market-data/sync-company-markets?basDd=YYYYMMDD`.

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
POST /market-data/collect/catch-up
  → catchUpDailyPrices() + catchUpMarketIndices() — 마지막 적재일~최신 가용일 갭 멱등 백필 (DAR-375)
     (최신 가용일을 KRX 프로브로 산출 → 저장소 정체 시에도 전진. basDd 불필요)
POST /market-data/collect/all?basDd=YYYYMMDD
  → collectAll() — 일봉+지수+종목상태+시장분류 병렬 + MarketDataCollectionLog 기록
POST /market-data/sync-company-markets?basDd=YYYYMMDD
  → syncCompanyMarkets() — company.market 을 KOSPI/KOSDAQ 로 백필(멱등, DAR-328)
GET  /market-data/collection-logs?tradeDate=YYYYMMDD
  → MarketDataCollectionLog 조회 (최근 20건)
```

### 5.6 히스토리컬 백필 (DAR-50)

데이터 최대수집 — 과거 N거래일 일봉 + 기술지표 적재로 chart 점수·entryReady 해금 → 모의매수 작동.

```
POST /market-data/backfill/daily?days=60&endDate=YYYYMMDD
  → backfillDailyPrices() — endDate부터 과거 N거래일 일봉을 StockDailyPrice에 멱등 적재
     (주말 스킵·휴장일 0행 자동 스킵·createMany skipDuplicates·날짜간 delay·DAR-376 OHLC 품질 가드)
POST /indicators/backfill?mode=latest|all
  → IndicatorBackfillService.backfill() — DB 일봉 → 순수함수 지표 계산 → technical_indicators 멱등 upsert
     (latest=종목별 최신 거래일 / all=보유 전 거래일)
     ※ 일일 증분(mode=latest)은 §5.13 크론(IndicatorDailyScheduler@18:50/21:10)이 상시 담당 —
       수동 경로는 과거 전체(all) 백필·긴급 복구용.
POST /signals/regenerate
  → 기존 trading_signals 재채점(upsert) — TI 백필 후 chart/entryReady 반영, 파생 신호만 갱신
```

수동 스크립트(관리자):
```
npx ts-node -r dotenv/config src/engine3-quant-market/market-data/backfill-history.manual.ts [days] [endDate]
npx ts-node -r dotenv/config src/engine3-quant-market/indicators/indicator-backfill.manual.ts [latest|all]
```

### 5.7 분봉 forward 축적 수집 (평일 09:00~15:30 / 10분, DAR-377)

장중 가격반응(분봉)을 공시 이벤트와 매칭해 인과근거를 축적하기 위한 분봉 저장 인프라.

```
@Cron('*/10 9-15 * * 1-5')  StockMinutePriceCollector.collectMinutePricesCron (KST)
  └─ isKstRegularMarketHours 게이트(09:00~15:30 정밀) + KIS 키 설정 + 단일 실행 락
     └─ resolveUniverse: 보유(OPEN)→신호(entryReady)→관심(watchlist)→거래량 상위, 중복제거
        └─ cap(KIS_MINUTE_COLLECT_CAP, 기본 100)까지 slice — 초과분은 skippedByQuota 정직 로그
           └─ KisApiService.fetchMinuteCandlesFullDay (당일 전 구간 페이지네이션, 페이지간 스로틀)
              └─ StockMinutePrice.createMany(skipDuplicates) — (stockCode,tradeDate,time) 멱등
     CronRunRecorder(MINUTE_PRICE_COLLECT) 기록 → 신선도 안전망 노출(장중 무가동 stale)
```

- ★**forward-only(정직)**: KIS 는 '당일 분봉'만 제공 → **과거 분봉 소급 백필 불가**. 수집 시작일부터
  누적한다. 10분 간격 반복으로 장 마감 시점이면 커버 종목의 당일 세션 전체가 누적된다.
- ★**KIS 레이트리밋·일일 쿼터 엄수**: 우선순위 cap 제한 + 종목간(`stockDelayMs`)·페이지간
  (`pageDelayMs`) 스로틀 + 단일 실행 락(겹침 방지). 쿼터 초과분은 `skippedByQuota` 로 정직 보고.
- 수동 트리거: `POST /market-data/collect/minute-prices?cap=100[&tradeDate=YYYYMMDD]` → 커버리지 리포트.
- 조회: `GET /market-data/minute-candles?stockCode=...[&tradeDate=...]` — 당일 KIS 우선·저장분(과거일) 폴백.

### 5.8 과거 깊이 백필(재개) + 커버리지 리포트 (DAR-376)

EventStudy(공시→D+N 초과수익)의 backbone 인 일봉을 **과거로 깊게** 축적하고 유니버스 커버리지를
운영 가시화한다. 지속 최신화(forward)는 DAR-375 캐치업 크론이 담당하고, 여기서는 backward 깊이와
품질·완전성을 다룬다.

```
POST /market-data/backfill/deep?days=120
  → backfillDailyHistoryDeep() — '가장 오래된 적재일의 직전 일자'부터 더 과거로 N거래일 이어 수집.
     같은 명령을 반복 실행하면 KRX 제공 한도까지 점진적으로 깊어진다(재개 가능·멱등).
     MarketDataCollectionLog(RUNNING→SUCCESS/PARTIAL/FAILED) 로 진행/재개 추적.
GET  /market-data/coverage
  → getDailyCoverageReport() — universeSize·stocksWithData·missingStockCount(+sample)·
     tradeDateMin/Max·tradingDayCount·totalRows. 누락 종목·구간 점검(EventStudy 데이터 충분성).
```

수동 스크립트(관리자):
```
npx ts-node -r dotenv/config src/engine3-quant-market/market-data/backfill-history.manual.ts deep [days]
```

> **품질 가드(DAR-376).** bulk 적재 경로(`collectDailyPricesBulkForDate`)가 행 단위로 `isValidDailyOhlc`
> 를 적용 — 0/음수 가격·고가<저가·시/종가가 [저,고] 범위 밖인 손상 행을 적재 거부(skipped)해
> EventStudy backbone 오염을 차단한다. 전일대비 ±상한 시계열 이상치는 종목별 직전 종가 조회가
> 필요해 bulk 경로에 부적합하므로 향후 별도 배치로 분리한다(행 내 정합성만 여기서 검사).

### 5.9 거래일·휴장일 캘린더 SSOT (`common/time/market-calendar.ts`, DAR-481)

거래일 판정이 3곳(EventStudy D0 `d0-calculator`, 백테스트 데이터주도 `getTradingDays`, KRX 스케줄러
`isWeekend`)에 산재했던 것을 단일 모듈로 수렴. 각 호출부는 자기 의미론에 맞는 함수로 **위임**해
결과 동치(무행동 변경)를 유지하고, 2026 하반기 공휴일 누락(시한성 버그)을 보강했다.

- **판정 API**: `isTradingDay/nextTradingDay/prevTradingDay/isHoliday/isWeekend`(YYYYMMDD),
  `isWeekendDate`(Date·getDay 기반, 스케줄러 위임용).
- **반일장/지연개장**: `KRX_HALF_DAYS`(세션 override 스키마)·`isHalfDay`·`getMarketSession`.
  현재 등록: 수능일(2026-11-19, 10:00~16:30 지연개장). 정규장 hot-path 는 미참조(세션-인지 신규
  소비자용 주입 구조).
- **월말 거래일**: `lastTradingDayOfMonth(year, month, { actualTradingDays })`·`isLastTradingDayOfMonth`
  — Wave 1 P13(월말 리밸런싱 크론) 전제. 실재 일봉을 넘기면 데이터 주도로 확정(캘린더 불완전 오발화 방지).
- **★연 1회 갱신(시한성)**: KRX 는 매년 말 익년도 공식 휴장일을 공시(KIND). 매년 11~12월에 공식
  휴장일 + 대체공휴일 + 근로자의날(5/1) + 연말 최종휴장일(12/31) + 수능일을 `market-calendar.ts`
  상단 절차대로 추가. 과거연도(2024·2025) 목록은 D0 이력 재현성 위해 동결(소급 수정 금지).

### 5.10 장 시작 전 종합 프리플라이트 (평일 08:30, DAR-487, 견고화 W3·P26)

기존 장 시작 전 잡은 데이터 준비 성격(5.3 종목상태 08:50 · 5.3a 시장분류 08:40)만 있었고,
토큰·휴장일·전일 일봉 정합·리스크 상태를 한 번에 묶는 종합 프리플라이트가 없었다(갭 E6). 이 잡은
데이터 준비 잡보다 앞선 08:30 에 네 항목을 일괄 점검한다. **점검 전용 — 매매 로직·판정 무변경**
(M10 클록 보호). 각 점검은 try/catch 로 격리돼 한 점검 실패가 다른 점검·잡을 깨지 않는다.

```
PreMarketPreflightScheduler.runPreflight()   @Cron('30 8 * * 1-5', KST)  ← 평일만, 주말 미발화
  └─ PreMarketPreflightService.buildReport(now)
       1) 휴장일/반일장 판정 — market-calendar(isTradingDay/isHalfDay/getMarketSession, DAR-481 재사용)
            └─ 휴장(평일 공휴일)이면 이후 점검 스킵 + 정상 로그 → CronRunLog SKIPPED(살아있음 유지)
       2) KIS 토큰 사전 워밍 — KisApiService.getAccessToken(nowMs)
            └─ 유효 캐시 있으면 재발급 없이 반환(발급 제한 존중) · 미설정이면 SKIPPED(dev graceful)
       3) 전일 일봉 정합 — 최근 tradeDate 행을 daily-price-sanity.isValidDailyOhlc 로 검사(DAR-376 재사용)
            └─ 손상 행 수 + 신선도(최근 일봉 < 예상 직전 거래일 = EOD 정체 의심). 데이터 없으면 SKIPPED
       4) 킬스위치·리스크 게이트 — AutoTradingStatusService.getStatus() read-only 재사용(DAR-361)
            └─ 발동/차단 중이면 RISK 소견(장을 차단 상태로 시작함을 상기)
  → 이상 발견 시에만 즉시 알림(P02 채널): RISK 소견=enqueueRiskAlert · OPS 소견=enqueueOpsAlert
     정상이면 무발송(로그만). 멱등키 preflight-(risk|ops):<KST거래일> 로 하루 최대 각 1건.
  → CronRunRecorder(jobKey=ops.pre-market-preflight) 기록 + FRESHNESS_JOB_SPECS 등록(평일 08:30·72h)
```

- **발송 라우팅**: RISK(킬스위치·게이트) vs OPS(토큰·데이터)를 분리 발송. 각 채널 다건은 한 알림으로 묶음.
- **M10 안전**: 실주문/체결/Exit 판정 무직결. 토큰 워밍은 인증 조작(발급)일 뿐 매매 행동 무변경.
- **engine4 exit-check 인터페이스 정리(택1-b)**: 과거 M8 `IExitCheckScheduler`(09:00/13:00/16:30
  `runPreMarketCheck` 등)는 크론 미배선 사(死)어댑터였고, 실제 Exit 평가는 라이브 스케줄러(모의운용
  일일 사이클·장중 손절 모니터·분봉 단타)가 담당한다. 프리플라이트는 **점검 전용**이라 포지션 Exit
  평가(`checkAllPositions`)를 호출하면 M10 위반이므로 그 인터페이스를 재사용하지 않는다. 혼동을 없애기
  위해 `exit-check-scheduler.interface.ts`·`in-memory-exit-check-scheduler.ts`(자기참조 외 미사용)를
  삭제했다. Exit 평가 도메인(`ExitEngineService.checkAllPositions`)과 6절 흐름은 유지된다.

### 5.11 ETF 일봉 증분 수집 (평일 19:10 EOD, DAR-484 [견고화 W1·P10])

Wave1 신규 2트랙(월단위 듀얼모멘텀 P12/P13 · 변동성 돌파 P14/P15)이 소비할 ETF 일봉을 장마감 후
증분 적재한다. 기존 KRX 일봉 크론(18:30/21:00)·지수(18:45/21:05)와 **시간대 분리**(19:10).

```
@Cron('10 19 * * 1-5')  EtfDailyPriceCollector.collectEtfDailyPricesCron (KST)
  └─ 단일 실행 락 + CronRunRecorder(ETF_DAILY_COLLECT='market.etf-daily-collect') 헬스 래핑
     └─ source(KisEtfDailySource).isAvailable() 게이트 — KIS 키 미설정이면 graceful no-op(적재 0)
        └─ 유니버스(etf-universe.ts) 4~5종 순회 (etfDelayMs 스로틀)
           └─ KisApiService.fetchDailyPrices(code, [오늘−N일, 오늘], 'D')  // 기간별시세, ETF 공용
              └─ isValidDailyOhlc 행 단위 정합성 검사(손상행 배제)
                 └─ EtfDailyPrice.createMany(skipDuplicates) — (etfCode,tradeDate) 멱등, source='KIS'
     → CronRunLog(market.etf-daily-collect, SUCCESS, itemCount=rowsSaved)  // 락 조기반환만 SKIPPED
```

- ★**소스 어댑터 분리(2026-07-03 실검증)**: 1차 = **KIS 기간별시세**(`KisEtfDailySource`). KRX
  `/etp/etf_bydd_trd` 는 HTTP 401(현재 키 ETF 상품 미구독 — 주식 일봉 `/sto/stk_bydd_trd` 는 200
  정상)이라 `KrxEtpDailySource` 는 **인터페이스만·미구현**(구독 승인 시 소스 전환·폴백 체인 구성).
  적재 행의 `source` 컬럼이 어느 어댑터가 넣었는지 기록(KIS | KRX_ETP) — 소스 전환을 관측 가능하게.
- ★**유니버스(무레버리지)**: 공격A `360750 TIGER 미국S&P500` · 공격B `069500 KODEX 200` · 방어
  `273130 KODEX 종합채권(AA-이상)액티브` · 현금성 `153130 KODEX 단기채권`. 레버리지·인버스 금지.
  채권·단기채는 최상위 유동성 종목으로 1차 확정하고 대안을 병기 — '일평균 거래대금 최상위' 라이브
  재확인은 Wave 완료 후 가동 시점 게이트(수동 러너 `etf-universe-liquidity.manual.ts`). 상위 변동 시 교체.
- ★**증분·멱등**: 유량 부담 극소(일 4~5콜). 최근 N일(env `ETF_DAILY_LOOKBACK_DAYS`, 기본 10 —
  주말·연휴 흡수) 구간을 받아 `createMany skipDuplicates` 로 누락일만 삽입 → 재실행·짧은 정체 자가복구.
- ★**결측 감지**: 크론 헬스는 `FRESHNESS_JOB_SPECS`(`market.etf-daily-collect`, ALWAYS·72h)로 감시.
  stale 전환 시 `DataFreshnessMonitorScheduler`(P02)가 OPS_ALERT 발송(별도 배선 불요 — SSOT 경유).
- 백필(3년+)은 **P11(DAR-490)** 이 담당. 이 트랙은 모델+어댑터+일일 증분까지(데이터층 전용·매매 무접점).

### 5.12 ETF 과거 일봉 백필 (DAR-490 [견고화 W1·P11])

백테스트(P16) 검증에 3년+, 듀얼모멘텀 모멘텀 계산(P12)에 최소 13개월 이력이 필요해 P11 에서 과거 일봉을 소급 적재한다.

**아키텍처:**
- **서비스**: `EtfDailyBackfillService` — KIS 기간별시세(FHKST03010100)를 날짜 구간 페이지네이션으로 반복 호출. 창(window)당 달력일 100일(≈거래일 70행), 종목당 최대 40창. 연속 빈 창 2회에 조기종료(상장 이전 도달 감지).
- **S3 원본 보관**: 창별 KIS 원본 응답을 `EtfDailyRawStoreService` 로 gzip 콜드 보관. 키: `etf-daily-raw/{etfCode}/{startYmd}-{endYmd}.json.gz` (결정적·멱등 덮어쓰기). 보관 실패는 best-effort — DB 적재 차단 안 함.
- **멱등 적재**: `isValidDailyOhlc` 손상행 배제 후 `EtfDailyPrice.createMany(skipDuplicates)`. `(etfCode,tradeDate)` 유니크 재실행 안전.
- **상시 크론 아님**: 일일 증분은 P10 크론(`EtfDailyPriceCollector@19:10`)이 담당. 백필은 수동 단발 실행 전용.

**실행 방법 (택 1):**

```bash
# 1) JWT API (HTTP — 백엔드 기동 상태, 인증 필요)
POST /market-data/backfill/etf-daily?minStartYmd=20100101
GET  /market-data/backfill/etf-daily/coverage   # 적재 없이 커버리지만 조회

# 2) 수동 러너 (ts-node — DB 직접, .env 주입)
cd backend
npx ts-node -r dotenv/config \
  src/engine3-quant-market/market-data/etf-daily-backfill.manual.ts \
  [minStartYmd] [endYmd]
# 예: ... 20200101              → 2020-01-01 하한부터 오늘까지 가능한 최장
# 예: ... 20200101 20260630     → 2020-01-01 ~ 2026-06-30
# 예: report                    → 적재 없이 커버리지 리포트만 출력
```

**커버리지 리포트 항목:**
- `rowCount` / `startDate` / `endDate` — DB 현재 상태
- `expectedTradingDays` — [startDate,endDate] 추정 거래일수(상한 추정)
- `missingVsExpected` — 누락 의심 수(0 = 홀 없음 추정)
- `suspiciousGaps` — 달력일 7일+ 인접 간격(구조적 홀 탐지)
- `note` — 상장 이전 구간 부재 정직 고지. 예: TIGER 미국S&P500(360750)은 2020-08 상장이라 그 이전 일봉 부재는 정상.

**콜 수(KIS 레이트리밋):** ETF당 최대 40창 × 200ms 스로틀 → 4종 총 최대 160콜, 실제 상장일 조기종료로 훨씬 적음(~12콜/종목 예상).

### 5.13 일일 기술지표 계산 (평일 18:50 + 재시도 21:10)

```
@Cron('50 18 * * 1-5')  IndicatorDailyScheduler.calculateDailyIndicators()        (KST)
@Cron('10 21 * * 1-5')  IndicatorDailyScheduler.retryCalculateDailyIndicators()   (KST)
  └─ 두 슬롯 동일 경로(SSOT runDailyIndicatorsWithHealth) — 겹침 가드(락) + throw 금지(cron 유지)
     └─ CronRunRecorder.record(INDICATOR_DAILY='market.indicator-daily')  // itemCount=적재 행수
          → IndicatorBackfillService.backfill({ mode: 'latest' })  // ★계산 로직 재사용(중복 0)
               └─ StockDailyPrice 종목별 전체 일봉 로드 → calcAllIndicators(순수 Rule)
                  → TechnicalIndicator (stockCode, tradeDate) 멱등 upsert
```

> **배경 — 지표 크론 부재로 홈 '오늘의 투자판단'이 6월 중순에 정체.** 기술지표
> (`TechnicalIndicator`)는 수동 백필(§5.6) 전용이라 prod 에서 한 번도 계산된 적이 없었다(0행).
> 신호 생성(19:00 `loadStockContextAsOf`)의 지표 컨텍스트가 전부 null → chart 버킷(과거 평균
> +19.5, 66% 종목) 전멸 → 6/19 이후 매수등급(BUY/STRONG_BUY_CANDIDATE) 신호 0건(최고점 53).
> 처방: 매 평일 지표를 상시 적재하는 크론 신설. **KRX 일봉 캐치업 체인과 정합** —
> 18:50 은 18:30 일봉 캐치업(§5.1) 후·19:00 신호 생성 전(같은 날 지표가 신호에 반영),
> 21:10 은 21:00 일봉 EOD 재시도(DAR-438) 후 동일 멱등 경로 재발화(18:50 에 KRX 미게시였어도
> 당일분 자가복구). mode='latest'(종목별 최신 거래일 1건)라 **첫 실행이 prod 의 지표 공백을
> 즉시 메운다**. cron-health `FRESHNESS_JOB_SPECS` 에 `market.indicator-daily`(72h 임계) 등록 —
> 적재가 조용히 멈추면 stale 로 표면화(재발 방지 안전망). 점수 공식·등급 임계 무변경(결측
> 데이터 복구지 룰 변경 아님)·AI 0.

---

## 6. Portfolio & Exit 엔진 점검 스케줄 (M8-A DAR-12)

### 6.1 하루 3회 점검 (평일만)

M8-A(DAR-12) 설계상 Exit 점검은 세 시점(PRE_MARKET/INTRADAY/POST_MARKET)의 `CheckTime` 으로
`checkAllPositions(checkTime)` 를 호출한다.

| 점검 시간 | CheckTime 레이블 | 설명 |
|-----------|-----------------|------|
| 09:00 | `PRE_MARKET` | 장 시작 전 — 전날 종가·overnight 리스크 점검 |
| 13:00 | `INTRADAY` | 장중 — VWAP·장중 이탈 점검 |
| 16:30 | `POST_MARKET` | 장 마감 후 — 종가 기준 일별 스냅샷 업데이트 |

> **★배선 현황(DAR-487 정리)**: 초기 M8 스캐폴딩이던 독립 스케줄러 어댑터
> (`IExitCheckScheduler`/`InMemoryExitCheckScheduler`)는 크론에 배선된 적이 없어 삭제했다. 실제
> Exit 평가(`checkAllPositions`)는 라이브 스케줄러 — 모의운용 일일 사이클(6.9)·장중 연속 손절
> 모니터(6.6)·분봉 단타(6.7) — 가 담당한다. 장 시작 전 토큰·데이터·리스크 **readiness** 점검은
> 별도 관심사인 08:30 프리플라이트(5.10)가 read-only 로 커버하며, 포지션 Exit 평가는 트리거하지
> 않는다(M10 클록 보호).

### 6.2 점검 흐름

```
ExitEngineService.checkAllPositions(checkTime)   ← 라이브 스케줄러(6.6/6.7/6.9)가 호출
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

### 6.5 모의운용 평가 가격 = 실시간 실가 (DAR-364)

- 모의운용(Engine5 `PaperSimulationService`)의 보유 포지션 손익·손절 평가와 상태 조회 표시는 **동일한 가격**을 쓴다.
  `SimulationPriceSourceService.latestPriceRow` 가 **KIS 실시간 실가(REALTIME) 1순위 → 실 KRX 일봉(REAL) → 합성(SYNTHETIC)**
  순으로 종목별 단일 소스를 결정한다(운영 기본 `PAPER_SIM_REAL_FEED=1`).
- `evaluateExits`(손절/익절)·`getSimulationStatus`(화면 표시)·`computeMetrics`(equity)가 모두 그 가격을 사용 →
  사용자가 보는 실시간 손실(예: -20%)이 곧 엔진이 손절을 평가하는 손실. 실시간 실가가 **-8% 이하면 하드 스탑로스 EXIT** 발화.
- '30일 트랙레코드'는 합성 전용 트랙이 아니라 **실시간 실가 구동으로 재정의**(과거 백테스트와 분리). 합성은 실데이터·실시간이
  모두 부재한 종목의 최후 폴백·레거시 검증 모드로만 남는다. source 라벨(REALTIME/REAL/SYNTHETIC)·원일자로 정직 고지(2026 오인 금지).
- ★AI 금지영역 불변: 손절/주문수량/리스크는 순수 Rule — Engine5 독립, AI(engine2) 미개입.

### 6.6 장중 연속 손절 모니터 — 능동 fetch (DAR-366)

- **왜 필수인가(라이브 검증 2026-06-19)**: KIS 실시간가는 **KRX 정규장(09:00~15:30 KST)에만** 존재하고
  장외엔 일봉(정체)으로 폴백한다. 일배치 손절 평가 cron(`30 19 * * 1-5`)은 **장 마감 후**라 그 시각엔 실시간이
  영영 없어 정체 일봉으로만 평가 → 손절 영영 미발화. 따라서 **장중에 실시간 실가로 평가**하는 것이 손절이 작동하는 ★유일 경로다.

| 점검 시간 | Cron | 설명 |
|-----------|------|------|
| 09:00~15:30 / 5분 | `*/5 9-15 * * 1-5` | `PaperSimulationScheduler.runIntradayExitMonitor` — ①개장 체결기(전일 매수 예약·이연 청산 → 당일 시가 체결, §6.10 — 2026-07-06부터 시스템 모의뿐 아니라 **철학 4종·전략 forward 4종 예약**도 이름 규약 파서(`forward-track-namespace.ts`)로 네임스페이스를 도출해 체결) ②forward 트랙 포트폴리오 전부(시스템 모의 + `모의운용 포트폴리오*` 이름 규약) 보유종목 실시간 능동 fetch → Exit 평가 |

- **능동 fetch(핵심)**: `runIntradayExitMonitor` 는 `RealtimeQuoteCache` 를 '읽기'만 하지 않는다 — 캐시는 누가 채우지
  않으면 빈다. 보유 OPEN 포지션 종목들의 실시간 현재가를 **KIS 에서 직접 조회(`refreshHoldingsRealtime`)해 캐시를 채운 뒤**
  `evaluateExits` 를 호출한다(모바일이 화면을 열 때만 우연히 캐시되는 구조에 의존 금지).
- **시장시간 게이트**: 메서드가 `isKstRegularMarketHours(now)`(평일 09:00~15:30 KST)로 정밀 클램프. cron 은 시(hour) 단위라
  15:35~15:55 틱은 발화하되 메서드 게이트가 스킵한다. 장외/주말/휴장/KIS 키 미설정은 무가동 스킵(로그·호출 0).
- **장외 정직**: 장 마감 후엔 실시간 불가가 정상 — 그땐 일배치(REAL)만. **장외 손절 미발화는 버그가 아니다(시장 닫힘)**.
  단 장중 급락은 이 모니터가 5분 내 포착한다.
- **멱등·비용**: `evaluateExits` 는 `status=OPEN` 만 처리 → 이미 청산(CLOSED)된 포지션 재처리 없음. 보유종목(≤`MAX_HOLDINGS`)만,
  corpCode 중복 제거, 순차 호출 + 겹침 락(`isIntradayRunning`)으로 분 경계 누적·rate-limit 위반 차단. CronRunLog 는 실제 평가가 돈 틱만 기록.
- ★AI 금지영역 불변: 능동 fetch 는 engine3 market-data primitive(HTTP/캐시), 손절은 순수 Rule — Engine5 독립, AI(engine2) 미개입.

### 6.7 분봉 단타 모의트랙 — 장중 윈도우 스캔 + 15:20 강제청산 (DAR-411·DAR-415·DAR-418)

당일 진입·당일 청산(오버나잇 금지) 실시간 페이퍼 트랙. 분봉은 KIS **forward-only**(당일치만 제공,
과거 분봉 없음) → 백테스트 불가 → 정규장 중 실시간 모의로만 누적한다. 기존 4종 일봉 전략(§2.10)과 별개.

| 잡 | Cron (KST) | 설명 |
|-----|------|------|
| 진입·청산 사이클 | `2-59/10 9-15 * * 1-5` | `IntradayScalpScheduler.runCycle` — 평일 09:02~15:52 매 10분(분봉수집기 §5.7 `*/10` 직후 **+2분 오프셋**). 유니버스→진입 평가→청산 평가 |
| 전량 강제청산 | `20 15 * * 1-5` | `runForceClose` — 15:20 손익 무관 전량 청산(당일 청산 보장) |

- **게이트는 서비스가 정본**: 정규장(09:00~15:30)·신규 진입 마감(`ENTRY_CUTOFF_HHMM='1520'`)은
  `IntradayScalpService` 가 강제 — cron 은 발화만. 장외 틱은 스킵·CronRunLog 미기록(`paper.intraday-scalp` 키는 실제 평가 틱만).
- ★**DAR-415 윈도우 스캔(진입 누락 수정)**: 종전엔 최신 1봉만 검사해 10분 사이클 사이 충족 순간이
  대부분 누락됐다(0619 실측: 215 stock-min 충족 → 진입 0). 수정 — `scanEntrySignals`(engine3 순수 함수)가
  직전 스캔 이후 도착한 **신규 분봉 전부를 각 봉을 '현재'로** point-in-time 평가(미래 분봉 미참조)해
  **첫 충족봉**을 포착한다. 진입ts = 충족봉 시각(사이클 발화 시각 아님)·진입가 = 충족봉 종가.
  종목별 커서(다음 스캔 시작 인덱스) + 당일 진입 이력 종목 dedup(종목당 1라운드트립).
- **리스크 파라미터(순수 Rule, fee-aware DAR-418)**: 순(net) 익절 +2.0% / 순 손절 -1.2%
  (gross 수익률에서 왕복비용율 ≈0.31% 차감 후 판정), 동시 보유 최대 5종목, 종목당 가상원금의 3%,
  가상원금 1,000만 원. 진입 fee 허들(기대이동이 왕복비용+0.3% 마진 초과 시에만 진입).
- ★AI 금지영역 불가침: engine2/AI import 0 — 진입·청산·체결·리스크 전부 순수 Rule.
  **실주문 경로 0** — `simulateFill`(순수 시뮬)만 사용, 증권사 주문 API 호출 없음.

### 6.8 매수/매도 체결 푸시 알림 (이벤트 구동, DAR-424)

Cron 이 아니라 **체결 직후 발행**되는 이벤트 구동 경로 — engine5 라이브 페이퍼 체결
(시스템 모의 `PaperSimulationService`·분봉 단타 `IntradayScalpService`)이 포지션 OPEN/CLOSED
영속 직후 `NOTIFY_JOB.TRADE_ENTRY / TRADE_EXIT` 큐 잡을 발행한다.

- **graceful 발행**: producer 는 `@Optional`(큐 미설정 환경/테스트 no-op), 발행 실패해도 체결을 깨지 않는다.
  체결 시점 포트폴리오 스냅샷(현금·평가금)을 발행 측이 산출해 페이로드에 담는다(point-in-time 보존).
- **브로드캐스트 수신**: 시스템 모의/단타는 전역 단일 시뮬 → 수신자는 포지션 소유자(합성 시스템 유저)가
  아니라 **실제 앱 사용자 전원**(provider='system' 합성 유저 제외).
- **토글 게이트**: `tradePushEnabled`(기본 ON, 설정행 미존재=ON)가 **인박스·푸시를 함께** 게이트 —
  OFF 면 인박스도 남기지 않는다(브로드캐스트 과알림 방지). 푸시는 추가로 master `isEnabled` + 유효 디바이스 토큰 필요.
- **멱등**: `(userId, type, refId)` NotificationHistory unique — 같은 체결 단위(refId)라도 매수/매도는 별개 적재.
- **표기(DAR-432 · 2026-07-06 이모지 제거 개정)**: 제목 앞에 출처명 텍스트(모의 / 단타 등). 매수 본문 `₩{가}×{수량} · 잔액 ₩{현금}`,
  매도 본문 `손익 {±%}({사유}) · 평가금 ₩{총}`. 딥링크·data 페이로드에 strategyKey 포함.
- ★알림은 통지일 뿐 — 주문 결정/실주문과 무관(AI 금지영역 불침범).

### 6.9 forward 트랙 일일 사이클 — 철학 스타일 4트랙 + 전략 변형 4종 (live-readiness W1)

★진단 확정 결함 교정: 철학 스타일 시뮬(DAR-76)은 run-once 수동 경로만 있고 크론 배선이 없어
4트랙이 **미가동**이었고, 전략 변형 4종(DAR-404)은 리플레이(BacktestRun)뿐 forward 실운용이 없었다.
`ForwardTracksScheduler`(engine5 `paper-simulation/forward-tracks.scheduler.ts`)가 두 축을 자동 발화한다.

| 잡 | Cron (KST) | cron-health 키 | 설명 |
|-----|------|------|------|
| 철학 스타일 4트랙 | `40 19 * * 1-5` | `paper.style-simulation` | `PhilosophyStyleSimulationService.runDailyCycleAllStyles` — 시스템 모의(19:30) 직후, BUFFETT/LYNCH/GREENBLATT/DRUCKENMILLER 분기 사이클 |
| 전략 forward 4트랙 | `45 19 * * 1-5` | `paper.strategy-forward` | `StrategyForwardSimulationService.runDailyCycleAllStrategies` — 스타일 직후 직렬화, 이벤트엣지/단기모멘텀/보수가치/공격분산 forward 운용 |
| 듀얼모멘텀 코어 (DAR-494·P13) | `50 19 * * 1-5` | `paper.dual-momentum-forward` | `DualMomentumForwardScheduler.runDaily` → `DualMomentumForwardService.runDailyCycle` — 매일 발화하되 **판정은 월말 거래일 1회**(P09 `isLastTradingDayOfMonth` + 당일 ETF 데이터 게이트, nest cron 'L' 우회). 그 외엔 예약 체결·평가 스냅샷만 |

- **전략 forward 진입 룰**: 라이브 TradingSignal(`disclosure.isBackfill=false`)에 preset.params
  (minBuyScore·eventTypes allowlist·maxPositions·EQUAL/SCORE_WEIGHT 사이징) 적용. 예산은 리플레이와
  동일 산식(`resolvePositionBudget`)을 Risk envelope(가상원금 × maxSinglePositionPct)로 절단 — 하드룰 우회 0.
- **event-edge allowlist**: `EventEdgeSelectorService`(robust 통계)를 **당일 1회** 해석 — forward 에선
  "오늘 신호에 오늘 통계"가 point-in-time 합법. allowlist 가 비면 진입 0 유지 + 로그(do-no-harm, 정직).
- **청산**: preset.exitRules(익절/손절/최대보유)를 Position exit 파라미터 자리에 대입 → engine4
  `calculateExitScore`(순수 Rule) 발화. thesis invalidConditions 미혼입(전략 정체성 = 프리셋 룰만).
  ★개장 체결 정렬 이후 대입 시점은 예약이 아니라 **체결기의 Position 생성 시점**
  (`exitParamsForStyleTag` — 전략 트랙만 프리셋 정본, 그 외 thesis 파생).
- **트랙 식별**: 포트폴리오 `모의운용 포트폴리오 [strategy:<key>]` + `styleTag='strategy:<key>'`
  네임스페이스(스키마 변경 0 — 기존 칼럼·인덱스 재사용). engine3 리플레이 트랙(§2.10)은 무변경 존치.
- **체결 의미론(개장 체결 정렬, 2026-07-06 사용자 승인)**: 철학 4종·전략 forward 4종 모두 시스템
  모의와 동일한 **"저녁 = 주문 결정(PENDING 예약, styleTag 네임스페이스·entryDate=다음 거래일) →
  익일 개장 = 당일 시가 체결"**로 통일(§6.10). 19:40/19:45 사이클은 ⓪만기 예약 폴백 체결(당일 REAL
  시가 — 일반화된 `fillPendingEntries` 소비) → ①신규 예약 → ②평가 → ③Exit 순. 정상 운영의 체결은
  장중 모니터(§6.6) 첫 유효 틱이 수행 — 모든 트랙이 **실제 장중 가격**으로 거래되어 "지금 장에 맞는
  트랙" 데이터가 축적된다.
- **철학 진입 후보 entryReady 폴백(2026-07-06)**: ① `entryReady=true` 우선 → ② 슬롯이 남으면
  `entryReady=false & buyScore≥50`(`ENTRY_FALLBACK_MIN_BUY_SCORE` 재사용) 상위 후보로 보강 —
  시스템 모의 DAR-362 규칙 계승(무차별 확대 아님·품질 하한 유지). dedupe·philosophy-fit ≥50 게이트 유지.
- ★AI 금지영역 불가침: 진입 필터·사이징·청산 전부 순수 Rule. **실주문 경로 0**(`simulateFill`만).

**듀얼모멘텀 코어 forward(DAR-494·P13)** — 위 두 트랙과 별개 자산(ETF)·주기(월말):
- **판정**: engine3 P12 `decideMonthlyRebalance`(순수 함수) 재사용 — `EtfDailyPrice`(4종: 360750/069500/153130/273130)에서 asOf 절단 종가 주입, **252 거래일** 룩백. 상대(argmax A,B) ∧ 절대(> 단기채) 모멘텀 → 단일 자산 100% 목표. 결측(253봉 미만)이면 **무행동 + 전월 유지 + OPS_ALERT**(월 1회 멱등, P02).
- **체결**: "예약 → 익일 시가(PENDING)" 재사용. 월말 SWITCH 판정 시 목표 ETF `DualMomentumForwardTrade`(PENDING, `entryTradeDate=nextTradingDay`) 예약 → 익일 사이클이 **현재 보유 전량 매도(현금 확보) → 목표 전량 매수** 순서로 그 날 시가 집행. 비용은 ETF 프로파일(증권거래세 0, `ETF_FILL_PARAMS`).
- **트랙 식별**: 포트폴리오 `모의운용 포트폴리오 [alloc:dual-momentum]` + `DualMomentumForwardTrade.styleTag='alloc:dual-momentum'`. ETF 는 DART corpCode 가 없어 Position/PaperTrade(→Company FK) 부적합 → **FK 없는 전용 모델**(IntradayScalpTrade 전례). 자산곡선은 `PortfolioRiskSnapshot` 재사용.
- **ENFORCE**: 킬스위치(REDUCE_ONLY — 매도 허용·신규 매수 차단)·현금≥0 불변식은 체결기 경로에서 자동 적용. 활성 근거: 룰북 §9.3.2 위험조정 게이트 통과(2026-07-03 사람 승인). **위성(변동성 돌파)은 기각 — forward 배선 없음.**

### 6.10 장외 체결 의미론 — "저녁 = 주문 결정, 익일 개장 = 체결" (live-readiness W1 시스템 모의 → 2026-07-06 철학·전략 forward 확장)

★진단 확정 결함 교정: 매수 78.8%가 장 마감 후(19:30) **당일 종가로 즉시 체결** 기록되어
정보시점>가격시점 상향 편향이 있었고, 개장 직후 손절 평균 -14.99%(하드스탑 -8% 대비 7%p 초과)로
갭 리스크가 이미 실재했다. 엔진 정본 규칙("다음거래일 시가 진입")·백테스트 규칙(익일 시가)과 일치하도록
시스템 모의(`PaperSimulationService`)의 장외 경로를 예약/이연으로 정정했다(스키마 변경 0 —
PaperTrade 의 기존 `PENDING` status + `entryDate`(체결 예정 거래일) + `styleTag='paper-simulation'` 재사용).

- **매수**: 19:30 사이클의 `openNewPositions` 는 즉시 체결 대신 **PENDING 예약**(entryDate=다음 거래일,
  주말·KRX 공휴일 스킵 `nextTradingDay` 재사용)만 만든다. 알림은 `TRADE_ENTRY` 페이로드의
  `phase='RESERVED'`(주문 예약 — 익일 시가 체결 예정) / `'FILLED'`(체결)로 분리(additive optional —
  기존 소비자 호환).
- **개장 체결기**: 장중 모니터(§6.6) 첫 유효 틱(09:00~)이 만기 예약을 **당일 시가**(KIS 실시간 quote 의
  open 필드 = REALTIME)로 체결하고 Position 을 생성한다. KIS 미가동 시 19:30 사이클이 **당일 REAL 일봉
  open**(KRX 18:30 게시)으로 폴백 체결. 당일 데이터가 없으면 **다음 거래일로 이월**, 체결 예정일로부터
  **3거래일 초과 시 예약 취소(CANCELLED)** — 무한 이월 방지. 체결 시점에 SSOT 현금으로 수량 재클램프
  (cash≥0 불변식) + 예산 envelope(주문수량×예약 기준가) 유지 — Risk 하드룰 우회 0.
- **청산**: 일일(19:30) `evaluateExits` 는 EXIT/BLOCK_REBUY 를 **판정·기록만**
  (`ExitSignal.scoreDetail.deferredFill=true`, checkTime=`POST_MARKET`) 하고, 체결은 익일 시가
  (장외 악재의 **갭다운이 체결가에 정직 반영**). 장중 실효 손절은 장중 모니터가 계속 즉시 체결
  (checkTime=`INTRADAY`, 변경 없음).
- **REALTIME 오염 게이트**: 정규장(평일 09:00~15:30 KST) 밖의 KIS fetch(전일 종가 스냅샷)가 REALTIME
  으로 둔갑하지 않도록 `warmRealtimeQuotes`(fetch 차단)와 `SimulationPriceSourceService.realtimeRowFor`
  (quote 의 fetchedAtMs 기준 판정 — 결정론)에 이중 게이트.
- **다중 포트폴리오 모니터**: 장중 Exit 모니터가 시스템 모의 단일 조회에서 **forward 트랙 포트폴리오
  전부**(시스템 유저 소유 + `모의운용 포트폴리오` prefix — 철학 스타일 `[BUFFETT]`·전략 `[strategy:<key>]`
  자동 편입, 하드코딩 목록 금지)로 확장.
- **★전 트랙 개장 체결 정렬(2026-07-06 사용자 승인)**: 철학 4종·전략 forward 4종의 매수 진입도 위
  의미론으로 통일했다. 각 트랙 사이클(19:40/19:45)은 **PENDING 예약**(styleTag=`BUFFETT` 등 /
  `strategy:<key>`, `orderedShares`=결정 시점 사이징, `entryPrice`=기준가, `entryDate`=다음 거래일)만
  만들고, 체결은 **일반화된 개장 체결기**(`fillPendingEntries` — opts `styleTag`/`initialCapital`/
  `emitTrades`)가 수행한다. 장중 모니터는 포트폴리오 **이름 규약 파서**
  (`forward-track-namespace.ts styleTagForForwardPortfolioName` — 화이트리스트: 철학 4종 +
  전략 프리셋 키. 미상 이름(`[alloc:*]` 등)은 스킵)로 네임스페이스를 도출해 트랙별 예약을 체결한다.
  전략 트랙의 exit 파라미터는 체결기가 프리셋 exitRules 로 대입(`exitParamsForStyleTag` — 정체성
  보존). 이월(3거래일 초과 취소)·현금 재클램프(cash≥0)·예산 envelope 는 시스템 모의와 동일 규칙.
  섀도 원장(DAR-498)은 **시스템 네임스페이스 한정**(원장 대조 계약 보호).
- **체결 알림(2026-07-06)**: 매수 **체결(FILLED)** 알림은 전 트랙 발행 — `strategyKey`=styleTag
  그대로(철학 `BUFFETT`→'버핏' 등 SSOT 라벨, 전략 `strategy:<key>` 는 `sourceByKey` 가 접두사를
  벗겨 프리셋 라벨로 정규화). 예약(RESERVED) 알림·매도 체결 알림은 종전대로 시스템 모의만(과알림 방지).
- 기존 오픈 포지션·과거 데이터는 마이그레이션하지 않는다(새 의미론은 신규 사이클부터). 성과 지표 산식 무변경.
  시스템 모의(styleTag='paper-simulation') 경로는 일반화 후에도 **행동 무변경**(M10 측정 클록 보호 —
  기존 스펙 그린 + 중립성 스펙으로 봉인).
- ★AI 금지영역 불가침: 예약·체결·이연·취소 전부 순수 Rule(`simulateFill`) — 실주문 경로 0, AI 개입 0.

---

**작성일**: 2026-03-07
**최종 수정일**: 2026-07-15 (라이브 파싱 기아 해소 — §2.6 DART 쿼터 3단 분할(라이브 문서 fetch 예약분 3,000 신설·벌크 상한 14,000), §2.5 이벤트 백필 주말 전용 전환(주중 WINDOW_SKIPPED·stale 8일), §2.12 파이프라인 드레인 주중 창 2일→7일 상향) / 이전: 2026-07-07 (§5.13 신설 — 일일 기술지표 계산 크론: `IndicatorDailyScheduler` 평일 18:50(18:30 일봉 캐치업 후·19:00 신호 생성 전) + 21:10(21:00 일봉 재시도 후) 2슬롯 동일 경로(SSOT)·겹침 가드·throw 금지, `IndicatorBackfillService.backfill({mode:'latest'})` 재사용 멱등 upsert, cron-health 키 `market.indicator-daily`(72h 임계) — 지표 크론 부재(prod TechnicalIndicator 0행)로 신호 chart 버킷 전멸·홈 '오늘의 투자판단' 6월 중순 정체를 해소; §5.6 수동 백필 경로에 크론 크로스링크; 같은 날 footer 머지 잔재(중복 최종 수정일) 정리) / 이전: 2026-07-06 (개장 체결 정렬 — §6.9·§6.10 철학 4종·전략 forward 4종 매수 진입을 시스템 모의와 동일한 "저녁 예약(PENDING)→익일 개장 당일 시가 체결" 의미론으로 통일: 일반화된 개장 체결기 `fillPendingEntries(styleTag/initialCapital/emitTrades)` + 장중 모니터 이름 규약 파서(`forward-track-namespace.ts`) + 철학 entryReady 폴백(buyScore≥50) + 전 트랙 체결 알림(strategyKey=styleTag·SSOT 라벨 16종) + §6.6 표 갱신, 시스템 모의 경로 무변경; 같은 날 §2.13 신설 — 격주 트랙 성과 순위 리포트: 매주 일요일 10:00 KST 발화 + 격주 게이트(앵커 `20260712` 짝수 주차)·트레일링 14일 실현 성과 순위·시장국면 태깅·OPS_ALERT 발송·cron-health 키 `ops.biweekly-track-review`(stale 17일); 같은 날 알림 이모지 제거 — §20류 체결·운영 알림 표기를 출처명 텍스트로 개정) / 이전: 2026-07-05 (DAR-503 헤비 수집·스캔 잡 주말 스케줄링 — §2.7·2.8·2.9 주말 전용 전환 + §2.12 신설: 공용 게이트 `isHeavyCollectionWindow`(env `HEAVY_COLLECTION_WINDOW`), 파이프라인 드레인 주중 최근 2일 경량 세이프티넷 이원화, cron-health stale 임계 8일 상향, 경량 잡(파싱 재처리·FAILED 이벤트 복구) 유지 근거) / 이전: 2026-07-03 (live-readiness W1 — §6.10 장외 체결 의미론 신설: 시스템 모의 "19:30=주문 결정, 익일 개장=체결"(매수 예약→당일 시가 체결·청산 이연·이월 상한 3거래일·REALTIME 오염 게이트·장중 모니터 다중 포트폴리오 확장) + §6.6 표 갱신; §6.9 forward 트랙 일일 사이클 신설: 철학 스타일 4트랙 크론 배선(19:40, 미가동 결함 교정) + 전략 변형 4종 forward 모의운용(19:45) + cron-health 키 `paper.style-simulation`/`paper.strategy-forward`; 이전: 2026-07-02 현행화 — §1.1 카카오 OAuth·expo-secure-store·온보딩 3단계 정합, §2 절 번호 재정렬, 분봉 단타(§6.7)·체결 푸시(§6.8)·DART 라이브 쿼터 예약분 가드(§2.11) 반영)
