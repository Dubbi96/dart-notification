# AOS 기기 판단 Agent · 실거래 준비도 검토 (#585)

검토일: 2026-10-13 KST. 착수 기준: `origin/main` `9cadc5d48f03b9832eb78965619c7df19b50feed`.
범위: 저장소 코드, 공식 공개 문서, 아래에 기록한 제한적 운영 HTTP·호스트 상태 점검. 운영 DB, 사용자 실계좌, 현재 운영 플래그의 실제 값은 이 검토에서 확인하지 않았다.

## 결론

기기 내 Rule 계산 기반은 이미 있다. #585는 **일일 공시 신호와 종가를 재평가하는 Shadow 화면**에 입력 검증, 현재/과거 구분, 통제 상태 미확인 시 보류, 합성 안전 점검 22개를 보강했다. 현재가를 계속 감시해 실계좌를 운용하는 Agent는 아니다. A1–A8의 코드 산출물 완료를 실거래 준비 완료로 해석해서는 안 된다.

가장 작은 안전한 확장 순서는 `데이터 시점 공개 → 기기 평가·반례 검증 → 실제 데이터 Shadow 관찰 → KIS 모의 주문·체결 대조 → 별도 승인된 소액 LIVE`다. AI 모델 추가보다 데이터 시점, 계좌 소유권, 주문 멱등성, 중단 복구를 먼저 보강한다. 조건을 충족하지 못하면 판단 보류하며 수익이나 손절 체결을 보증하지 않는다.

## 기능별 실제 상태

아래 경로는 저장소 루트 기준이다. “구현”은 코드 확인을 뜻하며 운영 데이터가 최신이라는 의미가 아니다.

| 기능 | 코드상 상태 | 근거 / 남은 차이 |
| --- | --- | --- |
| KIS 현재가 | 서버 수집 구현 | `backend/src/engine3-quant-market/market-data/kis-realtime.poller.ts`: 평일 09~15시 분 단위, 최대 60종목, 인메모리 캐시. Tick streaming이 아님 |
| 화면 시세 | REALTIME / DAILY 구분 | `stock-quote.service.ts`: 5분 이내 수집 캐시 우선, 없으면 최신 일봉 종가. 종가를 체결 가능한 현재가로 쓰면 안 됨 |
| 시세 시각 계약 | #585 보강 | `fetchedAt`은 KIS 응답 수집시각, `marketObservedAt`은 미제공으로 null, `freshnessMaxAgeMs`는 캐시 상한. 실제 거래소 시각/휴장/거래정지는 별도 검증 필요 |
| 공시 정량 사실 | 파싱·정규화·정정 감지 구현 | `engine1-disclosure/disclosure-documents/facts/dart-filed-fact.service.ts`, `mappers/amendment.detector.ts`. 최신 재파싱 값은 당시 알 수 있던 값과 다를 수 있음 |
| FeatureSnapshot | 불변 JSON/hash/원본 참조 구현 | `aos/feature-engine/services/freeze-feature-snapshot.service.ts`; dual-write 플래그 기본 OFF, 실패 시 legacy 유지 |
| 시점 정합성 | 아직 불완전 | `engine3-quant-market/signal-generation/signal-generation.service.ts`의 `maybeFreezeFeatureSnapshot`: `staleFeatureKeys`와 `validationErrors`를 빈 배열로 기록. 빈 배열이 “검증 통과”를 뜻하지 않음 |
| 기기 Rule | 공유 순수 evaluator 실행, #585 검증 보강 | `mobile/utils/deviceRuleDecision.ts`, `hooks/useDeviceRuleDecision.ts`. 서버 buyScore/grade/필수조건/riskFlag/종가를 입력으로 기기에서 재평가. 가격 기준일·수치·생성/만료시각·현재 통제 확인을 보강했으나 원문 공시 재분석이나 실주문 결정 경로는 아님 |
| 기기 자체 점검 | 22개 합성 사례 | `DeviceRuleCheckSheet.tsx`에서 공유 evaluator의 입력 누락·과거/현재·만료·위험·통제 반례를 표시. 실제 데이터 Backtest, 브로커 체결 검증, 수익성 평가를 대체하지 않음 |
| 기기 보관 | receipt 요약 보관 | `deviceDecisionCache.service.ts`: version/hash와 최대 5개 결과만 SecureStore 저장. 완전한 데이터 재생 원장이 아님 |
| 기기 AI | 미구현 | 모바일에 온디바이스 모델/추론 runtime이나 모델 검증 계약 없음. 기존 AI 분석과 Rule 재평가를 구분해야 함 |
| Backtest | 비용·기간별 지표·acceptance 기록 구현 | `aos/backtest/services/run-aos-backtest.service.ts`. 승인 기준 미입력은 NOT_EVALUATED. 단위테스트 통과가 성과 통과를 뜻하지 않음 |
| Backtest 증거 연결 | 추가 강화 필요 | VERSIONED_EVALUATOR는 전달받은 `signalDecisionId` 유무를 검사하지만 그 ID의 버전·snapshot·시점 일치를 직접 조회/재평가하지 않음. TRAIN/VALIDATION/TEST 존재 검사는 있으나 구간 겹침 차단은 없음 |
| Hard Risk | 순수 계산·계정 분리 구현 | `aos/execution/domain/canonical-risk.ts`; `canonical-paper-ledger.service.ts`는 승인 수치 부재 시 SKIPPED. 실제 운영의 수치 승인/활성화는 별도 |
| Shadow 주문 | 내부 모의 체결만 구현 | `engine5-trading-risk/domain/execution-port.ts`의 구현체는 `PaperExecutionAdapter`. 한국투자 모의투자 서버 주문과도 다른 자체 simulation |
| 실계좌 주문·체결 대조 | 미구현 | KIS order adapter / account credentials onboarding / 실주문 상태 동기화 / 잔고·주문 재조정 경로가 없음 |
| 버전 장후 변경 | 가드 구현 | `aos/strategy-management/domain/strategy-activation-policy.ts`. 검증된 거래일 종가 이후만 허용, 미검증 연도는 차단 |
| 모바일 상시 감시 | 미구현 | `useStockQuotes.ts`: background polling OFF. #585 기기 평가 hook은 foreground에서 입력 변경·1분 간격·복귀 시 재평가하고 현재 통제 상태를 조회하나, background 상시 실행 service는 없음 |

## 실거래 전에 닫아야 하는 차단 항목

1. **운영자 본인 확인**: 운영 권한의 본인 확인과 membership 수명주기 검증을 강화한 뒤 외부 운영 변경·LIVE를 허용해야 한다. 상세 보안 검토는 운영자에게 비공개로 전달한다. 이 검토에서는 실제 운영 계정의 등록 상태를 조회하거나 운영 설정을 변경하지 않았다.
2. **시세 freshness와 시장 유효성**: 수집시각은 거래소 체결시각이 아니다. 장외·휴장에도 받은 값, 거래정지, 미래시각, 오래된 종가를 주문 입력으로 쓰지 않는다. #585는 수집시각 공개와 미래/비정상 캐시시각 거부만 해결한다. LIVE는 별도 신선도 SLA와 세션/종목 상태 계약이 필요하다.
3. **공시 Point-in-time**: rcpDt, 수집시각, 추출시각, 정정 적용시각, 정보가 실제로 사용 가능해진 시각을 구분해야 한다. 최신 재무제표/정정공시를 과거 신호에 섞지 않는 재생 데이터셋 검증이 필요하다.
4. **계좌별 reconciliation**: `aos/execution/services/aos-reconciliation.service.ts`는 계좌별 실제 원장과 전역 `paper-simulation` BUY 체결을 대조한다. `PaperTrade`에는 계좌/portfolio 소유 필드가 없고 thesis도 nullable이다. 단순 원장 ID 필터는 누락된 orphan을 숨기므로 안전한 수정이 아니다. 원천 예약의 소유 계좌 provenance와 DB migration/backfill 정책부터 확정해야 한다.
5. **실행 복구**: 접수 성공 뒤 통신 실패, 미체결/부분체결, 취소·정정 경쟁, 재시작, 중복 요청, 인증 만료, 장 마감·거래정지·갭 하락을 KIS 모의 환경에서 검증한다. “HTTP 성공”과 “주문 접수”, “체결”을 분리한다. 시장에서 거래 상대가 없으면 손절가 체결이 불가능할 수 있다.
6. **보안 의존성**: 최소 범위 업데이트로 Backend 신규 차단 advisory 12건과 Operator 2건을 해소했다. Mobile에는 미해결 high advisory 4건이 남아 audit gate가 실패한다. 새 allowlist 예외는 추가하지 않았다. 아래 최종 검사 표처럼 빌드/단위테스트 통과와 보안 게이트를 분리해 판단해야 한다. 자동 대규모 audit fix나 프레임워크 메이저 변경은 하지 않았다.
7. **캘린더 갱신**: `common/time/market-calendar.ts`의 fully verified 집합은 2026만 포함한다. 2027 일정 검증 전 전략 활성화를 차단하는 정책을 유지한다. 현행 일부 legacy 장중 경로는 휴장/특수 세션 공용 맵을 사용하지 않으므로 실전 전에 통합 검증한다.

## 휴대전화가 판단 주체가 되는 구성

사용자의 요구대로 Rule 계산 주체는 기기로 둘 수 있다. 다만 **계산 위치와 무중단 실행 보장은 다른 문제**다.

- 앱 실행 중: 사전 승인된 immutable Rule/Weight/Risk와 시점이 명시된 데이터를 받아 기기에서 평가한다. 결과는 `진입 대기/조건 충족/손절/익절/시간 청산/판단 불가`와 근거 trace로 표현한다.
- 모델이 꼭 필요한 경우: 원문 요약·이벤트/위험 feature 추출에만 쓰고, 고정된 JSON schema·신뢰도·모델 버전으로 제한한다. 기기 성능/발열/배터리 실측 뒤 도입한다. 모델이 Risk gate나 주문 수량을 임의 수정하지 않는다.
- 앱 중단/오프라인: 신규 진입 금지. 마지막 화면의 READY를 재사용하지 않는다. 이미 보유한 포지션의 보호는 사용자가 선택한 별도 정책이 필요하다. 기기가 꺼진 동안 기기 내 손절은 실행될 수 없다.
- 연결 복구: 거래소/브로커 상태·잔고·미체결을 먼저 조회하고 중복 여부를 대조한 뒤 재개한다. 감시 중단 구간은 원장에 남긴다.

Android는 Doze에서 네트워크/일반 작업을 지연하며 WorkManager도 연속 실시간 실행을 보장하지 않는다. foreground service 역시 시작 조건과 OS 정책을 따른다. 따라서 단순 타이머/알림/배터리 최적화 제외만으로 “백그라운드 자동 손절 보장”을 표시해서는 안 된다. 이는 공식 OS 제약을 현재 React Native 구현에 적용한 설계 판단이다. [Android Doze](https://developer.android.com/training/monitoring-device-state/doze-standby), [Foreground service 시작 제한](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

선택이 필요한 운영 방식은 다음 두 가지다. 현재 릴리스가 임의로 선택하거나 실거래를 활성화하지 않는다.

| 방식 | 기기 역할 | 필요한 추가 조건 |
| --- | --- | --- |
| 기기 전용, 사용 중 운용 | 판단·감시 모두 폰 | 화면 종료/연결 단절 시 신규 진입 중단. 무감시 보유를 어떻게 처리할지 사용자 승인 필요 |
| 기기 판단 + 외부 비상 안전장치 | 판단은 폰, 이미 승인한 보호 주문만 별도 실행 | 브로커가 지원하는 보호 주문 범위 또는 서버의 제한된 비상 실행, 단일 주문 권위/heartbeat/충돌 방지 계약 필요 |

## 자체 평가의 합격 증거

합성 사례를 많이 통과하는 것은 **규칙의 예상 행동 검증**이지 수익성 검증이 아니다. 실제 시계열과 분리해 표시한다.

| 축 | 최소 반례 | 기대 행동 / 남길 증거 |
| --- | --- | --- |
| 데이터 | 0/NaN/미래/오래된 가격, 가격 없음, 정정공시, 순서 역전 | BLOCK/판단 보류, source와 시점, 부족한 feature |
| 진입 | 모든 조건 충족, 필수 1개 미충족, 높은 AI 점수+위험 flag | 가격·필수조건·Risk 우선순위 trace, AI로 우회되지 않음 |
| 청산 | 손절·익절 동시 범위, 갭 하락, 추적 고점 이후 하락, 기간 만료 | 우선순위와 가격 가정 명시, 실제 체결과 구분 |
| 계좌 | 현금 부족, 일/주/월 손실 한도, 종목/섹터 집중, 장기계좌 자금 | 축소/차단과 수량·잔고 근거, 장기자산 자동 보전 0 |
| 실행 | 중복 요청, 부분체결, 응답 유실, 재시작, 취소 경합 | 동일 client order key, 브로커 조회 후 상태 확정, 누락/이중 체결 0 |
| 플랫폼 | 화면 잠금, Doze, 비행기 모드, 강제 종료, 네트워크 전환 | 감시 중단이 표시됨, stale READY 금지, 재연결 시 잔고 대조 선행 |
| 성과 | 상승/하락/횡보, 유동성 부족, 미관측 종목/기간, 비용 증가 | 비중첩 walk-forward, 비용 후 손익/MDD/회전율/MAE/MFE, parameter sensitivity |

### #585에서 직접 검증한 데이터 계약 변경

`StockQuoteService`는 기존 가격/출처 필드를 유지하며 수집시각 메타데이터만 추가한다. DAILY 폴백에 새로운 조회시각을 붙여 최신 가격으로 보이게 하지 않는다. 모바일 필드는 optional로 두어 기존 운영 API와 호환된다. 공유 cache는 미래/NaN/무한대 시각을 거부하고 유한하지 않은 가격은 quote에서 DAILY로 폴백한다.

가격/cache 및 아래 Humanizer의 계약 테스트를 포함해, 의존성 수정 후 Backend 전체 회귀를 다시 실행했다. 이는 로컬 단위검증이며 운영 배포/실시간 시세 품질/실계좌 검증을 의미하지 않는다.

### 최종 로컬 검증 상태

- Backend: `npx tsc --noEmit`, `npm run build`, `npx jest --runInBand --silent --forceExit` 통과. 전체 **368 suites / 4,791 tests**. 기존 종료되지 않은 handle 경고가 있어 forceExit로 종료했으며 handle 원인을 이번 작업에서 해결한 것은 아니다.
- Mobile: 전체 **36 suites / 275 tests / 5 snapshots**, 앱·테스트 TypeScript 검사, Android JS bundle 생성 통과. lint 오류 0개, 기존 경고 829개. 합성 자체 점검 **22 / 22**는 수익률이나 실계좌 주문 검증이 아니다.
- 공유 Rule 패키지: **17 tests** 및 dependency boundary 검사 통과. Operator 웹: TypeScript/Vite build 및 **2 tests** 통과.
- 변경 APK의 실제 휴대전화 설치·터치·잠금/Doze·통신 단절 검증은 미완료다. APK 빌드·배포 상태와 화면 검토 증거는 [모바일 작업 기록](aos-mobile-agent-585.md)을 기준으로 확인한다.

2026-10-13 `node scripts/audit-gate.mjs <workspace>`의 최종 상태다. 아래 심각도 수치는 `npm audit --omit=dev`의 취약 의존성 집계이며, 고유 advisory 수와 다르다.

| Workspace | Critical / High / Moderate / Low | High·Critical 고유 advisory | Gate |
| --- | --- | --- | --- |
| backend | 0 / 4 / 13 / 1 | 4건, 기존 예외 4·차단 0 | 통과 |
| operator-web | 0 / 0 / 0 / 0 | 0건 | 통과 |
| mobile | 0 / 17 / 10 / 1 | 4건, 예외 0·차단 4 | **실패** |

Backend의 기존 예외는 `fast-xml-builder`, `fast-xml-parser`, `lodash`, `path-to-regexp`다. Backend 개발 의존성까지 포함한 audit에는 68개(critical 1/high 44/moderate 19/low 4)가 남는다. 게이트 통과는 무취약·LIVE 안전성 증명이 아니며 후속 보안 작업이 필요하다.

Mobile 미해결 4건은 `braces` [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `node-forge` [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), `image-size` [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)·[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)다. 검토일 기준 앞의 두 패키지에는 공식 수정판이 없고, `image-size`는 1.x 수정판 없이 2.x로 전환해야 한다. 현행 Metro의 동기 파일 경로 호출과 API가 달라 강제 override는 적용하지 않았다. 상위 도구의 호환 업데이트 또는 별도 검증한 수정이 필요하며, 예외 추가로 통과 처리하지 않는다.

### 운영 응답 단발 점검: 2026-10-13 10:07 KST

각 경로에 10초 상한 GET을 한 번씩 보냈다. `/health`는 HTTP 200·0.326초였지만 `/api/disclosures/today-count`는 TLS 연결 완료 0.088초 뒤 본문 없이 10.005초에 타임아웃됐다. 읽기 전용 호스트 점검에서 Backend·Redis는 healthy였고 부하는 낮았다. 반복 요청, 운영 DB·로그·환경변수 조회, 배포·재시작은 하지 않았다.

이는 **서버 readiness 응답과 공시 집계 응답 지연을 따로 확인한 결과**다. 공시 최신일·누락 여부·현재가 정확성·분석 품질이 정상이라는 증거는 아니다. 로컬 `backend/src/ops/indicators/prisma-health.indicator.ts:21`의 health DB 검사는 `SELECT 1` 연결 확인이며 실제 공시 집계를 검사하지 않는다.

다음 조사 지점은 코드 기준 가설이며 운영 원인으로 확정하지 않았다.

- `backend/src/engine1-disclosure/disclosures/disclosures.service.ts:140`: 최신 `rcpDt` 한 건 조회 후 `startsWith(date)` count를 순차 실행한다. `findAll`용 광역 count 캐시는 이 경로에 적용되지 않는다. “오늘”은 시계상 오늘이 아니라 **최신 가용 공시일**이다.
- `backend/prisma/schema.prisma:286` 및 `backend/prisma/migrations/20260308100000_natural_key_pk/migration.sql:38`: 일반 `rcpDt` 인덱스는 정의돼 있으나 prefix 조회가 반드시 범위 스캔한다는 주석은 실제 실행계획으로 확인해야 한다. PostgreSQL의 LIKE 인덱스 사용은 collation/operator class 조건의 영향을 받는다. [공식 문서](https://www.postgresql.org/docs/current/indexes-opclass.html).
- 별도 운영 진단 범위가 승인되면 배포 revision·적용 인덱스·collation·쿼리별 대기/실행 시간을 확인해 최신일 조회, count, 연결 풀 대기를 구분한다. 현재는 어느 단계가 느린지 미확인이다. `mobile/services/api.ts:16`의 10초 제한과 같은 수준의 지연이므로 앱에서도 요청 만료 가능성이 있다. 추정에 따른 쿼리·인덱스·timeout 변경은 하지 않았다.

## 사용자가 직접 준비할 등록 절차

기존 시세 연동이 한국투자증권(KIS)이므로 첫 후보로 조사했다. 다른 증권사를 선택하면 주문 API/인증/모의환경을 다시 검토해야 한다. 여기서는 가입이나 실주문을 대신 수행하지 않는다.

1. 본인 명의 한국투자증권 국내주식 거래 가능 계좌와 HTS ID를 준비하고 계좌를 ID에 연결한다. 새로 개설하는 경우 본인 인증은 사용자가 수행한다.
2. [KIS Open API 서비스 신청](https://securities.koreainvestment.com/main/customer/systemdown/RestAPIService.jsp)에 로그인하여 해당 계좌의 서비스를 신청한다. 접근 시 로그인 페이지로 이동하는 것까지 확인했다.
3. 먼저 모의투자를 신청하고 해당 모의 계좌의 App Key/App Secret을 발급한다. 실전용과 모의용 키는 별도다. 필요한 설정 항목은 HTS ID, 계좌 앞 8자리/상품 코드 2자리이며 본문·채팅·스크린샷·Git에 값을 공유하지 않는다. [KIS 공식 시작 안내](https://github.com/koreainvestment/open-trading-api/blob/main/README.md).
4. 키는 추후 구현되는 안전한 등록 화면/비밀 저장소에서 직접 입력한다. 현재 앱에는 실계좌 등록 화면이나 주문 adapter가 없으므로, 발급만으로 이 앱에서 거래가 시작되지 않는다.
5. KIS 모의 계좌에서 조회 → 지정가 주문 → 미체결 조회 → 취소 → 체결 통보/잔고 대조를 검증한 뒤, 승인한 소액 한도·손실 한도·운영시간으로 실전 전환을 별도 결정한다. 테스트 중에도 모의/실전 호스트·키·계좌 혼용은 금지한다.

KIS 공식 포털은 HTS ID 변경과 모의 계좌 불일치 관련 안내를 게시하고 있으므로 신청 직전에 [공식 공지](https://apiportal.koreainvestment.com/)도 확인한다. 여러 사용자에게 앱을 배포해 그들의 계좌를 연결하거나 데이터를 재배포하는 경우에는 개인용 키 이용과 다르므로 [KIS 제휴 안내](https://apiportal.koreainvestment.com/provider-doc2) 및 데이터 이용약관 적용을 별도 확인해야 한다. 이 문서는 법률 적합성 판정이 아니다.

## GPT API 설명 문장에 Humanizer 적용

사용자의 추가 요청에 따라 `humanizer` skill 3.1.0(MIT)의 embedded mode를 `engine2-ai-analyst/tasks/humanizer-ko.prompt.ts`에 금융 설명용 `humanizer-ko.v1`으로 요약했다. 분석→문장 내 어색한 패턴 확인→수정→사실 보존 점검을 기존 API 호출 하나의 system 지침에 포함한다. 앱에 API key나 모델을 추가하지 않고 별도 rewrite API 호출도 만들지 않는다.

| Task | 문장 편집 대상 | 변경하지 않는 값 |
| --- | --- | --- |
| summary | summary, positiveFactors[], negativeFactors[] | polarity, 원문 사실·수치·날짜·단위 |
| persona-interpretation | personas[].interpretation | persona enum, fitScore |
| position-thesis | initialThesis, riskNotes | invalidConditions 기계 조건, buyScore, Rule/Risk/주문 결정 |
| price-move-reasoning | cause, evidence[], caveat | eventLinkage, 출처/근거 ID, 인과관계의 불확실성 |
| event-classification | 미적용 | 분류 task 전체 유지 |

결론 우선의 중립적인 한국어를 쓰고 반복·장식·홍보성 표현을 줄인다. 위험 경고를 삭제하거나 새 근거·수익 보장·매매 지시를 만들지 않도록 명시한다. 기존 JSON mode와 필드 화이트리스트 validator를 유지한다. JSON mode 자체는 schema 일치를 보장하지 않으므로 문체 지침으로 validator를 대체하지 않는다. [OpenAI 공식 JSON mode 문서](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode).

기존 멱등 캐시는 그대로 재사용한다. 따라서 이미 저장된 과거 분석 문장은 자동으로 다시 쓰지 않으며, 적용 후 새로 생성하는 분석부터 새 지침을 사용한다. 실제 모델 응답의 의미 보존과 문장 품질은 별도 표본 검수가 필요하다. mock API 계약 테스트는 지침 전달·호출 횟수·JSON/수치/enum 보존을 검증하며 실제 LLM 품질이나 비용을 측정한 것은 아니다.

## 아직 사용자 결정이 필요한 내용

- 개인 전용 Agent인지, 다른 사용자의 자산까지 연결하는 서비스인지.
- 한국투자증권을 첫 주문 브로커로 확정할지, 사용 가능한 모의 계좌가 있는지(키 값을 보내지 않아도 됨).
- 폰이 꺼지거나 통신이 끊겼을 때 보유 포지션을 보호하는 외부 비상 실행을 허용할지.
- 종목당/일간 최대 손실, 총 운용 자금, 최대 동시 보유, Shadow 졸업 기간·표본·성과 기준.
- 기본 2~20거래일 스윙을 유지할지. 이번 “단기” 표현만으로 당일 초단타/신용/공매도를 추가하지 않는다.
- 계좌 귀속이 확인되지 않는 기존 simulation 기록을 격리할지, 증거가 있는 기록만 이관할지. 소유 계좌를 추정해 원장을 채우지 않는다.
- 실데이터 Shadow/Backtest 검증에 사용할 기간·시장 국면·종목 범위와 종가/공시의 당시 가용시각 증거를 어디까지 확보할지. 위 합성 22개 점검만으로 졸업시키지 않는다.

이 결정들은 코드·샘플의 숫자를 운영 승인값으로 승격시키지 않고 별도 version/approval 원장에 남겨야 한다.
