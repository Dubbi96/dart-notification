# DAR-557 — 과거 신호(2015~2024) 백필 생성 계획서: 11년 게이트의 실데이터 병목 해소안

> ★본 문서는 **계획서다. 실행하지 않는다.** 산출물은 (1) 비용/기간 추정 (2) DAR-129 백필 배제 원칙과의
> 정합 확인 (3) 단계안·킬 기준 3가지다. 실행 여부·착수 시점은 **오너/PM 승인 게이트** 소관(§6).
> 코드 변경 0 — 아래 수치는 전부 dev DB(`dart-notification-db`) 직접 조회 + 기존 코드의 쿼터 상수를
> 근거로 한 **read-only 조사**다.
>
> 상위 문서: `docs/trading/strategy-rulebook.md §8`(변경 절차 3게이트·AI 자동조정 금지) ·
> `docs/trading/backtest-verification-window-11y.md`(DAR-544, 측정 인프라) ·
> `docs/trading/dar-387-11yr-coverage-replay-report.md`(DAR-387, 이 이슈가 발견한 병목의 실행 리포트).

## 0. 문제 재확인 (DAR-387 발견 요약)

DAR-387 실행 결과: 가격·공시 원천 데이터는 2015~2025 전 연도 `FULL`(결측 0)이지만
`trading_signals`는 **2025·2026 두 해만 존재**(189,768행·180,146행, 그 이전 0행). 11년 백테스트
게이트가 사실상 "최근 1.6년" 게이트로 축소되는 이유다. 본 이슈는 그 갭을 메우는 **백필 실행 계획**을
수립한다.

## 1. 실측 현황 — 파이프라인 단계별 커버리지 (2026-07-17 dev DB 조회)

공시→이벤트추출→신호생성 체인은 4단계다. 2015~2024(10개년) 기준 각 단계 진행률:

| 단계 | 담당 서비스 | 2015~2024 진행률 | 비고 |
|---|---|---:|---|
| ① 공시 메타(Disclosure) | `continuous-backfill-drain.service.ts`(DAR-396) | **100%** (2,129,484건 전량 적재, `isBackfill=true`) | DAR-387 감사로 이미 확인(FULL 전 연도) |
| ② 문서 파싱(원문 fetch+parse) | `disclosure-documents.service.ts` `processPendingBatch` | **0%** (`parseStatus='DONE'` 0건 / 10개년 전부) | ★진짜 병목(§2) |
| ③ 이벤트 추출(DisclosureEvent) | `disclosure-events.service.ts` / `event-backfill-drain.service.ts`(DAR-391) | **0%**(②의 결과물이 없어 파생적으로 0) | Rule 전용, DART 호출 0(②만 풀리면 자동 해소) |
| ④ 신호 생성(TradingSignal, `isBackfill=true`) | `signal-generation.service.ts` `generateBackfillSignals()`(DAR-389) | **0%**(③이 없어 파생적으로 0) | Rule 전용(BuyScore), AI 호출 0, 기존 구현 재사용만 하면 됨 |

원본 SQL 및 결과(재현 가능):

```sql
-- ①③ 연도별 공시·이벤트 커버리지 (isBackfill=true 만)
SELECT substring(d."rcpDt" from 1 for 4) yr, count(*) disclosures,
       count(e."rcpNo") events
FROM disclosures d LEFT JOIN disclosure_events e ON e."rcpNo"=d."rcpNo"
WHERE d."isBackfill" GROUP BY 1 ORDER BY 1;
-- 2015~2024: disclosures = {153230,201702,197278,210042,219333,215066,224420,225435,235471,247507}
--            events      = {0,0,0,0,0,0,0,0,0,0}  ← 합계 2,129,484건 / 0건 추출

-- ② 문서 파싱 상태 (2015~2024, isBackfill=true)
SELECT substring(d."rcpDt" from 1 for 4) yr, doc."parseStatus", count(*)
FROM disclosures d LEFT JOIN disclosure_documents doc ON doc."rcpNo"=d."rcpNo"
WHERE d."isBackfill" AND substring(d."rcpDt" from 1 for 4) BETWEEN '2015' AND '2024'
GROUP BY 1,2 ORDER BY 1,2;
-- 전 연도 parseStatus='DONE' 0건. PENDING 1,889,866건 + 문서레코드 자체 미등록 239,618건
-- (2016~2021, Phase-2 enqueue 전 단계) = 합계 2,129,484건 전량 미착수.
```

**전체 `disclosure_documents` 테이블 상태(전 연도 합계, 참고)**: `PENDING` 2,088,503 ·
`DONE` 156,676(대부분 2025·2026) · `FETCH_FAILED` 81,193 · `SKIPPED` 709 · `FETCHING`/`PARSING` 소수.

## 2. 병목 특정 — "AI 비용"이 아니라 "DART 문서 fetch 쿼터"다

이슈 제목은 "DART 쿼터·AI 비용"을 나란히 물었으나, 실측 결과 **이 게이트의 크리티컬 패스는 AI 비용과
무관하다.** 근거:

1. `generateBackfillSignals()`(DAR-389, `signal-generation.service.ts:494-720`)는 **AI를 전혀 호출하지
   않는다** — BuyScore는 Rule 계산이고, calibration 보정계수도 point-in-time 무결성을 위해
   **명시적으로 미적용**(코드 주석 "calibratedConfidence = buyScore, lookahead 0"). `summaryMap`(AI
   요약)도 인자에서 생략한다. 즉 **신호 생성 자체는 AI 예산과 완전히 독립**이다.
2. AI 백필(`ai-backfill-drain.service.ts`, DAR-379)은 **별도의 선택적 자산**(calibration 근거·
   `DisclosureAnalysis` 코퍼스 축적)이지 신호 생성의 전제조건이 아니다. 이 서비스는 일 예산 $1(→
   `AiCostLimitGuardService.DEFAULT_DAILY_LIMIT_USD=1.0`, 월 $31) 안에서 건당 추정단가
   $0.01(2배 헤드룸)로 최대 100건/일을 발행한다. 2,129,484건 전체를 AI 평가하려면
   **≈21,300일(≈58년)** 이 걸린다 — 애초에 이 규모의 AI 커버리지는 시도 대상이 아니다.
   → **권고: 이번 백필은 AI 평가(②)를 스코프에서 명시적으로 제외**하고, Rule 추출+Rule 신호생성
   경로(①②③④ 중 AI-free 부분)만으로 게이트를 채운다.
3. 실제 병목은 **DART 문서 fetch 쿼터**다. `dart-api.service.ts:42-49`:
   `DART_DAILY_BUDGET=19,000` → `LIVE_RESERVE=2,000`(라이브 목록수집) →
   `LIVE_PARSE_CEILING=17,000` → `LIVE_PARSE_RESERVE=3,000`(라이브 문서fetch) →
   **`BULK_CEILING=14,000`콜/일**(백필 list+문서fetch+재무제표 등 벌크 전체 공유).
   문서 1건 파싱 ≈ DART 문서fetch 1콜이므로, 벌크 쿼터가 곧 파싱 처리량의 상한이다.

## 3. 비용/기간 추정

### 3.1 DART 쿼터 기반 시간 추정 (그라운드 트루스: 코드 상수)

DAR-503(`heavy-collection-window.ts`)에 따라 벌크(백필) 잡은 **주말(토·일, KST)에만** 가동된다
(`isHeavyCollectionWindow`, 기본 정책 `'weekend'`). 주중엔 문서파싱 드레인(`pipeline-drain.scheduler.ts`)
이 최근 7일 세이프티넷만 돈다(`WEEKDAY_DRAIN_LOOKBACK_MS`) — 백필 벌크 소비 0.

| 항목 | 값 | 근거 |
|---|---:|---|
| 목표 물량(2015~2024, 미파싱 문서) | 2,129,484건 | §1 실측 |
| 벌크 쿼터 상한 | 14,000콜/일 | `dart-api.service.ts` `DART_BULK_CEILING` |
| 헤비 창(주말) | 2일/주 | `heavy-collection-window.ts` 기본정책 |
| **이론 상한** | 28,000콜/주말 | 14,000 × 2, 벌크 예산을 백필에 100% 전용 가정 |
| **이론 소요** | **≈76주말(≈17.5개월)** | 2,129,484 ÷ 28,000 |

**보수적 조정(현실 반영)**: 벌크 예산(`BULK_CEILING`)은 문서fetch뿐 아니라 재무제표(`CompanyFinancial`)·
지분공시(`InsiderHoldingChange`) 등 다른 벌크 수집과 **공유**된다(§2-3 인용). 재시도 비용도 있다
(현재 전체 `FETCH_FAILED` 81,193건 — 과거분 재시도가 전체의 약 3~4%를 추가 소모할 개연성).
백필 문서fetch에 벌크 예산의 60~80%만 실제 배정된다고 가정하면:

| 배정 비율 | 유효 처리량/주말 | 소요 주말 | 소요 기간 |
|---:|---:|---:|---:|
| 100%(이론) | 28,000 | ≈76 | ≈17.5개월 |
| 80% | 22,400 | ≈95 | ≈22개월(≈1.8년) |
| 60% | 16,800 | ≈127 | ≈29개월(≈2.4년) |

**결론**: 단일 무료 DART 키·주말 전용 스케줄 유지 시 10개년 전량 파싱은 **최소 1.5년, 현실적으로
2~2.5년** 규모다. 이는 "빠른 백필"이 아니라 **다년 인프라 프로젝트**로 취급해야 함을 뜻한다.

### 3.2 이벤트 추출·신호생성 비용 — 사실상 무료(파생적)

문서가 `DONE`이 되면 이벤트 추출(Rule, DART 호출 0)과 신호생성(`generateBackfillSignals`, DB+CPU만,
AI 호출 0)은 **②의 파생물**이라 별도 쿼터·비용이 들지 않는다. 신호생성은 수동 스크립트
(`signal-generation.backfill.manual.ts`, 이미 존재·DAR-389)로 임의 시점에 재실행 가능하며 배치당
500이벤트, 스로틀 옵션 있음 — 이 단계는 계획의 크리티컬 패스가 아니다.

### 3.3 실측 한계 — "주말 드레이너 진행률 실측"에 대한 정직한 고지

dev DB의 `disclosure_collection_logs`를 조회한 결과, `BACKFILL_EXTEND`(공시 메타 드레이너) 최종
실행은 **2026-06-27(SUCCESS)~2026-07-02(FAILED)**에서 멈춰 있다(프런티어 2014-09-17 도달, 이후
2014-08-18 윈도에서 7회 연속 FAILED — 이 경계 자체는 §0 스코프(2015~2024) 밖이라 이번 게이트를
막지 않는다). 이 로그는 **이 dev/local 인스턴스에서 과거 세션 중 수동/단발 실행된 흔적**이지,
**배포된 prod 환경에서 상시 가동 중인 주말 크론의 실측 처리량이 아니다** — dev 서버가 이 세션 동안
상시 기동 상태가 아니었으므로 "주말당 실제 몇 건 처리되는가"는 이 로그로 검증할 수 없다.

★따라서 §3.1의 시간 추정은 **코드 상수(쿼터 상한) 기반의 이론치**이며, prod 실제 처리량 실측에는
**DAR-536과 동일한 선행조건 블로커**(prod `disclosure_collection_logs` 읽기 접근 미확보)가 있다.
prod 배포 후 실제 첫 1~2회 주말 사이클의 `BACKFILL_EXTEND`/파싱 드레인 `CronRunLog` 처리건수를
관측해 §3.1 추정을 보정하는 것을 1단계 실행의 첫 산출물로 권고한다(§5 Phase 0).

## 4. DAR-129 백필 배제 원칙과의 정합 — 신규 작업 불요, 기존 구현 재확인

DAR-129("라이브 신호·알림에 backfill 0건 누출")는 **이미 코드로 봉인**되어 있고, 이번 백필은 그
불가침 경계를 재사용하기만 하면 된다. 신규 격리 로직 개발이 필요 없다는 것이 이번 조사의 핵심 확인:

- **라이브 신호 생성**(`generateMissingSignals`, `signal-generation.service.ts:284-285`)은
  `disclosure: { isBackfill: false }` 관계 필터로 backfill 이벤트를 **원천 배제**한다.
- **백필 전용 신호 생성**(`generateBackfillSignals`, DAR-389, 동 파일 466-494행 주석)은 별도
  진입점으로 `disclosure: { isBackfill: true }`만 대상으로 하며, **통지 enqueue 코드 자체가 없다**
  (681행 주석: "★통지 enqueue 없음 — 과거 신호는 푸시 알림 대상이 아니다"). 두 경로는 같은
  `TradingSignal` 테이블에 쓰지만 **자연키(`corpCode,rcpNo,eventType,persona`) 충돌 없이 공존**하고,
  피드/알림 조회 경로는 전부 라이브 경로가 만든 신호만 참조한다(별도 `isBackfill` 플래그 전파 없음 —
  라이브 조회 자체가 backfill 이벤트를 절대 만들지 않으므로 원천 차단).
- **공시 저장 시점부터 격리**: 연속 백필 드레이너(`continuous-backfill-drain.service.ts:303`)가
  저장하는 모든 과거 공시는 `isBackfill: true`로 생성되고, `saveChunk`는 알림 발송(`matchAndNotify`)을
  호출하지 않는다(279행 주석: "과거 공시 푸시 폭탄 방지").
- **point-in-time 무결성**(백필 신호가 미래 정보를 쓰지 않는가): `generateBackfillSignals`는 가격·
  지표·지수를 **공시일(rcpDt) as-of 절단**으로 조회(`loadStockContextAsOf`/`loadMarketContextAsOf`)하고,
  calibration·현재 상태스냅샷 하드차단도 미적용한다(lookahead 0, 코드 주석 474-487행에 근거 명시).

**결론**: DAR-557 백필은 DAR-129/DAR-389가 이미 구축한 격리·point-in-time 경계 안에서 ②(문서파싱)
단계만 밀어 넣으면 ③④가 자동으로 그 경계를 지키며 채워진다. **정합 확인 완료 — 코드 변경 불요.**

## 5. 단계안 (연도별 역순) + 실행 인프라 현황

### 5.1 방향성 확인 — "역순"은 이미 부분적으로 구현되어 있다

문서 파싱 우선순위(`disclosure-documents.service.ts:601-621`, DAR-394
`selectPrioritizedPending`)는 이미 **거래대상 공시를 `rcpDt DESC`(최신 우선)로 선점**한다(주석:
"백테스트 최근 구간을 빠르게 충전"). 즉 **2024→2015 역순 우선순위가 파싱 단계엔 이미 배선되어
있다.** 다만 이벤트 추출의 보조 경로(`event-backfill-drain.service.ts` Phase 1, DAR-391)는
`rcpDt ASC`(과거 우선)로 하드코딩되어 있어 방향이 어긋난다 — 단, 이 경로는 이미 파싱된(DONE) 문서만
대상으로 하는 저비용 보조 드레인이라 전체 방향성을 막지는 않는다(주 드레인은
`pipeline-integrity.service.ts`가 파싱+추출을 한 사이클에 묶어 처리하며, 그 추출도 `parsedAt asc`라
파싱이 최신 우선이면 추출도 자연히 최신 우선으로 따라간다).

**구현 갭(실행 단계용, 지금 고치지 않음)**: 연도 단위로 명시적 체크포인트를 걸려면
`EventBackfillDrainOptions`에 `startRcpDt`/`endRcpDt`를 추가(이미 `BackfillSignalOptions`엔 존재 —
`signal-generation.backfill.manual.ts`가 이미 env로 노출 중)하는 소규모 확장이 필요하다. 실행 승인
후 1개 스펙+수십 줄 규모.

### 5.2 제안 마일스톤 (역순: 2024 → 2015, 연 단위)

| Phase | 대상 | 산출물(졸업 기준) |
|---|---|---|
| Phase 0 | prod 실측 보정 | prod 첫 1~2 주말 사이클의 `CronRunLog` 처리건수로 §3.1 추정 재보정(블로커: prod 로그 접근, DAR-536과 동일 오너 승인 필요) |
| Phase 1 | 2024 | 문서 파싱 ≥95%(거래대상 필터 기준) → `generateBackfillSignals(2024-01-01~2024-12-31)` → `data-coverage`/`extended-window-replay` 리포트로 신호밀도·완주 확인 |
| Phase 2 | 2023 | 상동 |
| … | … | … |
| Phase 10 | 2015 | 상동 — 11년 창 완성 |

각 Phase는 **독립적으로 가치가 있다**(완료된 연도만큼 즉시 백테스트 창이 넓어짐) — 전량 완료를
기다리지 않고 §6 킬 기준에서 언제든 멈춰도 그때까지의 창은 유효 자산으로 남는다.

## 6. 킬 기준 (오너/PM 승인 게이트 겸용)

1. **쿼터 경합 킬**: 주말 백필이 월요일 라이브 신선도(cron-health freshness)에 관측 가능한 지연을
   유발하면 즉시 중단(`HEAVY_COLLECTION_WINDOW` env로 롤백 — 기존 안전판, 코드 변경 불요).
2. **기간 초과 킬**: Phase 0 보정 후 실측 처리량이 §3.1 이론치의 50% 미만이면(예상보다 훨씬 느림)
   오너에게 에스컬레이션 — 옵션: (a) 유료 DART 키 등급 상향 검토 (b) 목표 창을 11년→5~7년으로
   축소 (c) 현재 페이스로 계속.
3. **연도별 데이터품질 킬**: 완료된 연도의 신호밀도가 통계적으로 무의미한 수준(예: 월평균 신호수가
   2025~2026 대비 이례적으로 희소, 혹은 `data-coverage` 감사가 `FULL_YEAR_MIN_TRADING_DAYS=240`
   하한을 충족 못함)이면 그 연도에서 역순 확장을 멈추고 "부분 창(N년)"으로 문서화 확정.
4. **AI 스코프 재유입 킬**: 만약 실행 단계에서 "AI 평가도 필요하다"는 요구가 재부상하면 §2-2의
   비용(≈58년/전량) 재확인 후 **부분 샘플링**(예: 연도당 N건 샘플)으로 재정의하고 새 이슈로 분리 —
   이번 계획(Rule-only 경로)의 범위를 벗어난다.
5. **AI 금지영역/§8.4 위반 킬**: 어떤 시점에도 리포트 결과가 전략 파라미터(손절·익절·사이징 등)를
   자동으로 바꾸지 않는다 — 사람 승인 3게이트(§8.1)만이 반영 경로. 이번 인프라도 read-only
   신호적재이며 `BacktestRun`/`PaperTrade` 영속과 무관하다.

## 7. 오너/PM 승인 요청 사항 (다음 액션)

이 문서는 실행하지 않는다. 착수하려면 아래를 명시적으로 승인해야 한다:

1. §3.1 추정(1.5~2.5년, 주말 전용 무료 키 기준)을 **수용**하는가, 아니면 유료 키/쿼터 확장을
   먼저 검토하는가.
2. §2 권고대로 **AI 평가(ai-backfill-drain)를 이번 스코프에서 제외**하는 데 동의하는가(권장).
3. §5.2 **연도별 역순(2024→2015) 마일스톤**과 Phase 0(prod 실측 보정, DAR-536과 동일 블로커) 선행에
   동의하는가.
4. 승인 시 별도 실행 이슈(Phase 0부터)를 자식 이슈로 생성해 착수한다 — 본 이슈(DAR-557)는 계획서
   제출로 완료 처리한다.
