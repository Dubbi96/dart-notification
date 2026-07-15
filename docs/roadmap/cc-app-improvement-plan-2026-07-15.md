# 앱 개선 실행 계획 — 경쟁력 갭 분석(2026-07-15) 퀵윈 웨이브

> 정본 산출물. 근거: 갭 분석 아티팩트(약점 17건, 멀티에이전트 51개 검증 동반).
> 작성: 2026-07-16 · 실행 세션: 갭분석 퀵윈 웨이브 · 통합 브랜치: `integration/gap-2026-07-15`

## 1. 판정 요약 (문서 결론 채택)

- 병목은 기능 격차가 아니라 **상용화 게이트**(수익모델·규제·유통·신뢰 증거·보안·운영).
- "공시 알림+선별+요약"의 시장가격은 이미 0원 — 과금 가능한 층은 사용자별 상태가 필요한 **판단 층**뿐이며, 그 전제는 M10 모의운용의 공개 가능한 검증치.
- 기능 축 다수(뉴스·범용 시세알림·해외·커뮤니티·자유 스크리너)는 **포지셔닝 우회가 정답** — 추격하지 않는다.

## 2. 실행 구조

| 단계 | 내용 | 상태 |
|---|---|---|
| S0 | 스키마 토대(가산적 단일 마이그레이션 `20260715230700_gap_analysis_foundation`): User.tier·ProWaitlistEntry·InvestorFlowDaily·ShortSellingDaily·SearchMissLog·FunnelEvent·PRICE_MOVE·EARNINGS_GUIDANCE·priceMovePushEnabled | ✅ 완료 — `59e17990`(feat/gap-w0-schema-foundation), 전 구현 레인의 공통 베이스 |
| Wave | 구현 레인 17 + 문서 레인 3 (워크트리 병렬, 브랜치+커밋) | ✅ 20/20 레인 완료 — 레인별 브랜치·산출물은 §4 |
| 통합 | 머지 트레인 → 전체 DoD → 배치 push → PR → 머지 | ✅ `integration/gap-2026-07-15` 머지 트레인 완주(정합 보수 커밋 `b7bd6d3d`·락파일 갱신 `53a25358` 포함) — **검증: 백엔드 jest 4,261 그린 · 모바일 jest 38 그린 · tsc 0 · build 0** + 공유 문서 동기화(api-specification 1.40·workflow §2.14~2.17/§5.14·PROJECT_STRUCTURE 2.2·로드맵 MZ/M13A/C-트랙) |
| 오너 | 오너 전속 액션 패키지(Play 클록·도메인·KRX 질의·UptimeRobot·JWT 로테이션·EAS 채널·APK 재빌드·iOS 게이트) | ⏳ 대기 — 정본 [cc-owner-actions-2026-07-16.md](./cc-owner-actions-2026-07-16.md), 체크리스트는 NEXT_STEPS.md |

## 3. 강제한 제약

- M10 모의운용 무오염: engine5·매매/체결/Buy Score 계산 경로 무접촉(신규 표면 전부 조회·계측·알림 계층), 수급 데이터는 SHADOW(가중치 0) 전용.
- DART 쿼터: 델타 폴링은 라이브 예약분 내 소비 + 자체 예산 상한(400콜/일) + 소진 임계 OPS_ALERT. 공유 페이지·status 페이지는 외부 API 콜 0.
- lookahead 불가침: 공매도 publishedDate(T+2) 분리 저장·as-of 조회 강제.
- 신규 크론 전부 CronRunLog job key 등록(krx.daily 거짓 stale 선례) — `disclosure.delta`·`event.title-backfill`·`market.investor-flow-collect`·`market.short-selling-collect`·`market.price-move-alert`.
- 정직 표기: YoY 기준 라벨, '관련 공시 없음' 병기, 지표 기준일 배지(latestTradeDate), 감지→푸시로 정직하게 정의한 지연 지표, 공매도 잔고 null(합성 금지).

## 4. 레인 매핑 (약점 → 브랜치 → 핵심 산출물)

구현 17레인 + 문서 3레인. 전부 `integration/gap-2026-07-15`에 머지 완료.

| 약점(W) | 브랜치 (헤드 커밋) | 핵심 산출물 1줄 |
|---|---|---|
| W0 (토대) | `feat/gap-w0-schema-foundation` (`59e17990`) | 가산적 단일 마이그레이션 — tier·waitlist·수급/공매도·계측 모델·알림 enum 전부 선행 배선 |
| W1 수익모델 부재 | `feat/gap-w1-waitlist-tier` (`9b79a576`) | Pro 사전신청 서버 영속화(GET/POST/DELETE `/users/pro-waitlist`, 멱등) + 관심기업 한도 tier 게이트(FREE 30) — 수요 계측 데이터 소스화 |
| W2 데이터 출처 표기 | `feat/gap-w2-data-sources` (`c21fbf71`) | `SourceAttribution` 컴포넌트 + `legal/data-sources.tsx` 출처·라이선스 고지 화면(DART·KRX·KIS 귀속 일관 표기) |
| W3 스토어 컴플라이언스 | `feat/gap-w3-expo-updates` (`8a62ef60`) · `feat/gap-w3-account-deletion` (`d66bec26`) | expo-updates 도입(stale APK 사고 구조 해소) + 계정 삭제 `DELETE /users/me`(Cascade 전수 스키마 가드) + 법적 고지 공개 URL(`/api/legal/*`) |
| W3b 유통·공유 표면 | `feat/gap-w3b-share-page` (`1bd01f0e`) | 공개 랜딩(`GET /`) + 공시 공유 페이지(`GET /share/:rcpNo` — og 메타·캐시 AI 요약·앱 딥링크) + 모바일 공유 링크 전환 |
| W4 신호 검증 | `feat/gap-w4-validation` (`c7fe0334`) | 제목 기반 이벤트 백필(매일 02:40·DART 0·AI 0·confidence≥0.85·TITLE_ONLY 마커) — Event Study 관측치 확장 + 11년 백테스트/Track B 재검증 러너 정비 |
| W5 리얼타임성 | `feat/gap-w5-delta-polling` (`e3d3345b`) | 장중 1분 델타 폴링(최악 지연 ~10분→~90초·일일 예산 이중 방어) + 감지→푸시 지연 계측(`GET /ops/notification-latency`) |
| W6+W7 급변동 설명·알림 | `feat/gap-w7-w6-price-move` (`fe741281`) | 관심종목 ±5% 5분 틱 → PRICE_MOVE 알림 + 무공시 변동 '관련 공시 없음(48h)' 정직 병기·업종 z-score·뉴스 링크아웃 |
| W8 해외(미국) 수요 | `feat/gap-w8-us-demand` (`44453b52`) | 제로결과 검색 SearchMissLog 계측 + 원탭 수요 버튼(`POST /search/us-demand`) + EDGAR PoC(`scripts/edgar-poc.ts`) — M13A-Lite 게이트 데이터 |
| W9 실적 표기 정직성 | `feat/gap-w9-guidance` (`673cfc80`) | 실적 YoY 기준 라벨 정직화 + EARNINGS_GUIDANCE 분류·가이던스 추출기 신설(보수적 null 게이팅) |
| W10 AI 커버리지 SLA | `feat/gap-w10-ai-cost` (`b78a289c`) | AI 커버리지 계기판(`GET /ai-cost/coverage` — 생성률%·P50/P95 지연) + 비용캡 ENV화(월캡 20→31 정합) + 빈 카드 기대치 UX |
| W11+W12 운영 가시성·신뢰 | `feat/gap-w11-w12-ops-surface` (`ac2f3100`) | 제로런 감지 증축(`zeroRunThreshold` — '살아있는 기아' 표면화) + 공개 `/status` 무결성 페이지(운영 사실만) + 앱 내 문의(`support.tsx`) |
| W13 데이터 자산 개방 | `feat/gap-w13-indicator-surface` (`010e2b41`) | 기술지표 조회 API(`GET /market-data/indicators` — 기준일 정직 고지) + 차트 MA/볼린저 오버레이 + 신호 상세 근거 지표 섹션 |
| W14 판단 결합 표면 | `feat/gap-w14-daily-briefing` (`85ae3053`) | 오늘의 브리핑(`GET /portfolio/briefing/today` — LLM $0 룰 조립·전 섹션 0건 null) + 포트폴리오 탭 카드 |
| W15 품질 게이트 부재 | `feat/gap-w15-mobile-tests` (`efdab556`) | jest-expo 유닛(모바일 38 그린) + Maestro 스모크 6플로우(+dev-login 딥링크) + 온보딩 퍼널 계측(`POST /ops/funnel` 비인증 202) |
| W16 수급·공매도 데이터 축 | `feat/gap-w16-investor-flow` (`96840dcc`) | EOD 수집기(평일 07:40/20:00/21:30·KRX→KIS 체인·publishedDate T+2·잔고 null 정직) + 조회 API 2종 + 수급 요약 카드 — **SHADOW** |
| W17 보안 태세 | `feat/gap-w17-security` (`d1def2c3`) | CI 보안 잡(npm audit allowlist 게이트 `scripts/audit-gate.mjs` + gitleaks) + dependabot + Swagger prod 게이트 + 트리아지 문서(docs/security/) |
| 문서: 수익화 | `docs/gap-monetization-plan` (`92ad2d0c`) | [cc-monetization-plan.md](./cc-monetization-plan.md) — 티어 매트릭스·가격 가설 2안·규제 결정트리·2레일 구조·M10.5(MZ) 트랙 제안(로드맵 §1 반영 완료) |
| 문서: 컴플라이언스 | `docs/gap-compliance-ledger` (`bd2c7111`) | docs/compliance/ 3종 — 데이터 라이선스 원장·KRX 서면질의 초안·유사투자자문업 신고 체크리스트(로드맵 §4 C-트랙 반영 완료) |
| 문서: 오너 액션 | `docs/gap-owner-actions` (`bf96438a`) | [cc-owner-actions-2026-07-16.md](./cc-owner-actions-2026-07-16.md) — 오너 전속 8항목 실행 체크리스트(Play 클록·도메인·KRX 발송·시크릿 등) |

## 5. 캘린더 클록 (오너 착수 필요)

1. Google Play 테스터 클록(12명×14일) — 즉시 기동해야 M10 졸업(≈8/5)과 동시 공개 가능
2. KRX 데이터 라이선스 서면질의 — 회신 수 주, 초안 발송만 하면 됨
3. 수급 데이터 축적 — 수집기 배포 시점부터 시계 시작(백테스트 검증에 최소 3개월치)
4. Event Study 과거 백필 — 백필 잡 배포 후 야간 자동, 주간 크론이 재집계

## 6. 명시적 비추격 (non-goal)

뉴스 레이어 수집·저장 / 범용 시세 조건 알림 / 자유 수식 스크리너·드로잉 / 커뮤니티 / 해외 풀 파이프라인(M13A-Lite는 수요 실증 게이트) / 개방형 챗.
