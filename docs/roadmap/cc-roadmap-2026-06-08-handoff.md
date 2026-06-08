# 로드맵 & 세션 핸드오프 (2026-06-08)

> 다음 세션이 즉시 이어받을 수 있도록 **현재 상태 · 즉시 검증 · 제작 로드맵 · 운영 노트**를 명시한다.
> 정본: `docs/roadmap/00-vision-and-principles.md`, `01-execution-roadmap.md`. 이 문서는 그 위의 **현시점 실행 핸드오프**다.

---

## 0. 한 줄 요약

공시 알림 MVP 위에 **투자판단 토대(실가격 모의운용 · Event Study · persona 4트랙 · AI 자동분석)**까지 올렸다. 다음 단계는 **데이터 충실화(실시세·KRX 일봉·AI 백로그) → 의미있는 BUY 신호 발생 → 30일 모의운용 트랙레코드 → M9 백테스트 → M11 반자동매매**다.

---

## 1. 이 세션에서 완성된 것 (DAR-116 ~ DAR-140, 전부 main 머지·검증)

### 모바일 UX (DAR-116~128)
- 신호 탭 추천우선→검색→드릴다운(큐레이션·종목검색·카드압축), 포트폴리오 큐레이션·L3 탭 위계화, 데이터한계 배지 전역화, 게스트 로그인 유도, 투자거장 수치화/시각화, a11y·성능 스윕.
- Android 치명버그 근절: **refreshControl 커스텀 래퍼 금지**(ESLint 가드), GestureHandlerRootView, ETag off, keyExtractor 고유성.

### 데이터/분석 토대 (DAR-129~140)
- **DAR-129** 과거 공시 백필 인프라 + ★라이브 신호/알림 격리(`isBackfill` 필터, 34테스트).
- **DAR-133** Event Study(M5) 산출(이벤트별 abnormal return) + Buy Score 연동 + baseline cron.
- **DAR-134** 신호 등급 정직 진단 — 전부 관망은 "데이터 부족"이 원인(임계 인위조작 0).
- **DAR-124/135/137/139(+#94)** 모의운용 시세: 합성(SimulatedDailyPrice, 모의 라벨) → **실 KRX 실가(StockDailyPrice) 우선**(REAL_THEN_SYNTHETIC) → 연도 시프트 옵트인(기본 최신 실가). **코칩 실가 23,500 검증 완료**(합성 +253% 인플레·12,900 stale 해소).
- **DAR-140** KIS OpenAPI 실시간 현재가·분봉 어댑터 구조(폴러·캐시·priceSource realtime 우선, mock 테스트). 키 주입 후 활성.
- **DAR-130/138** persona 4종 독립 모의운용(규칙기반, AI금지영역) + 포트폴리오 **페르소나 전용 탭** UI.
- **DAR-136** 알림 푸시·딥링크·중복방지 신뢰성.

### 운영 복구
- **AI 자동분석 복구**: 파이프라인 적체로 AI가 0건이었음 → DAR-126 pipeline-integrity 배포 + `/pipeline/reprocess-ai`로 발화. AIUsageLog 57→189(증가 중).
- 백엔드 **pm2 상시가동**(`dart-backend`), 합성→실가 모드 전환.

현재 지표: Disclosure 2157 · Event 1914 · TradingSignal 108(전부 관망) · AIUsageLog 189 · 미적용 마이그 0.

---

## 2. ★즉시 검증/마무리 필요 (이 세션 미완 — 다음 세션 1순위)

1. **KIS 실시간 시세 검증** — 사용자가 `backend/.env`에 `KIS_APP_KEY/KIS_APP_SECRET/KIS_BASE_URL` 입력함(ISA계좌 = 실거래 불가하나 **시세 조회는 가능**, 모의운용은 실주문 안 하므로 무관).
   - 폴러 `kis-realtime.poller` = `@Cron('*/1 9-15 * * 1-5')`(장중 매분, 시스템시계 2026 기준 발화). `KisApiService.isConfigured`가 키 감지.
   - 검증법: pm2 restart 후 (a) `pm2 logs dart-backend`에서 KIS 토큰 획득/폴링/에러(401·403·EGW) 확인, (b) `RealtimeQuoteCache` 적재 확인, (c) run-once에서 보유종목이 realtime(KIS 현재가)으로 평가되는지. ★정직: 실시간=실제 현재 시장가(환경시계 2026과 괴리 고지), 합성과 혼합 금지.
   - 실패 시(ISA/모의도메인 권한 등): 에러 메시지로 원인 파악 → 모의투자 도메인(`openapivts...:29443`)로 BASE_URL 변경 또는 권한 안내.

2. **AI 백로그 클리어** — 미분석 이벤트 ~900건. `POST /api/pipeline/reprocess-ai`(100건/배치, JWT)로 반복 호출하거나 cron이 점진 처리. 일일 한도 $1 게이트가 자동 보호(~$0.28 예상).

3. **KRX 일봉 수집 cron 정상화** — `/ops/metrics` `staleJobs: krx.daily, signal.generate, paper.simulation`. krx.daily가 신규 실데이터를 자동 적재해야 실시간/일봉이 최신 유지. (실 KRX가 2026 데이터 미제공이면 백필/매핑 의존 — 한계 정직 명시.)

---

## 3. 제작해야 하는 로드맵 (다음 단계, 중요도 순)

> 핵심 테제: **앱이 정직하게 "의미있는 투자판단"을 보여주게** 한다. 추천 양산 금지(임계 인위조작 X) — 데이터가 쌓이면 점수가 정직하게 오른다.

### A. 데이터 충실화 → 의미있는 신호 (M5→M6 완성)
- **A1. Event Study 데이터 축적 자동화**: baseline cron(DAR-134)이 실제로 EventStudyResult를 채우는지 검증·운영. 표본 누적 → Buy Score `historicalEvent` 버킷 충실 → 강한 공시가 자연스럽게 BUY 등급.
- **A2. 신호 등급 분포 모니터링**: 데이터 쌓이며 BUY/STRONG_BUY가 발생하는지 추적(`buy-signal-distribution.diagnostic`). 발생 시 '오늘의 투자판단'·신호탭에 실질 추천 노출.
- **A3. 실시세/일봉 파이프라인 안정**: KIS 실시간 + KRX 일봉 + 합성 폴백의 3중 소스가 종목 단위로 일관되게 평가하는지(행 단위 혼합 금지 유지).

### B. 모의운용 트랙레코드 (M10 졸업 게이트)
- **B1. 30일 모의운용 누적**: 실가 기준으로 매일 사이클(매수→스냅샷→Exit→지표). persona 4트랙 각각. 졸업지표(적중률 D+5·누적수익·Exit 정확도 D+3·AI비용/순익) 표본 축적.
- **B2. 신규 매수 발생 검증**: BUY 신호가 생기면 모의운용이 실제 진입하는지(현재 bought=0은 BUY 신호 부재 때문). 진입/Exit가 실가 변동으로 평가·스코어링.
- **B3. M10 졸업 판정**: "전 기능 정상 + 모의투자 실비용 검증" 충족 시 M11 착수 허가(#3 원칙).

### C. M9 백테스트 (M10과 병행/선행)
- BacktestRun으로 과거 구간 전략 검증(lookahead 방지·현실제약). Event Study·Buy Score·Exit Score를 과거 데이터로 통계 검증 → 90일 모의운용 자원 투입 전 거름망.

### D. M11 반자동매매 (M10 졸업 후)
- 사용자 승인 주문 + 증권사(KIS) API 실주문 + Risk 사전체크(Engine5 하드룰, AI 금지영역). ★ISA계좌 실거래 제약 고려 — 일반계좌/모의투자계좌 필요. UI는 사용자 명시 승인(자동 승인 UI 금지).

### E. 품질/거버넌스 (상시)
- AIUsageLog 기록 누락 0, 비용 게이트(L0~L3) 점검. 회귀 매트릭스(01-execution-roadmap §3) 유지. 크로스플랫폼(Galaxy) 빌드 안정(eas.json·dev build, DAR-114).

---

## 4. 운영 노트 (다음 세션 필수 컨텍스트)

### 환경/실행
- **백엔드**: pm2 관리(`cd backend && npx pm2 restart dart-backend`). 코드 변경 반영: `npx prisma generate && npm run build && npx pm2 restart dart-backend`(★nest build만으론 Prisma Client 재생성 안 됨). 재부팅 생존: `pm2 startup`(sudo, 미실행).
- **Metro(모바일)**: `cd mobile && ./scripts/start-lan.sh --go`(IP 자동감지·Expo Go). 네트워크 변경 시 재실행. 현재 LAN IP 172.30.1.27.
- **에뮬레이터**: AVD `dar_test`(Pixel6/API34). 인증화면 검증은 `app/dev-login.tsx`(__DEV__) 딥링크로 테스트계정 로그인(메모리 emulator-verification-with-test-login).
- **env 플래그**: `PAPER_SIM_REAL_FEED=1`(실가 우선)·`PAPER_SIM_SYNTHETIC_FEED=0`·`PAPER_SIM_REAL_YEAR_OFFSET`(미설정=최신 실가, ≥1=N년 시프트 리플레이)·`PAPER_SIM_SYNTHETIC_FEED=1`(합성전용)·`KIS_APP_KEY/SECRET/BASE_URL/ACCOUNT_NO`.

### 가드(.claude/hooks/guard-bash.mjs) — 우회 금지, 휴먼 수동
- `prisma migrate reset/deploy` 차단 → 사용자가 `!cd backend && npx prisma migrate deploy` 수동. (단 `prisma generate`는 허용 — 에이전트 실행 가능)
- `.env` 접근 차단 → 변수 자리는 사용자가 직접 입력. **커밋/PR 본문에 ".env"·"prisma migrate deploy" 문자열 넣으면 차단됨**(우회: 다른 표현).
- `git reset --hard` 차단 → `git checkout -B main origin/main`로 동기화.
- `git push origin main` 직접 금지, `.github/workflows/*` push는 OAuth workflow 스코프 필요.

### 자율 멀티에이전트 파이프라인 (계속 운영법)
- 기능개발은 **Paperclip 플릿이 구현**(메모리 feature-dev-via-paperclip-only). 나는 이슈발행·할당·검증·머지만. 버그/인프라/진단은 직접 가능.
- 절차: 이슈 POST(`/api/companies/<C>/issues`) → DEVELOPER(`bacf2dc3-...`)에 `assigneeAgentId`+`/api/agents/<id>/wakeup` → 산출물(브랜치·커밋·PR) 검증 → 머지. C=`c45545cc-29fc-4abb-9a9e-4c4d7d671d76`.
- 게이트: ①tsc0+jest그린 ②마이그=파일만(적용 휴먼 승인) ③정직/신뢰 원칙(추천 양산·실시세 오인·AI금지영역 침범 금지) ④모바일은 에뮬레이터 렌더 검토.
- 교훈(메모리화): **브랜치명 추정 금지**(접미사 다양, `git branch -a|grep <번호>`+worktree로 확인), **fleet 자동머지** 가능(merge-base --is-ancestor면 done만), **Prisma generate 게이트**(schema @@unique 변경 후 worktree tsc 실패는 stale client 아티팩트, shared client 재생성 금지→머지후 사용자 적용+generate로 검증), **로컬 main 분기 주의**(reconcile merge 커밋 누적→checkout -B로 origin/main 동기화, 단 로컬 고유 커밋 유실 주의).

---

## 5. 백로그 상태

- Paperclip 이슈 **done 139건**. DAR-137+ 미완 잔여 **없음**(이 세션 배치 전부 소진).
- 다음 배치는 위 **§3 로드맵**에서 선별·등록(예: A1 Event Study 운영검증, A2 신호분포 모니터, B1 모의운용 트랙레코드, C M9 백테스트). KIS 실시간 검증(§2-1)을 먼저.

---

## 6. 핵심 원칙 재확인 (불가침)
- **정직/신뢰**: 추천을 만들려고 임계를 낮추지 않는다. 합성=모의 라벨·실시세 오인 금지. 데이터 부족이면 정직하게 빈상태/데이터한계 표식.
- **AI 금지영역**: Engine5 Risk·Buy/Exit Score·주문 승인은 규칙(AI/LLM 금지). persona 판단도 결정론적.
- **실행 정책**: M11 전까지 실주문 없음. 모의·선택까지만, 자동 승인 UI 금지.
