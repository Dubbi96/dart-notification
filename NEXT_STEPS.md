# 다음 단계 (2026-07-17 에디션·실시간성 웨이브 반영)

> **정본 위임**: 남은 작업의 단일 기준은 [docs/roadmap/cc-resume-plan-2026-07-02.md](./docs/roadmap/cc-resume-plan-2026-07-02.md) — 특히 **§7(세션 처리 결과·PR 체인·머지 순서)**. 갭분석 퀵윈 웨이브의 정본은 [docs/roadmap/cc-app-improvement-plan-2026-07-15.md](./docs/roadmap/cc-app-improvement-plan-2026-07-15.md).
> 이 파일은 요약 포인터만 유지한다.

## 현재 위치

- **AOS Phase A2 안전 기반 완료·정책 폐쇄 대기** — #551 Strategy/Rule Versioning, #555 KRX 종가 후 `VersionActivation`, #557 `RiskPolicyVersion`, #559 `ApprovalRecord`·`ConfigAuditEvent` 불변 원장까지 구현. 승인 quorum·role key·계정 범위는 미확정이라 실제 정책·seed·활성화 결합을 임의 구현하지 않는다.
- **AOS Phase A3 착수** — #561에서 런타임 dependency 0의 디바이스·서버 공용 결정적 Rule Evaluator 코어를 구축. Feature Snapshot 생성·영속화/dual-write → SignalDecision 순으로 연결하며, 그 전까지 기존 Signal/Paper/Order 행동은 바꾸지 않는다.
- **다음 순서** — A3-2 Feature Snapshot 계약·point-in-time hash·legacy dual-write → A3-3 server/device parity fixture와 SignalDecision shadow 기록. A2 미결정값이 확정되면 별도 이슈로 quorum/RBAC·Risk/Strategy 활성화를 폐쇄한다.
- **M0~M9 완료** — 공시 수집(264만건)·파싱·이벤트추출·AI 분석·시세·Event Study·매수신호·포트폴리오/Exit·백테스트, OCI prod 라이브(v0.1.1)
- **M10 진행 중** — 모의매매 5트랙 운용 누적 중. **졸업 앵커 ≈ 2026-08-05** (구 `≈7/21`은 PM 1주기 계획 §6·게이트 백로그 [DAR-529]로 8/5 대체)
- **M11 보류 확정** — Track B 재검증 1회차 불합격(BLOCKED 역예측 반전, [baseline §6](./docs/roadmap/buy-logic-validation-baseline.md))
- **2026-07-17 웨이브 완료** — 일일 투자판단 에디션(조회 API·홈/신호탭·발행 푸시)·실시간성/급변동 리즈닝·예정 이벤트 캘린더·알림 설정 센터 v2·브로커 핸드오프 등 ~40 PR 통합(아래 §2026-07-17 웨이브)

## 사용자 실행 필요 (머지·클로즈)

- [ ] **PR 체인 머지** (재개 계획 §7-1): 문서 #428→#429→#434 · 백엔드 #430 · UX #424→#425→#431→#432→#433
- [ ] 오픈 PR #388/#389 클로즈 — 중복 확정: `gh pr close 388 389`
- [ ] 머지 후: OCI 백엔드 재배포(#430) + APK 재빌드(EAS oci 프로파일, 모바일 UX 반영)

## 처리 완료 (2026-07-02)

- [x] 시한부 테스트·졸업 게이트 G6/G7·승패 정의 통일 (PR #430, jest 3254 그린)
- [x] #424/#425 상호평가 4/4 PASS (머지만 대기)
- [x] Track B 재검증 1회차 — 불합격 판정·후속 진단 3건 도출
- [x] Track E P1+P2 문서 현행화 (PR #434)
- [x] Track F UX 72/76건 구현 (PR #431/#432/#433, check 124/124)
- [x] 로컬 브랜치 255개 정리 · DB 복원 검증

## 잔여 트랙 (상세: 재개 계획 §3·§7-3)

- [ ] **Track A** M10 졸업 — 라이브AI(SMOKE_LLM) 상시 가동 + ≈7/21 졸업 게이트 측정(#430 머지 후)
- [ ] **Track B 후속** — BLOCKED 조건 분해 진단·WATCH 재설계·calibration 공백 → 해소 후 재검증 2회차
- [ ] **Track C** M11 — M10 졸업 + Track B 합격 전 착수 금지. 착수 전 phase-13 현행화 필수
- [ ] **Track D** 운영 — FCM V1 서버키(대화식), ARM 확보 루프, 스토어 출시 준비
- [ ] **Track E 잔여** — P3(비전·엔진아키·MVP정의·phase 문서) → P4(README·QUICK_START 전면 재작성 등)
- [ ] **Track F 잔여** — 에뮬레이터 인터랙션 실기 패스(cc-ux-review §6) + 머지 후 재검증 미니 패스 + W1 코치마크

## 2026-07-17 웨이브 완료 (에디션·실시간성·캘린더·핸드오프 — ~40 PR, #482~#523)

퀵윈 웨이브 후속으로 '일일 투자판단 에디션'을 축으로 실시간성·급변동 설명·예정 이벤트·알림 거버넌스를 하루에 통합. 테마별 요약(정본은 각 이슈·PM 1주기 계획 [cc-pm-cycle1-plan-2026-07-17.md] / 게이트 백로그 [cc-gate-backlog-2026-07-17.md]):

- [x] **일일 투자판단 에디션(뉴스형)** — 조회 API 2종(daily-editions·daily/:date, 읽기 파생 [DAR-505]) + 홈 '최신 에디션 요약' 슬롯 [DAR-508/517] + 신호탭 날짜 스트립 브라우징 [DAR-509] + SignalDateBadge/신선도 SSOT [DAR-506] + 조회 훅·by-corp 이관 [DAR-507] + 게스트 CTA·헤더 정직화 [DAR-504/518] + 에디션 밀도 실측 [DAR-513] + snake_case 교정 [DAR-519]
- [x] **에디션 발행 푸시 [Wave B]** — 평일 19:05 발행 푸시·빈 에디션 발송 금지 하드 가드·editionPushEnabled 게이트·멱등·캡 [DAR-523] + 본문 '한 줄 판단' 표준(유사공시 D+5 반응통계·n<30 폴백) [DAR-525] + 딥링크 '해당 호' 직행·신호탭 '놓친 호' 뱃지 [DAR-527/533] + standalone APK FCM e2e 실측 [DAR-521]
- [x] **'왜 움직였나' 급변동 리즈닝 [Wave C]** — PRICE_MOVE 역방향 리즈닝 AI Task(48h 공시 원인 역추적) [DAR-522] + 카드 배선 GET /price-move-reasonings/:refId·PRICE_MOVE 딥링크 [DAR-526] + 3상태 정직화 [DAR-524] + 재무 맥락 한 줄(resultJson.financialContext) [DAR-528/534]
- [x] **알림 거버넌스·계측 [Wave A]** — 알림 설정 센터 v2(계열별 on/off·보수적 기본값·일일 캡) [DAR-514] + 유사공시 반응 통계 API(D+1/5/20·n≥30 정직 게이트) [DAR-511]·공시 상세 표준 섹션 [DAR-512] + 테스터 코호트 계측·iOS 게이트 설문 [DAR-516]
- [x] **예정 이벤트 캘린더** — 공시발 예정 이벤트 v1(보호예수 해제·청약 D-day, 읽기 전용) [DAR-538] + 전체 화면·관심종목 D-day 목록 [DAR-541]
- [x] **데이터/운영 견고화** — 개장 직후 유령 분봉 진입 봉인(실데이터일 적재 거부·스캐너 미래봉 하드가드) [DAR-531 P0] + DART 쿼터 재기동 영속화 [DAR-532]·야간 쿼터 포렌식 [DAR-536] + forward 공시 갭 복구 [DAR-434] + freshness 제로런 휴장일 오탐 억제 [DAR-515] + INSIDER_HOLDINGS 회귀 고정 [DAR-540]·paper-sim 스펙 격리 [DAR-539]
- [x] **UX·온보딩·핸드오프** — 관심종목 콜드스타트 온보딩(승격형 코치마크) [DAR-537] + 홈 저장공시 '보관함' 명명 [DAR-520] + 신호탭 구 14일창 큐레이션 폐기 [DAR-535 cut#6] + 브로커 앱 핸드오프 딥링크 v1('증권사 앱에서 열기') [DAR-545] + Maestro 에뮬 스모크 하니스 3플로우 [DAR-542]
- [x] **게이트·문서 정본** — 게이트 백로그 8항목 정본화(착수 금지·조건 개방) [DAR-529] + 아침 다이제스트 go/no-go 게이트 기준 [DAR-530] + PM 1주기 플랜·에디션 설계 정본 커밋(#521)

## 갭분석 퀵윈 웨이브 완료 (2026-07-15~16, 정본: [cc-app-improvement-plan-2026-07-15.md](./docs/roadmap/cc-app-improvement-plan-2026-07-15.md))

경쟁력 갭 분석(약점 17건) 퀵윈 20레인(구현 17 + 문서 3) 전부 `integration/gap-2026-07-15` 통합 완료 — 백엔드 jest 4,261 그린·모바일 jest 38 그린·tsc 0·build 0.

- [x] **W0 스키마 토대** — User.tier·ProWaitlistEntry·InvestorFlowDaily·ShortSellingDaily·SearchMissLog·FunnelEvent·PRICE_MOVE/EARNINGS_GUIDANCE enum (가산적 단일 마이그레이션 `20260715230700`)
- [x] **W1 수익모델 토대** — Pro 사전신청 서버 영속화(3 엔드포인트) + 관심기업 한도 tier 게이트(FREE 30)
- [x] **W2 데이터 출처 표기** — 출처 귀속 컴포넌트 + 데이터 출처·라이선스 고지 화면
- [x] **W3/W3b Play 컴플라이언스·유통** — expo-updates(stale APK 구조 해소)·계정 삭제(DELETE /users/me + 탈퇴 UI)·법적 고지 공개 URL·공유 페이지(GET /share/:rcpNo)·랜딩(GET /)
- [x] **W4 신호 검증** — 제목 기반 이벤트 백필(매일 02:40, DART 0·AI 0) + 백테스트 11년 창/Track B 재검증 러너 정비
- [x] **W5 리얼타임성** — 장중 1분 델타 폴링(지연 ~10분→~90초) + 감지→푸시 지연 계측(GET /ops/notification-latency)
- [x] **W6/W7 급변동 알림** — 관심종목 ±5% 5분 틱 감시(PRICE_MOVE) + 무공시 변동 '관련 공시 없음' 정직 병기
- [x] **W8 해외 수요 계측** — 제로결과 검색 SearchMissLog + 원탭 수요 버튼(POST /search/us-demand) + EDGAR PoC 스파이크
- [x] **W9 실적 정직 라벨** — YoY 기준 라벨 + EARNINGS_GUIDANCE 분류·추출 신설
- [x] **W10 AI 커버리지** — 커버리지 계기판(GET /ai-cost/coverage)·비용캡 ENV화·빈 카드 기대치 UX
- [x] **W11/W12 운영 가시성** — 제로런 감지 증축(zeroRunThreshold) + 공개 /status 페이지 + 앱 내 문의 표면
- [x] **W13 데이터 자산 개방** — 지표 조회 API(GET /market-data/indicators) + 차트 MA/볼린저 오버레이 + 신호 근거 지표 섹션
- [x] **W14 오늘의 브리핑** — GET /portfolio/briefing/today (LLM $0 룰 조립) + 포트폴리오 탭 카드
- [x] **W15 품질 게이트** — jest-expo 유닛(모바일 38) + Maestro 스모크 6플로우 + 온보딩 퍼널 계측(POST /ops/funnel)
- [x] **W16 수급·공매도 축** — EOD 수집기(3슬롯·KRX→KIS 체인·publishedDate T+2) + 조회 API + 수급 요약 카드 (SHADOW)
- [x] **W17 보안 태세** — CI 보안 잡(npm audit allowlist 게이트 + gitleaks)·dependabot·Swagger prod 게이트
- [x] **문서 3레인** — 수익화 계획 SSOT(cc-monetization-plan.md)·컴플라이언스 원장 3종(docs/compliance/)·오너 액션 패키지(cc-owner-actions-2026-07-16.md)
- [x] **공유 문서 동기화** — api-specification·workflow·PROJECT_STRUCTURE·로드맵 C-트랙/M13A 정합·계획 정본화 (이 커밋)

### 남은 오너 액션 (정본: [cc-owner-actions-2026-07-16.md](./docs/roadmap/cc-owner-actions-2026-07-16.md))

- [ ] Google Play 테스터 클록 기동 (12명×14일 — 즉시 시작해야 M10 졸업 ≈8/5와 동시 공개 가능)
- [ ] 실도메인 구매·Caddy 전환 (nip.io 탈피)
- [ ] KRX 데이터 라이선스 서면질의 발송 (초안: docs/compliance/krx-inquiry-draft-2026-07.md — 회신 수 주)
- [ ] UptimeRobot 외부 사망감시 등록 (/status 프로브)
- [ ] JWT 시크릿 로테이션
- [ ] EAS Update 채널 생성 (production/preview/oci) + 첫 eas update 발행
- [ ] APK 재빌드·재배포 (expo-updates 포함 바이너리부터 자동 업데이트 유효)

### 후속 작업 (플릿/세션)

- [ ] 백테스트 11년 창(2015~2026) two-tier 실행 (`npm run backtest:two-tier -- 20150101 <endDate>` — 수 시간·DB 부하 주의)
- [ ] Track B 재검증 2회차 실행 (`POST /api/backtest/replay`) → buy-logic-validation-baseline.md 갱신
- [ ] Maestro 스모크 에뮬레이터 실행 (Android 에뮬레이터 + maestro CLI + dev-login 딥링크 — 통과 증거 첨부)
- [ ] 제목 이벤트 백필 최초 대량 트리거 (`POST /pipeline/title-event-backfill`) 후 토요일 Event Study 재집계 확인
- [ ] prod 배포 후 수급 수집 첫 사이클(20:00/21:30/07:40)·델타 폴링 쿼터 소비 실측 관찰

---
**마지막 업데이트**: 2026-07-31 (AOS Phase A3-1 디바이스·서버 공용 결정적 Rule Evaluator 착수) / 이전: AOS #559
