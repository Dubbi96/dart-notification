# APK 피드백 트리아지 — v1.0.0 확인용 APK 7문제 근본원인·수정 계획 (정본)

> 작성: 2026-07-18 (PM) · 입력: 오너 실기기 스크린샷 7장(2026-07-18 02:23~02:25 KST, LTE)
> 조사: 6클러스터 병렬 코드 조사(워크플로 wf_fc9c2403-143, 에이전트 6, 전 클러스터 코드 근거 확정)
> 이슈: DAR-558~564 (§4) · 관련 정본: `cc-daily-investment-edition-2026-07-16.md`, `cc-pm-cycle1-plan-2026-07-17.md`, `docs/mobile-design-rules.md`

---

## 0. 동시 발생 인시던트 — prod 백엔드 행(P0, 이슈와 별도 트랙)

- 2026-07-18 14:35 KST(장중) 기준 prod(168.138.198.152)가 **TCP 연결은 수락하나 HTTP 무응답**(60초 프로브 포함, 443·3000 동일). 스크린샷 시각(02:24)에도 부분 실패가 있었음.
- SSH 진단은 권한 분류기 차단 → **오너 `!` 실행 대기**. 진단 후 로그 보존형 restart로 복구 예정.
- 가설(미확정): §4 I3의 무제한 전량조회(`/signals/exit`)가 커넥션 풀(connection_limit=6)을 잠식하는 캐스케이드 가능성 — 진단 로그로 확증한다.

## 1. 스크린샷 ↔ 화면 ↔ 근본원인 매핑 (전 항목 코드 근거)

| # | 스크린샷 | 화면(파일) | 근본원인 요지 |
|---|---|---|---|
| 1 | 공시온 Pro 업셀 | `mobile/app/settings-detail/pro.tsx` | 혜택 4개 중 3개(고급 필터·우선 알림·심화 분석)는 **구현 전무한 광고 카피**, 1개는 과장("무제한" ↔ 실구현 PRO=200종목, `watchlist.util.ts:27`). Play 게이팅(DAR-549)은 트레이딩 4표면만 커버 — Pro 표면은 스토어 빌드에 그대로 실림. Google Play 오해 소지 표현(Misleading Claims) 리스크. "출시되면 알림 받기"는 실동작(ProWaitlistEntry 서버 영속) |
| 2 | 무한 스켈레톤(타이틀 없음) | `mobile/app/company/[corpCode].tsx:466` (기업 상세 — 앱 내 유일 일치 레이아웃) | ①실패해도 에러 UI까지 **최소 ~33초 무피드백**(retry 2×axios 10s+백오프) ②NetInfo 거짓 offline 시 React Query v5가 **무기한 pause** → `!company` 분기로 낙하해 재시도 버튼 없는 데드엔드(`:512`), 앱 전체 isPaused 처리 0건 ③서버가 캐시 미스 시 요청 경로에서 DART 동기 호출(서버 30s > 클라 10s 역전) ④`performTokenRefresh` 타임아웃 미설정 — 전역 행 벡터(`api.ts:36`) |
| 3·4 | AI 비용 로딩→실패 | `mobile/app/settings-detail/ai-cost.tsx` (설정 탭 진입점 무게이팅) | **내부 운영(ops) 화면이 소비자 빌드에 노출** — DAR-549 매니페스트에 ops 표면 누락. 에러 자체는 서버 무응답 추정(엔드포인트는 무가드 200 정상). 부수: `/ai-cost/*`·`/collection` 컨트롤러가 **무인증 공개** |
| 5a | 로그아웃 모달 백드롭 부분 커버 | `mobile/components/common/DialogProvider.tsx` (Paper Dialog+Portal) | JS 절대배치 오버레이라 **네이티브 elevation이 z-order를 역전** — 탭바 elevation:8·네이티브 헤더가 백드롭 위로. Fabric에서 Paper의 collapsable 우회 신뢰 불가(기존 refreshControl 백지 버그와 동계열) |
| 5b | 알림 "99+" 뱃지 | `utils/unreadBadge.ts` + `GET /notifications` meta.unreadCount | 캡(99+) 자체는 정상. **"탭 열람=확인" 개념 부재** — 읽음은 행 개별 탭/수동 전체읽음뿐이라 카운트가 영구 누적 |
| 6 | 매도 탭 "백엔드 연결 실패"(매수는 정상) | `signals/index.tsx` 매도 분기 → `GET /signals/exit` | `findExitSignals()`가 **where·take·사용자 스코프 전무한 전량조회**(2단 include) — 시스템 모의매매 청산신호 수천 행 응답이 axios 10s 초과 → ECONNABORTED → "연결 실패" 카피. 매수(에디션)는 LIMIT 바운드라 정상 = 비대칭의 원인. 부수: 일반 사용자에게 시스템 모의신호가 "전체 매도 신호"로 노출(데이터 계약 위반). 에러 카피 "같은 Wi-Fi…"는 개발용 문구가 프로덕션 노출(`StateView.tsx:144`) |
| 7 | 에디션 7/17 누락·"오늘" 점 | `EditionDateStrip.tsx` + `findDailyEditions` | 목록 API 날짜 축 = **"매수등급 신호 ≥1건인 날"**(거래일 축 아님). 폴백 브리핑(A안)은 단일일 상세에서 온더플라이만 — 목록에 절대 안 잡힘. 모바일은 '오늘' 1칩만 합성 → 7/17(신호 0 거래일)은 칩 소멸. prev/next CTA도 신호일 기준이라 7/17 건너뜀 — **A안이 과거 QUIET일에 사실상 사장** |

## 2. PM 결정 (전권 위임 근거, 오너 거부권 유보)

| 결정 | 내용 | 근거 |
|---|---|---|
| D1 | **첫 Play 빌드에서 Pro 표면 전체 숨김** + 내부 채널(oci)은 카피 정직화 유지 | 오너의 "첫 게시 버전 신뢰 우선"(트레이딩 제외 결정)과 동일 논리. waitlist 수요계측은 내부 채널에서 지속 |
| D2 | Pro 카피 "무제한"→**"관심기업 한도 확대 30→200종목"**(실구현 일치), 미구현 3혜택 삭제. **"심화 분석"은 재도입 금지** | 정직 원칙 + `policy-non-advisory.md` 판단층 과금은 유사투자자문업 신고 전 금지 |
| D3 | ops 게이팅은 **신규 플래그 `EXPO_PUBLIC_SHOW_OPS`**(SHOW_TRADING 재사용 아님), **수집 현황도 함께 숨김** | 트레이딩 재공개 시에도 ops는 계속 숨겨야 함 — 의미 분리 |
| D4 | 매도 세그먼트는 **Play 빌드에서 숨김**(신호 탭=매수 에디션 단독) | 매도 신호=보유 포지션 기반인데 Play 빌드는 포트폴리오 표면 자체가 없음 → 스코프 수정 후엔 상시 빈 탭. IA 재설계(§5)까지 숨기는 게 정직 |
| D5 | 뱃지는 **B안(seen/read 이원화)** — `User.notificationsLastSeenAt` + `POST /notifications/seen`, 행 하이라이트 보존 | A안(자동 전체읽음)은 미읽음 하이라이트 소실 |
| D6 | 에디션 목록을 **거래일 축으로 전환**(빈 거래일 count=0 left-join, 하한=최초 신호일 클램프), prev/next=**인접 거래일**, 정직 불변식(count=판단 수만) 유지 | A안 폴백을 실제 도달 가능하게. 휴장일 SSOT=백엔드 market-calendar(클라 합성 기각) |
| D7 | 빈 칩 카피: 과거 빈 거래일=딤+도트 없음(탭→브리핑 상세), 오늘 미발행="발행 전" | '·' 무의미 플레이스홀더 제거 |
| D8 | R-룰 2종 추가 — **R-21** "스켈레톤은 에러·pause 폴백 의무(워치독 10초)" + **R-22** "풀스크린 백드롭은 RN 코어 Modal만(JS 오버레이 금지)" + 정적 스캐너/ESLint 가드 | 재발 방지를 룰·CI로 |

## 3. 이슈 분해 (DAR-558~564)

| ID | 레인 | 크기 | 제목 | DoD 요지 |
|---|---|---|---|---|
| DAR-558 | FE | S | Play 소비자 빌드 표면 게이팅 확장 — Pro·ops·매도 세그먼트 + Pro 카피 정직화 | `proVisibility`/`opsVisibility` 유틸(DAR-549 패턴)·eas.json play/play-apk env 2종·가드 HOC·스냅샷 검증. oci/preview 회귀 0 |
| DAR-559 | BE | S | ops 엔드포인트 인증 가드 — `/ai-cost/*`·`/collection` JwtAuthGuard | 컨트롤러 가드 부착+jest. FE 진입점 제거(DAR-558) 후라 호환 부담 0 |
| DAR-560 | BE | M | `/signals/exit` 근본 수정 — 사용자 스코프·OPEN 포지션당 최신 1건·take 상한 | `findExitSignals(userId)` 필터+distinct+take 50·컨트롤러 @CurrentUser 배선·jest. 시스템 모의신호 일반 노출 차단 |
| DAR-561 | BOTH | M | 로딩 견고화 — 스켈레톤 워치독(10s)·isPaused 데드엔드 해소·refresh 타임아웃·에러카피 프로덕션화(FE) + 기업개황 요청경로 DART 동기호출 제거(BE) | DetailSkeleton 워치독 prop+`check-skeleton-error-fallback` 스캐너, `performTokenRefresh` timeout 10s, StateView 카피 교체(개발 문구는 `__DEV__`만), findByCorpCode stale-즉답+백그라운드 갱신 |
| DAR-562 | FE | S | DialogProvider RN 코어 Modal 전환 — 백드롭 풀스크린 + R-22·ESLint 가드 | `<Modal transparent statusBarTranslucent navigationBarTranslucent>` 교체, useDialog API 불변(소비처 7곳 수정 0), Android 에뮬 dim 실측 |
| DAR-563 | BE→FE | M | 알림 뱃지 seen/read 이원화 — `notificationsLastSeenAt` 마이그레이션+`POST /notifications/seen`+탭 포커스 시 seen | 뱃지=lastSeenAt 이후 신규 수, 행 isRead 유지. **스키마 변경 → Prisma 직렬 규칙: BE 레인 단독, DAR-560 완료 후 착수** |
| DAR-564 | BOTH | M | 에디션 거래일 축 전환 — findDailyEditions left-join·prev/next 인접 거래일·칩 마이크로카피(D6·D7) | isTradingDay 축 열거+firstSig 클램프·nextCursor 계약 불변·EditionDateStrip count=0 수용+"발행 전"/딤 칩·jest/스냅샷 갱신. 마이그레이션 0 |

레인 배정: **FE-DEVELOPER** 558→562 · **BE-DEVELOPER** 560→559→563 · **DEVELOPER** 561→564.
우선순위: 560(매도 실패 근본·P0 연관 가설)·561(전역 견고화) > 558(스토어 심사 리스크) > 562 > 563·564.

## 4. 검증 게이트 (전 이슈 공통 DoD 추가분)

1. 표준 DoD(tsc 0·jest 그린·문서 동기화) + **raw SQL 포함 PR은 camelCase 쿼트·실DB 1회 실측**(DAR-519 교훈).
2. DAR-558 산출물은 **play-apk 재빌드 후 에뮬 실측**(Pro·AI비용·수집현황·매도 세그먼트 부재 + oci 빌드 존재) — PM이 수행.
3. DAR-562는 Android 에뮬에서 헤더·탭바 dim 스크린샷 증거 필수(크로스플랫폼 규약).
4. M10 보호: 전 이슈가 engine5 쓰기 경로 무접촉(560은 조회 스코프만) — 측정 무오염.
5. 반영 시 `docs/release-notes-app.md` 갱신(화면 기준 변경 기록).

## 5. 후속 기획(백로그, 이슈 미발행)

- **매도 탭 IA 재설계**: (a) 에디션 비주얼 통일+포지션당 최신 1건 vs (b) 에디션 '호'에 "보유 리스크 브리핑" 섹션으로 흡수. 트레이딩 표면 재공개 검토(8/5 M10 졸업)와 함께 기획.
- Pro 혜택 로드맵 확정(고급 필터·우선 알림의 실제 구현 계획) — 과금 설계는 `cc-pm-cycle1-plan-2026-07-17.md` 과금층 원칙 준수.
- 스크린샷 #7의 7.15→7.9 공백은 DAR-564로 구조 해소되나, 해당 기간 신호 0건 자체는 7/15 라이브 파싱 기아 장애(`live-parse-starvation-incident-2026-07-15.md`)의 흔적 — 백필하지 않음(DAR-129 정합).

## 6. 오너 확인 필요(비차단)

- §0 P0: SSH 진단 1줄 실행(채팅 안내 참조) — **유일한 차단 항목**.
- D1~D8은 PM 전결로 즉시 착수하되, 거부권 행사 시 해당 이슈만 되돌린다(전부 가역적·JS/조회 레이어).
- Pro "무제한" 약속을 서버에서 실제 무제한으로 올릴지는 결제 레일 설계 시 재론(현재 카피만 200 정합).
