# 다음 단계 (2026-07-16 갭분석 퀵윈 웨이브 반영)

> **정본 위임**: 남은 작업의 단일 기준은 [docs/roadmap/cc-resume-plan-2026-07-02.md](./docs/roadmap/cc-resume-plan-2026-07-02.md) — 특히 **§7(세션 처리 결과·PR 체인·머지 순서)**. 갭분석 퀵윈 웨이브의 정본은 [docs/roadmap/cc-app-improvement-plan-2026-07-15.md](./docs/roadmap/cc-app-improvement-plan-2026-07-15.md).
> 이 파일은 요약 포인터만 유지한다.

## 현재 위치

- **M0~M9 완료** — 공시 수집(264만건)·파싱·이벤트추출·AI 분석·시세·Event Study·매수신호·포트폴리오/Exit·백테스트, OCI prod 라이브(v0.1.1)
- **M10 진행 중** — 모의매매 5트랙 운용 누적 중(30일 도달 ≈ 2026-07-21)
- **M11 보류 확정** — Track B 재검증 1회차 불합격(BLOCKED 역예측 반전, [baseline §6](./docs/roadmap/buy-logic-validation-baseline.md))

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
**마지막 업데이트**: 2026-07-16 (갭분석 퀵윈 웨이브 문서 동기화) / 이전: 2026-07-02 (수정 개발 세션)
