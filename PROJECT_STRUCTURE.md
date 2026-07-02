# 프로젝트 구조

## 전체 디렉토리 구조

```
dart-notification/
├── backend/                    # NestJS 백엔드
│   ├── prisma/
│   │   ├── migrations/        # DB 마이그레이션 파일
│   │   │   └── 20260307131416_init/
│   │   │       └── migration.sql
│   │   ├── migration_lock.toml
│   │   └── schema.prisma      # Prisma 스키마 (provider/providerId on User)
│   ├── src/
│   │   ├── auth/              # 인증/인가 모듈 (카카오 OAuth)
│   │   │   ├── dto/
│   │   │   │   ├── kakao-auth.dto.ts    # 카카오 OAuth DTO
│   │   │   │   ├── login.dto.ts
│   │   │   │   ├── signup.dto.ts
│   │   │   │   └── refresh-token.dto.ts
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   ├── optional-jwt-auth.guard.ts
│   │   │   │   └── jwt-refresh.guard.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── jwt-refresh.strategy.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   └── auth.module.ts
│   │   ├── users/             # 사용자 관리
│   │   │   ├── dto/
│   │   │   │   └── update-user.dto.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   └── users.module.ts
│   │   ├── devices/           # 디바이스 토큰 관리
│   │   │   ├── dto/
│   │   │   │   └── register-device.dto.ts
│   │   │   ├── devices.controller.ts
│   │   │   ├── devices.service.ts
│   │   │   └── devices.module.ts
│   │   ├── companies/         # 기업 마스터
│   │   │   ├── companies.controller.ts
│   │   │   ├── companies.service.ts
│   │   │   └── companies.module.ts
│   │   ├── watchlist/         # 관심 기업 목록
│   │   │   ├── dto/
│   │   │   │   ├── create-watchlist.dto.ts
│   │   │   │   └── update-watchlist.dto.ts
│   │   │   ├── watchlist.controller.ts
│   │   │   ├── watchlist.service.ts
│   │   │   └── watchlist.module.ts
│   │   ├── notification-settings/  # 알림 설정
│   │   │   ├── dto/
│   │   │   │   └── update-notification-settings.dto.ts
│   │   │   ├── notification-settings.controller.ts
│   │   │   ├── notification-settings.service.ts
│   │   │   └── notification-settings.module.ts
│   │   ├── engine1-disclosure/ # 🟦 Engine1: 공시 인텔리전스 도메인 (DDD Bounded Context)
│   │   │   ├── CLAUDE.md            # 도메인 규칙 (작업 시 자동 로드)
│   │   │   ├── disclosures/         # 공시 조회 (GET /disclosures)
│   │   │   ├── scheduler/           # 수집 배치 (DART 폴링·재시도) — M0
│   │   │   ├── dart-api/            # DART OpenAPI 클라이언트
│   │   │   ├── disclosure-documents/ # 원문 파싱 (HTML/XML/표·정정 diff) — M1
│   │   │   └── disclosure-events/   # 이벤트·수치 추출 (extractors) — M2
│   │   ├── engine2-ai-analyst/ # 🟨 Engine2: AI Analyst 엔진 (M3, DAR-17)
│   │   │   ├── CLAUDE.md
│   │   │   ├── tasks/               # 4개 AI Task (summary·event-classification·persona·thesis)
│   │   │   ├── cost-gate/           # AI 비용 게이트 L0~L3 분기
│   │   │   ├── cost-metrics/        # CostPerDisclosure/Signal/Trade 지표
│   │   │   ├── cost-aggregation/    # AIUsageLog 기간별 집계
│   │   │   ├── usage-log/           # AIUsageLogService
│   │   │   ├── llm/                 # LLM API 클라이언트 (OpenAI/Claude)
│   │   │   ├── adapters/            # LLM 어댑터 (구현체)
│   │   │   ├── ports/               # 포트 인터페이스
│   │   │   ├── input/               # 공시 입력 빌더
│   │   │   ├── pricing/             # 모델별 토큰 단가
│   │   │   ├── validation/          # AI 응답 검증
│   │   │   ├── types/               # 타입 정의
│   │   │   ├── consumers/           # BullMQ 컨슈머 (ai-analyze 큐)
│   │   │   ├── backfill/            # AI 평가 백필 드레이너·스케줄러 (과거 미분석 공시, DAR-379)
│   │   │   ├── smoke/               # 스모크 테스트
│   │   │   └── ai-analyst.module.ts
│   │   ├── engine3-quant-market/ # 🟧 Engine3: Quant Market 엔진 (M4~M6, M9, DAR-25)
│   │   │   ├── CLAUDE.md
│   │   │   ├── market-data/         # KRX/증권사 시세 수집 (Phase 5+)
│   │   │   ├── indicators/          # 기술지표 계산 (MA/RSI/MACD/BB/ATR/VWAP)
│   │   │   ├── buy-signal/          # Buy Score 7컴포넌트 계산 (Rule 기반)
│   │   │   │   ├── config/
│   │   │   │   ├── entry/
│   │   │   │   └── scoring/
│   │   │   ├── event-study/         # Event Study 집계 (DAR-9)
│   │   │   │   ├── adapters/
│   │   │   │   ├── ports/
│   │   │   │   └── utils/
│   │   │   ├── backtest/            # 백테스트 엔진 (DAR-13)
│   │   │   │   ├── constraint/
│   │   │   │   ├── dto/
│   │   │   │   ├── metrics/
│   │   │   │   └── ports/
│   │   │   ├── signals/             # REST API — /api/signals [DAR-25: signals/ 이동]
│   │   │   │   ├── signals.controller.ts
│   │   │   │   ├── signals.service.ts
│   │   │   │   └── signals.module.ts
│   │   │   └── quant-market.module.ts
│   │   ├── engine4-portfolio-exit/ # 🟩 Engine4: Position Thesis 엔진 (M7, DAR-11)
│   │   │   ├── CLAUDE.md            # 도메인 규칙 + AI 금지영역
│   │   │   ├── domain/
│   │   │   │   ├── invalid-condition.types.ts  # 기계 평가 가능 InvalidCondition 타입
│   │   │   │   └── position-thesis.types.ts    # ThesisStatus FSM, PositionThesisRecord
│   │   │   ├── repositories/
│   │   │   │   ├── position-thesis.repository.ts              # IPositionThesisRepository 인터페이스
│   │   │   │   ├── in-memory-position-thesis.repository.ts    # 인메모리 어댑터 (M7)
│   │   │   │   ├── prisma-position-thesis.repository.ts       # Prisma 어댑터 (DAR-35)
│   │   │   │   ├── exit-signal.repository.ts                  # IExitSignalRepository 인터페이스
│   │   │   │   ├── in-memory-exit-signal.repository.ts        # 인메모리 어댑터
│   │   │   │   └── prisma-exit-signal.repository.ts           # Prisma 어댑터 (DAR-35)
│   │   │   ├── services/
│   │   │   │   └── position-thesis.service.ts  # createFromSignal, invalidate, close
│   │   │   ├── portfolio/           # REST API — /api/positions, /api/portfolio [DAR-25: portfolio/ 이동]
│   │   │   │   ├── portfolio.controller.ts
│   │   │   │   ├── portfolio.service.ts
│   │   │   │   ├── portfolio.module.ts
│   │   │   │   ├── position-thesis.controller.ts
│   │   │   │   └── position-thesis.service.ts
│   │   │   ├── position-thesis.spec.ts          # fixture 단위 테스트 (32건)
│   │   │   └── portfolio-exit.module.ts
│   │   ├── engine5-trading-risk/ # 🟥 Engine5: 모의투자 엔진 (M10-A, DAR-16)
│   │   │   ├── CLAUDE.md            # 도메인 규칙 + AI 금지영역 (최강조)
│   │   │   ├── domain/
│   │   │   │   ├── paper-trade.types.ts        # TradeDirection, FillParams, PaperPortfolioState 등
│   │   │   │   ├── fill-simulator.ts           # 체결 시뮬레이터 (슬리피지·부분체결·수수료·세금, 순수 Rule)
│   │   │   │   ├── paper-portfolio.ts          # 가상 포트폴리오 (보유·평가손익·현금·비중)
│   │   │   │   └── cost-metrics.ts             # 비용지표 (CostPerDisclosure/Signal/Trade)
│   │   │   ├── repositories/
│   │   │   │   ├── paper-trade.repository.ts              # IPaperTradeRepository 인터페이스
│   │   │   │   ├── in-memory-paper-trade.repository.ts    # 인메모리 어댑터 (M10-A)
│   │   │   │   ├── prisma-paper-trade.repository.ts       # Prisma 어댑터 (DAR-36)
│   │   │   │   ├── audit-log.repository.ts                # IAuditLogRepository 인터페이스
│   │   │   │   ├── in-memory-audit-log.repository.ts      # 인메모리 어댑터
│   │   │   │   └── prisma-audit-log.repository.ts         # Prisma 어댑터 (DAR-36)
│   │   │   ├── services/
│   │   │   │   └── paper-trade.service.ts      # placeOrder → 체결 시뮬 실행
│   │   │   ├── paper-trading/       # REST API — /api/paper-trading [DAR-25: paper-trading/ 이동]
│   │   │   │   ├── paper-trading.controller.ts
│   │   │   │   ├── paper-trading.service.ts
│   │   │   │   └── paper-trading.module.ts
│   │   │   ├── fill-simulator.spec.ts           # fixture 단위 테스트 (11건)
│   │   │   ├── paper-portfolio.spec.ts          # fixture 단위 테스트 (9건)
│   │   │   ├── cost-metrics.spec.ts             # fixture 단위 테스트 (5건)
│   │   │   └── trading-risk.module.ts
│   │   ├── notifications/     # 알림 히스토리
│   │   │   ├── dto/
│   │   │   │   └── query-notification.dto.ts
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   └── notifications.module.ts
│   │   │                      # (scheduler·dart-api는 engine1-disclosure/ 하위로 이동)
│   │   ├── expo-push/         # Expo Push 서비스 (알림 횡단)
│   │   │   ├── expo-push.service.ts
│   │   │   └── expo-push.module.ts
│   │   ├── saved-disclosures/ # 공시 저장(북마크) — /api/saved-disclosures
│   │   ├── search/            # 통합 검색 (기업·공시) — /api/search
│   │   ├── collection-status/ # 공시 수집 상태 집계 — /api/collection
│   │   ├── cron-health/       # 크론 실행 기록(CronRunLog)·데이터 신선도(freshness) 진단
│   │   ├── ops/               # 운영 헬스체크·메트릭 (prisma/redis/외부키 인디케이터) — /api/ops
│   │   ├── storage-ops/       # S3 스토리지 헬스·유지보수 — /api/storage
│   │   ├── config/            # 환경변수 검증 (env.validation.ts)
│   │   ├── e2e/               # E2E 통합 회귀 스크립트
│   │   │   ├── integration-regression.ts  # M2→M8→모의체결 전구간 회귀 + 졸업 준비도 리포트 (DAR-14/39)
│   │   │   └── graduation-gate-rows.ts    # 졸업 게이트 행 데이터 (PR #430)
│   │   ├── prisma/            # Prisma 서비스 모듈
│   │   │   ├── prisma.service.ts
│   │   │   └── prisma.module.ts
│   │   ├── common/            # 공통 모듈
│   │   │   ├── decorators/
│   │   │   │   └── current-user.decorator.ts
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts
│   │   │   ├── interceptors/
│   │   │   │   └── logging.interceptor.ts
│   │   │   └── pipes/
│   │   │       └── validation.pipe.ts
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── .env
│   ├── .env.example
│   ├── .prettierrc
│   ├── nest-cli.json
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── tsconfig.build.json
│
├── mobile/                     # React Native 모바일 앱 (Expo + React Native Paper)
│   ├── app/                   # Expo Router 기반 화면
│   │   ├── (tabs)/           # 5탭 IA: 홈/공시/신호/포트폴리오/설정
│   │   │   ├── home/
│   │   │   │   └── index.tsx  # 홈 화면 (최근 공시)
│   │   │   ├── notifications/
│   │   │   │   └── index.tsx  # 공시 알림 히스토리
│   │   │   ├── signals/
│   │   │   │   └── index.tsx  # 신호 피드 (매수/매도 서브탭) [DAR-21]
│   │   │   ├── portfolio/
│   │   │   │   └── index.tsx  # 포트폴리오 (실전/내모의/시스템모의/전략/페르소나/스타일 서브탭) [DAR-21, DAR-405: 전략 탭]
│   │   │   ├── settings/
│   │   │   │   └── index.tsx  # 설정 화면
│   │   │   └── _layout.tsx    # 신호(zap)·포트폴리오(briefcase) 탭 추가 [DAR-21]
│   │   ├── auth/
│   │   │   └── sign-in.tsx    # 카카오 OAuth 로그인
│   │   ├── company/
│   │   │   └── [corpCode].tsx # 기업 상세
│   │   ├── disclosure/
│   │   │   ├── [id].tsx       # 공시 상세 + AI 분석 섹션(/disclosure-events 실연동) [DAR-21]
│   │   │   └── viewer.tsx     # 공시 원문 뷰어
│   │   ├── disclosures/
│   │   │   └── index.tsx      # 공시 전체 리스트 (유형 필터)
│   │   ├── search/
│   │   │   └── index.tsx      # 통합검색 (기업·공시, 300ms 디바운스) [DAR-457]
│   │   ├── stock/
│   │   │   └── [stockCode].tsx # 종목 차트 전용 화면 (풀스크린 분봉+일봉) [DAR-355/384]
│   │   ├── event-stats/
│   │   │   └── index.tsx      # 이벤트 유형별 시장 통계 (Event Study 집계) [DAR-81]
│   │   ├── philosophy/        # 투자거장 4철학 (버핏·린치·그린블라트·드러켄밀러)
│   │   │   ├── index.tsx      # 철학 카드 목록 (게스트 열람 가능) [DAR-54]
│   │   │   ├── [id].tsx       # 철학 상세 — 종목별 적합도
│   │   │   └── checklist.tsx  # 항목별 통과/미달 체크리스트 분해 [DAR-57]
│   │   ├── signals/
│   │   │   └── [id].tsx       # 매수 후보 상세 [DAR-21]
│   │   ├── portfolio/
│   │   │   ├── [portfolioId]/position/[positionId]/
│   │   │   │   ├── index.tsx  # 포지션 상세 [DAR-21]
│   │   │   │   └── thesis.tsx # Thesis 상세 [DAR-21]
│   │   │   └── strategy/
│   │   │       ├── [key].tsx          # 전략 드릴다운 — 과거 매수/매도 타임라인 [DAR-405]
│   │   │       └── intraday-scalp.tsx # 분봉 단타 드릴다운 — 오늘 거래 타임라인 [DAR-416]
│   │   ├── onboarding/
│   │   │   └── index.tsx      # 온보딩
│   │   ├── intro/
│   │   │   └── index.tsx      # 서비스 소개 캐러셀 (첫 실행 인트로)
│   │   ├── legal/             # 법적 문서
│   │   │   ├── terms.tsx      # 서비스 이용약관
│   │   │   └── privacy.tsx    # 개인정보 처리방침
│   │   ├── settings-detail/   # 설정 하위 화면
│   │   │   ├── watchlist.tsx  # 관심 기업 관리
│   │   │   ├── notification-settings.tsx  # 알림 설정
│   │   │   └── profile.tsx    # 프로필 수정
│   │   ├── +not-found.tsx
│   │   ├── kakao.tsx          # 카카오 로그인 딥링크 콜백 (gongsion://kakao)
│   │   ├── _layout.tsx
│   │   └── index.tsx
│   ├── components/            # 재사용 컴포넌트
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── GlassCard.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Loading.tsx
│   │   │   ├── AiReferenceLabel.tsx   # "AI 분석 참고용" 칩 [DAR-21]
│   │   │   ├── DisclaimerSection.tsx  # AI 면책 표준 컴포넌트 [DAR-21]
│   │   │   ├── ScoreGauge.tsx         # Buy/Exit 점수 게이지(+용어 InfoSheet, 리스트 카운트업 정적) [DAR-21·448]
│   │   │   ├── StateView.tsx          # 로딩/빈/에러 상태 뷰 [DAR-21]
│   │   │   ├── ProvenanceBar.tsx      # AI 출처 표시 바 [DAR-32]
│   │   │   └── PriceChangeChip.tsx    # 등락률 칩 컴포넌트 [DAR-32]
│   │   ├── signals/                  # [DAR-21]
│   │   │   ├── BuyScoreCard.tsx       # 매수 신호 카드
│   │   │   ├── ExitScoreCard.tsx      # 매도 신호 카드
│   │   │   └── ScoreBreakdownSection.tsx  # Buy/Exit Score 7컴포넌트 분해 섹션 [DAR-32]
│   │   ├── company/                  # 기업/종목 상세 (탭·차트) — DecisionHubTab, Fundamentals/InsiderHoldingsTab, Daily/MinuteCandleChart 등 8종
│   │   ├── disclosure/               # 공시 상세 섹션 — DisclosureAiAnalysisSection, DisclosureFiledFactsSection, DisclosureSignalLink
│   │   ├── home/                     # 홈 화면 — DisclosureFeedCard, HomeSignalPreview, MarketIndexBadge, GraduationTracker 등 6종
│   │   ├── persona/                  # 투자 페르소나 — PersonaSelectCard, MarketRegimeCard, personaDisplay
│   │   ├── philosophy/               # 투자거장 철학 — PhilosophyMasterCard, PhilosophyChecklist, PhilosophyFitBreakdown 등 5종
│   │   └── portfolio/                # [DAR-21]
│   │       └── PositionCard.tsx       # 포지션 카드
│   ├── services/              # API 클라이언트
│   │   ├── api.ts            # Axios 인스턴스
│   │   ├── auth.service.ts
│   │   ├── company.service.ts
│   │   ├── device.service.ts  # 디바이스 토큰 등록
│   │   ├── disclosure.service.ts
│   │   ├── notification.service.ts
│   │   ├── notification-settings.service.ts
│   │   ├── watchlist.service.ts
│   │   ├── signal.service.ts        # 신호 계약(미존재 엔드포인트는 빈상태) [DAR-21]
│   │   └── portfolio.service.ts     # 포트폴리오 계약 [DAR-21]
│   ├── hooks/                 # Custom Hooks
│   │   ├── useAuth.ts
│   │   ├── useCompanySearch.ts
│   │   ├── useDisclosures.ts
│   │   ├── useNotifications.ts
│   │   ├── useCompanyDetail.ts       # 기업 상세 조회
│   │   ├── useNotificationSetup.ts  # 푸시 알림 초기화 + 딥링크
│   │   ├── useNotificationSettings.ts
│   │   ├── useRequireAuth.ts        # 인증 필요 기능 가드
│   │   ├── useWatchlist.ts
│   │   ├── useSignals.ts            # 매수/매도 신호 (React Query) [DAR-21]
│   │   ├── usePortfolio.ts          # 포지션/모의투자 (React Query) [DAR-21]
│   │   └── useReducedMotion.ts      # 접근성: 모션 감소 선호 감지 [DAR-32]
│   ├── stores/                # Zustand 상태 관리
│   │   ├── authStore.ts      # 사용자 정보, 토큰 (SecureStore 연동)
│   │   └── settingsStore.ts  # 앱 설정 (다크모드 등)
│   ├── theme/                 # 테마 시스템
│   │   ├── colors.ts         # lightColors / darkColors (Teal 기반)
│   │   ├── spacing.ts
│   │   ├── typography.ts
│   │   └── index.ts
│   ├── types/                 # TypeScript 타입
│   │   ├── api.types.ts
│   │   ├── auth.types.ts
│   │   ├── disclosure.types.ts
│   │   ├── notification.types.ts
│   │   ├── user.types.ts
│   │   ├── signal.types.ts          # 신호 도메인 계약 [DAR-21]
│   │   └── portfolio.types.ts       # 포트폴리오/Thesis/모의투자 계약 [DAR-21]
│   ├── utils/                 # 유틸리티 함수
│   │   ├── date.ts
│   │   ├── signalDisplay.ts         # 점수/상태 → 테마색·레이블 매핑 [DAR-21]
│   │   ├── copy.ts                  # UI 문자열 상수 (복사 텍스트) [DAR-32]
│   │   ├── disclosureType.ts        # 공시 유형 분류 유틸 [DAR-32]
│   │   └── marketIndexDisplay.ts    # 시장지수 배지 신선도 라벨 (REALTIME/EOD 종가 기준일) [DAR-371]
│   ├── assets/                # 정적 자산
│   │   ├── android-icon-background.png
│   │   ├── android-icon-foreground.png
│   │   ├── android-icon-monochrome.png
│   │   ├── favicon.png
│   │   ├── icon.png
│   │   └── splash-icon.png
│   ├── .env.example
│   ├── .gitignore
│   ├── app.json
│   ├── babel.config.js
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
│
├── docs/                       # 문서
│   ├── architecture.md        # 시스템 아키텍처
│   ├── database-schema.md     # DB 스키마
│   ├── api-specification.md   # API 명세서
│   ├── workflow.md            # 업무 흐름도
│   ├── deployment.md          # 배포 가이드
│   ├── roadmap/               # 로드맵 정본 (비전·실행 로드맵·phase 명세·재개 계획)
│   ├── work/                  # 진행 중 작업 문서 (완료분은 archive/로 이동)
│   ├── mobile/                # 모바일 기획 (screen-plan 등)
│   └── archive/               # 완료·대체된 문서 보관 (2026-07-02 문서 감사로 신설)
│
├── harness/                    # paperclip 하네스 증거 문서 (VERIFICATION·KNOWN_FAILURES·ENTROPY_CHECK·tools)
├── infra/                      # Terraform IaC (AWS ECS/RDS 초안 — 현 prod는 OCI compose 배포)
├── scripts/                    # 운영 스크립트 (oci-arm-a1-retry.sh — OCI ARM A1 용량 확보 재시도)
│
├── .env.example
├── .gitignore
├── docker-compose.dev.yml     # 개발용 (PostgreSQL/Redis)
├── docker-compose.prod.yml    # 프로덕션 (TimescaleDB·Redis·backend·migrate — OCI 2-micro)
├── AGENTS.md                  # paperclip 플릿 규약 (브랜치/PR/worktree/통지)
├── CLAUDE.md                  # Claude Code 프로젝트 지침
├── NEXT_STEPS.md
├── PROJECT_STRUCTURE.md       # 이 파일
├── QUICK_START.md
└── README.md
```

---

## 패키지 매니저

- **npm** 사용 (lock 파일: `package-lock.json`)

## Path Aliases (모바일)

`tsconfig.json`에 정의된 경로 별칭:

| Alias | 경로 |
|-------|------|
| `@components/*` | `components/*` |
| `@theme/*` | `theme/*` |
| `@hooks/*` | `hooks/*` |
| `@services/*` | `services/*` |
| `@stores/*` | `stores/*` |
| `@app-types/*` | `types/*` |
| `@utils/*` | `utils/*` |
| `@/*` | `./*` |

> `@types`는 DefinitelyTyped와 충돌하므로 `@app-types`를 사용합니다.

---

## 백엔드 주요 파일 설명

### src/main.ts
- NestJS 애플리케이션 부트스트랩
- 글로벌 미들웨어, 필터, 파이프 설정
- Swagger 문서 설정
- CORS, Helmet 등 보안 설정

### src/app.module.ts
- 루트 모듈
- 모든 기능 모듈 import
- ConfigModule, ScheduleModule 등 글로벌 모듈 설정

### prisma/schema.prisma
- Prisma 스키마 정의
- User 모델에 `provider`/`providerId` 필드 (카카오 OAuth 지원)
- 모든 테이블 구조, 관계, 인덱스, 제약 조건

### src/auth/
- 카카오 OAuth 기반 인증
- JWT 토큰 발급 및 갱신
- Guard를 통한 인증 검증
- `kakao-auth.dto.ts`: 카카오 인가 코드/토큰 DTO

### src/prisma/
- PrismaService: Prisma Client 래퍼
- PrismaModule: 전역 Prisma 모듈

### src/engine1-disclosure/scheduler/
- @nestjs/schedule 사용
- 공시 수집 배치 (10분마다)
- 만료 토큰 정리 (매일 자정)

### src/engine1-disclosure/dart-api/
- DART Open API 클라이언트
- HTTP 요청, 재시도 로직
- 공시 유형 분류

### src/expo-push/
- Expo Push Notification 클라이언트
- 푸시 알림 발송
- 토큰 만료 처리

---

## 모바일 주요 파일 설명

### app/_layout.tsx
- 앱 전체 레이아웃
- React Query Provider 설정
- 푸시 알림 초기화
- 폰트 로딩

### app/(tabs)/_layout.tsx
- 탭 네비게이션 설정
- 홈, 알림, 설정 탭

### app/auth/sign-in.tsx
- 카카오 OAuth 로그인 화면
- 이메일 회원가입 없음 (카카오 로그인만 지원)

### app/settings-detail/
- 설정 화면의 하위 상세 화면
- `watchlist.tsx`: 관심 기업 관리
- `notification-settings.tsx`: 알림 설정
- `profile.tsx`: 프로필 수정

### theme/
- `colors.ts`: Teal 팔레트 기반 `lightColors`/`darkColors`
- `spacing.ts`: 간격 시스템
- `typography.ts`: 폰트/텍스트 스타일
- `index.ts`: ThemeContext, `useAppColorScheme()` 등

### services/api.ts
- Axios 인스턴스 생성
- 요청/응답 인터셉터
- 토큰 자동 갱신
- 에러 처리

### hooks/useAuth.ts
- React Query 기반 인증 훅
- 카카오 OAuth 로그인, 로그아웃
- 토큰 관리

### stores/authStore.ts
- Zustand 스토어
- 사용자 정보, 토큰 상태 관리
- SecureStore 연동 (expo-secure-store)

### stores/settingsStore.ts
- Zustand 스토어
- 다크모드/컬러 스킴 설정 (`colorSchemeOverride`)
- 앱 설정 상태 관리

### components/common/GlassCard.tsx
- 글래스모피즘 스타일 카드 컴포넌트

### UI 프레임워크
- **React Native Paper** 사용
- **StyleSheet** 기반 스타일링 (NativeWind/Tailwind 미사용)

---

## 코드 컨벤션

### 네이밍 규칙

**파일명**:
- 컴포넌트: PascalCase (예: `DisclosureCard.tsx`)
- 서비스/훅: camelCase (예: `auth.service.ts`, `useAuth.ts`)
- 스토어: camelCase + Store (예: `authStore.ts`)
- 상수: UPPER_SNAKE_CASE (예: `DISCLOSURE_TYPES.ts`)

**변수/함수**:
- 변수: camelCase (예: `userName`, `disclosureList`)
- 함수: camelCase (예: `fetchDisclosures`, `handleLogin`)
- 상수: UPPER_SNAKE_CASE (예: `API_BASE_URL`, `MAX_WATCHLIST_COUNT`)
- 타입/인터페이스: PascalCase (예: `User`, `Disclosure`)

**컴포넌트**:
- React 컴포넌트: PascalCase + 확장자 .tsx (예: `Button.tsx`)
- 컴포넌트 함수: PascalCase (예: `function Button()`)

### 폴더 구조 규칙

- 기능별 모듈 분리 (auth, users, disclosures 등)
- 각 모듈 내부: controller, service, module, dto
- 공통 코드는 `common/` 폴더에
- 재사용 컴포넌트는 `components/` 폴더에

### Import 순서

```typescript
// 1. 외부 라이브러리
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';

// 2. Path alias imports
import { Button } from '@components/common/Button';
import { colors } from '@theme/colors';
import { useAuth } from '@hooks/useAuth';
import { authService } from '@services/auth.service';
import { useAuthStore } from '@stores/authStore';
import { formatDate } from '@utils/date';

// 3. 타입
import type { User } from '@app-types/user.types';
```

---

## Git 브랜치 전략

### 브랜치 구조

```
main (프로덕션, origin/main) — 직접 커밋 금지
  ↑ PR (squash-merge)
feat/<issue-id>-<slug>   # 작업 단위 = GitHub Issue 1건, origin/main 기준 worktree에서 작업
```

- 브랜치 생성: `git worktree add ../wt-<issue-id> -b feat/<issue-id>-<slug> origin/main`
- 머지: PR squash-merge → 머지 후 로컬 main은 stale이므로 새 브랜치는 항상 origin/main 기준으로 생성
- 상세 규약: `AGENTS.md`

### 커밋 메시지 규칙

```
<type>(<scope>): <subject>

<body>

<footer>
```

**타입**:
- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 수정
- `style`: 코드 포맷팅
- `refactor`: 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드, 설정 변경

**예시**:
```
feat(auth): 카카오 OAuth 로그인 구현

- KakaoAuthDto 추가
- 카카오 인가 코드 → JWT 토큰 교환 플로우
- User 모델에 provider/providerId 필드 추가

Closes #12
```

---

## 환경 변수 관리

### Backend (.env)

```bash
# 필수
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
DART_API_KEY=
EXPO_PUSH_ACCESS_TOKEN=
KAKAO_REST_API_KEY=
KAKAO_CLIENT_SECRET=

# 선택
PORT=3000
NODE_ENV=development
API_BASE_URL=
```

### Mobile (.env)

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000/api
EXPO_PUBLIC_APP_ENV=development
```

**주의**:
- `.env` 파일은 절대 Git에 커밋하지 않음
- `.env.example` 파일로 예시 제공
- 프로덕션 환경 변수는 OCI 서버의 `backend/.env.prod`로 관리 (`docker-compose.prod.yml`의 `env_file`로 주입)

---

**작성일**: 2026-03-07
**최종 수정일**: 2026-07-02
**버전**: 2.1 (횡단 모듈 8종·모바일 신규 라우트/컴포넌트 디렉터리·루트 harness/infra/scripts·브랜치 전략(feat+squash)·prod env 관리 현행화)
