# UI/UX 정밀 리뷰 (2026-07-02) — 2차 HARVEST 이후 검증 + 신규 발견

> 범위: 모바일 앱 40개 화면 + 공유 컴포넌트·훅·테마 전체. DAR-445~470(6/27 감사 24건) 머지 완료 상태의 main 코드 기준.
> 방법: 화면 클러스터 5개(진입·홈/신호/포트폴리오/설정·알림/공시·기업) + 횡단 스윕 4개(접근성/일관성·토큰/성능·쿼리/신뢰·정합) 병렬 리뷰(8축 루브릭, file:line 근거 필수) → **발견 전건 반박 검증**(실재 확인·심각도 재판정·오픈 PR 중복 판정) → 6/27 감사 W1~W7 DoD 별도 검증. 총 36 에이전트.
> 한계: **정적 코드 리뷰** — 에뮬레이터 인터랙션 패스는 §6 체크리스트로 후속. 선행 정본: [cc-ui-ux-audit-2026-06-27](./cc-ui-ux-audit-2026-06-27.md) · 이슈 처리 규약은 동일(파일별 1이슈, Paperclip 플릿 구현).

---

## 0. 한 줄 결론

> **6/27 감사의 큰 수술은 성공했다** — W2(홈 위계)·W3(점수 모순)·W4(공유 a11y)·W6(상태 처리)은 코드로 완료 확인했고, 특히 치명 결함이던 B3(점수 합계 모순)은 구조적으로 재발 불가능하게 해소됐다. 이번 리뷰의 신규 발견은 **"넓은 수술 자국 옆의 잔존 결함"** 이다: ①써놓고 배선을 안 한 기능(매도 탭 검색, back 가드), ②프론트–백엔드 상수 불일치(등급 컷 30/60/80 vs 50/45/30, 구 EAS projectId), ③같은 지표 두 정의(누적 수익률 평가 vs 실현) — 세 패턴 모두 "코드가 화면에게 거짓말을 하게 만드는" 유형으로, 신뢰 자산을 깎기 전에 1차 10건부터 처리해야 한다.

**검증 통계**: 발견 85건 → 반박 검증 후 **확정 80건**(기각 1·오픈 PR #424/#425 중복 4) → 리뷰어 간 교차 중복 4건 병합 시 **유니크 76건: high 10 / medium 33 / low 33**.

## 1. 6/27 감사 워크스트림 판정 (후속 검증)

정적 게이트: `tsc` 0 에러 · ESLint 0 에러(경고 717) · 검증 스크립트 `mobile/scripts/check-*.ts` **122개 중 112개 통과** — 실패 10개 중 9개는 이후 정당한 변경으로 앵커가 깨진 **stale 체크**(코드 실사로 요건 충족 확인, 스크립트 갱신 필요 §6).

| WS | 이름 | 판정 | 남은 것 |
|---|---|---|---|
| W1 | 이해도 레이어 | 🟡 부분 | 신호 탭 1줄 서브타이틀(B13)·첫 진입 코치마크(W1-d) 미구현, EVENT_TYPE_LABEL 미등재 유형 '기타' 뭉개짐 |
| W2 | 첫인상·정보위계 | ✅ 완료 | 없음 (홈 큐레이션 유지 확인) |
| W3 | 신뢰 무결성 | ✅ 완료 | **B3 확정 해소** — `ScoreBreakdownSection`이 상대 기여도(%)로 정규화, 헤더·근거 모두 동일 `signal.buyScore` 배선으로 불일치 구조적 불가 |
| W4 | 접근성 일괄 | ✅ 완료 | 핵심 요건 충족, 잔여 nit는 PR #425 대기 |
| W5 | 컴포넌트·패턴 일관성 | 🟡 부분 | 신호 탭 배너 2개 배경 토큰 불일치(B9), 미사용 BuyScoreCard 잔존(B11) |
| W6 | 상태 처리·새로고침 | ✅ 완료 | 없음 |
| W7 | 토큰 위생 | 🟡 부분 | GlassCard rgba 12건·LogoMark 하드코딩 3건·`colors.warning+'22'`식 알파 결합 잔존 |

## 2. 신규 발견의 3대 패턴

1. **배선 누락** — UI가 기능을 약속하는데 코드가 연결 안 됨: 매도 탭 검색 무기능(B-2), 미저장 가드가 Android 하드웨어 back 미적용(D-1), pull-to-refresh가 형제 쿼리 방치(C-1, E-3).
2. **프론트–백엔드 상수 불일치** — 화면이 자기 백엔드와 다른 말을 함: 게이지 등급 경계 30/60/80 vs 실제 컷 50/45/30(B-1), 온보딩 구 EAS projectId 하드코딩(A-1), 누적 수익률 정의 이원화(S신뢰 A-1).
3. **공용 컴포넌트의 마지막 구멍** — 파급 큰 공유 지점: `Button` a11y 전무(SA-1), `tabInactive`·placeholder 대비 미달을 주석으로 인지하고도 잔존(SA-2), 캔들차트 스크럽 전량 리렌더(P-1).

## 3. 최우선 수정 10선 (high 확정)

| # | 발견 | 위치 | 왜 치명적인가 → 수정 방향 |
|---|---|---|---|
| H1 | **온보딩 푸시가 구(舊) EAS projectId 하드코딩** (A-1) | `app/onboarding/index.tsx:29` | '알림 받기' 행복경로가 무효 토큰 등록/무음 실패 — 첫 세션 푸시 미수신. `useNotificationSetup`의 동적 해소를 단일 util로 추출해 공유 |
| H2 | **게이지 등급 경계(30/60/80)가 실제 등급 컷(50/45/30)과 모순** (B-1) | `utils/signalDisplay.ts:55` | buyScore 50 '강한매수'가 게이지에선 '주의' 밴드 + "다음 등급까지 +10" — 한 카드 안 상반 판정. 컷 SSOT를 백엔드 `SIGNAL_GRADE_THRESHOLDS`와 동기화(API 전달 권장) |
| H3 | **매도 탭 검색 입력이 무기능** (B-2) | `app/(tabs)/signals/index.tsx:209` | 힌트가 "매수·매도 신호 검색"을 약속하나 매도 리스트 미필터 — 보유종목 매도신호 탐색 동선 단절. 클라이언트 필터 재사용 + 0건 빈상태 |
| H4 | **'자산곡선 최신점과 동일' 문구가 새로고침 직후 스스로 깨짐** (C-1) | `components/portfolio/SimulationStatusSection.tsx:339` | onRefresh가 status만 refetch, 자산곡선·단타 카드 방치(DAR-210 패턴 재발). 섹션별 refetch 키 매핑 |
| H5 | **같은 '누적 수익률'이 화면마다 다른 정의** (S신뢰 A-1) | `SimulationStatusSection.tsx:185` vs `trade-history.tsx:143` | 탭=평가 기준(미실현 포함), 리포트=실현만 — 같은 라벨 다른 숫자. 기준 캡션 명시 또는 정의 통일 |
| H6 | **미저장 변경 가드가 Android 하드웨어 back에서 우회** (D-1) | `app/settings-detail/notification-settings.tsx:92` | 주 배포 타깃(Android APK)에서 편집 유실. onboarding의 BackHandler 패턴 재사용 + beforeRemove |
| H7 | **기업 통계 탭 유형 칩 — 선택하면 칩 행 소멸 트랩** (E-1) | `app/company/[corpCode].tsx:169` | 서버 필터 응답으로 eventTypes가 1개로 줄어 선택기 증발, 복구는 탭 재진입뿐. 무필터 1회 조회 + 클라이언트 선택 |
| H8 | **공용 Button a11y 전무 + loading 시 스크린리더 무음** (SA-1) | `components/common/Button.tsx:80` | 전 화면 주요 CTA 파급. role/label/state(busy) 기본 부여 |
| H9 | **tabInactive·inputPlaceholder 대비 2.5~3.1:1** (SA-2) | `theme/colors.ts:123` | 최상위 내비·모든 입력창 상시 노출. 주석 스스로 미달 인지(DAR-144에서 textTertiary만 상향). gray500/#7B82A0급 상향 |
| H10 | **캔들차트 스크럽 시 SVG 전량(일봉 ~750·분봉 ~1,170 노드) 매 프레임 재렌더** (P-1) | `components/company/DailyCandleChart.tsx:193` | DAR-458 스크럽 인터랙션 자체가 저사양 Android에서 끊김. 정적 캔들 레이어 useMemo 분리 + 크로스헤어만 갱신. ⚠️ #425와 같은 파일 — 머지 후 착수 |

## 4. 이슈 분해 제안 (파일별 1이슈 — Paperclip 등록용)

**1차(high 포함 묶음) — 10건:**

| 제안 ID | 파일 | 포함 발견 | 비고 |
|---|---|---|---|
| UXR-1 | `app/onboarding/index.tsx` | A-1(H1)·A-6 부분실패 무음·SA-9 스킵 a11y | |
| UXR-2 | `utils/signalDisplay.ts`+`ScoreGauge.tsx` | B-1(H2)·B-3 음수 클램프 | 백엔드 컷 API 노출 여부 선결정 |
| UXR-3 | `app/(tabs)/signals/index.tsx` | B-2(H3)·W5 잔여 B9·W1 잔여 B13 | |
| UXR-4 | `components/portfolio/SimulationStatusSection.tsx` | C-1(H4)·S신뢰A-1(H5)·C-2 용어·S신뢰C-1 포맷터 | trade-history 캡션 1줄 포함 |
| UXR-5 | `app/settings-detail/notification-settings.tsx` | D-1(H6)·D-4 빈 섹션·D-5/SA-5 키워드 X 버튼(+phosphor 아이콘 제거) | |
| UXR-6 | `app/company/[corpCode].tsx` | E-1(H7)·E-7 자체 배너·E-10 전체공시 동선·P-8 폴링 경계 | ⚠️ #424 머지 후 |
| UXR-7 | `components/common/Button.tsx` | SA-1(H8)·SA-4 폰트 스케일 | 전 화면 파급 — 단독 처리 |
| UXR-8 | `theme/colors.ts` | SA-2(H9) | 대비 실측치 포함 |
| UXR-9 | `components/company/Daily·MinuteCandleChart.tsx` | P-1(H10) | ⚠️ #425 머지 후 |
| UXR-10 | `app/(tabs)/home/index.tsx` | A-3/P-4 헤더 리마운트·A-4 피드 기본탭·SA-3 세그먼트 a11y | |

**2차(medium) — 13건:** UXR-11 `kakao.tsx`(A-5 무음 복귀) · UXR-12 `signals/[id].tsx`(B-4 헤더 44pt·B-5 L1 refresh·B-7·B-8·B-10) · UXR-13 `(tabs)/portfolio/index.tsx`(C-3 무음·C-6·C-8 재탭·P-5 쿼리 게이팅) · UXR-14 `trade-history.tsx`+`backtest-track-record.tsx`(C-4 터치영역·S신뢰B-1 Sharpe 용어) · UXR-15 `EquityCurveChart.tsx`(C-5/P-7 히트영역·엘리먼트 수) · UXR-16 `(tabs)/notifications/index.tsx`(D-2 낙관적 업데이트·D-9/토큰A-2 Ionicons·토큰C-1 이모지 이중) · UXR-17 `saved-disclosures.tsx`(D-3·토큰D-1 로딩 드리프트) · UXR-18 `profile.tsx`(D-6 RQ 우회) · UXR-19 `search/index.tsx`(E-2 막다른길·SA-6) · UXR-20 `disclosures/index.tsx`(E-4·E-5·E-8) · UXR-21 기업상세 refresh 부재 탭(E-3) · UXR-22 `stock/[stockCode].tsx`(E-6) · UXR-23 훅 묶음(`useSignals` P-2 전량 fetch·`useGraduationMetrics` P-3 폴링).

**3차(low) — 패턴 묶음:** ScreenHeader 미채택 6화면 통일(토큰A-1) · W7 잔여 토큰(GlassCard·LogoMark 삭제 검토·알파 결합) · FOMO 카피('놓치지 마세요')+브랜드명 'DART 알리미 Pro'(S신뢰D-1·D-8) · disclosureType 팔레트 테마화(토큰B-1) · 본전 처리 정의 통일(S신뢰G-1, **백엔드**) · upProbD5 어휘 통일(S신뢰F-1) · 수수료 고지 일관화(S신뢰E-1) · 나머지 low는 부록 참조.

## 5. 오픈 PR 중복 (머지 시 자동 해소 — 이슈 발행 금지)

| 발견 | 해소 PR |
|---|---|
| ai-cost 6쿼리 즉시 발화(D-10/P-9), 접힌 분봉차트 폴링(P-6) | **#424** (DAR-471 enabled 게이팅) |
| InlineDisclosure 3중 복제(C-9) | **#425** (DAR-472 공용 추출) |

## 6. 후속 검증 패스 (남은 일)

1. **에뮬레이터 인터랙션 패스** (정적 리뷰가 못 보는 것): 콜드스타트→홈 첫 프레임, 세그먼트 토글 시 캐러셀 리셋 체감(A-3), 캔들 스크럽 프레임(P-1), 다크모드 게스트 잠금 카드(A-2), 딥링크 복귀(카카오 error 경로 A-5), 폰트 배율 200% 렌더(SA-4), TalkBack으로 탭 바→홈→신호 상세 완주. 절차: `docs/mobile-dev-build.md` + dev-login 딥링크.
2. **stale 검증 스크립트 갱신**: check-*.ts 실패 10개 중 9개가 stale 앵커 — 요건은 충족 상태이므로 앵커만 현행화(별도 chore 이슈 1건).
3. 1차 UXR-1~10 처리 후 **재검증 미니 패스**(동일 반박검증 절차).

---

## 부록 A. 확정 발견 전체 (84행 = 확정 80 + PR 중복 4, 심각도순)

> 축약 없이 ID로 워크플로 원본(발견별 evidence·impact·fix_direction)을 추적할 수 있다. 교차 중복: D-5=SA-5, D-7=SA-7, A-3=P-4, D-9⊂토큰A-2.

| 심각도 | ID | 축 | 발견 | 위치 | 비고 |
|---|---|---|---|---|---|
| high | A-진입홈/A-1 | 신뢰정합 | 온보딩 푸시 등록이 하드코딩된 구(舊) EAS projectId를 사용 — 동적화(DAR-447)와 불일치 | `mobile/app/onboarding/index.tsx:29` |  |
| high | B-신호/B-1 | 신뢰정합 | 게이지 '등급 경계'(30/60/80)가 실제 등급 컷(강한매수 50·매수 45·관망 30)과 불일치 — 등급 칩과 게이지 밴드·'다음 등급까지 +N'이 정면 모순 | `mobile/utils/signalDisplay.ts:55` |  |
| high | B-신호/B-2 | 인터랙션동선 | 매도 탭에서 검색 입력이 무기능 — 힌트는 '매수·매도 신호를 검색하세요'라고 약속하지만 매도 리스트는 검색어로 필터되지 않음 | `mobile/app/(tabs)/signals/index.tsx:209` |  |
| high | C-포트폴리오/C-1 | 신뢰정합 | 당겨 새로고침이 같은 화면의 형제 쿼리를 갱신하지 않아 '자산곡선 최신점과 동일' 문구가 스스로 깨짐 (DAR-210 패턴 재발) | `mobile/components/portfolio/SimulationStatusSection.tsx:339` |  |
| high | D-설정알림/D-1 | 인터랙션동선 | 알림 설정 미저장 변경 가드가 Android 하드웨어 back·제스처에서 우회됨 | `mobile/app/settings-detail/notification-settings.tsx:92` |  |
| high | E-공시기업/E-1 | 인터랙션동선 | 기업 상세 '통계' 탭 이벤트 유형 칩 — 선택하면 칩 행 자체가 소멸해 다른 유형으로 못 돌아가는 트랩 | `mobile/app/company/[corpCode].tsx:169` |  |
| high | S-성능/P-1 | 성능 | 캔들차트 스크럽 시 전체 SVG 캔들 레이어가 매 이동 이벤트마다 재렌더 | `mobile/components/company/DailyCandleChart.tsx:193` |  |
| high | S-신뢰정합/A-1 | 신뢰정합 | 같은 모의운용 포트폴리오의 '누적 수익률'이 화면마다 다른 정의(평가 기준 vs 실현 기준)로 표기 | `mobile/components/portfolio/SimulationStatusSection.tsx:185` |  |
| high | S-접근성/A-1 | 접근성 | 공용 Button: accessibilityRole 부재 + loading 시 스크린리더 무음 | `mobile/components/common/Button.tsx:80` |  |
| high | S-접근성/A-2 | 접근성 | tabInactive·inputPlaceholder 토큰 대비 미달 (2.54~3.11:1, 양 테마) | `mobile/theme/colors.ts:123` |  |
| medium | A-진입홈/A-3 | 성능 | 홈 ListHeaderComponent에 매 렌더 새 컴포넌트 타입 전달 — 세그먼트 토글마다 헤더 전체 리마운트 | `mobile/app/(tabs)/home/index.tsx:457` |  |
| medium | A-진입홈/A-4 | 인터랙션동선 | 피드 기본 탭이 콜드스타트에서 항상 '전체 공시' — 관심기업 보유자 기본 진입 의도 불발 + 관심 0개 시 stale 'watchlist' 상태 | `mobile/app/(tabs)/home/index.tsx:72` |  |
| medium | A-진입홈/A-5 | 상태처리 | 카카오 딥링크 콜백의 error 경로가 실패 사유를 버리고 무음으로 로그인 화면 복귀 | `mobile/app/kakao.tsx:41` |  |
| medium | A-진입홈/A-6 | 상태처리 | 온보딩 1단계 관심기업 일괄 등록의 부분 실패가 무음 처리 — 사용자는 전부 등록됐다고 인지 | `mobile/app/onboarding/index.tsx:84` |  |
| medium | B-신호/B-3 | 신뢰정합 | 음수 buyScore(백엔드 −100~100)를 게이지가 0으로 클램프 — 상세 화면에서 헤더 '0' vs Score근거 '최종 Buy Score −N점' 같은 화면 수치 모순 | `mobile/components/common/ScoreGauge.tsx:137` |  |
| medium | B-신호/B-4 | 접근성 | signals/[id] 커스텀 헤더 4중 복제 — 공용 ScreenHeader 미사용으로 뒤로가기 터치영역 22pt(<44), 아이콘·정렬도 드리프트 | `mobile/app/signals/[id].tsx:212` |  |
| medium | B-신호/B-5 | 상태처리 | pull-to-refresh가 화면 최상단 L1 '오늘 주목할 신호' 큐레이션을 갱신하지 않음(매수·매도 피드 공통) | `mobile/components/signals/SignalExplorer.tsx:346` |  |
| medium | C-포트폴리오/C-2 | 이해도 | 내부·운영자 용어 사용자 노출 잔존: '졸업지표'·'Sharpe'·'point-in-time'·'Thesis'·'persona' (6/27 W1 미완) | `mobile/components/portfolio/SimulationStatusSection.tsx:197` |  |
| medium | C-포트폴리오/C-3 | 상태처리 | 실전 탭 요약(총평가금액)·리스크 쿼리 실패가 무음 — 헤드라인 카드가 안내 없이 사라짐 | `mobile/app/(tabs)/portfolio/index.tsx:178` |  |
| medium | C-포트폴리오/C-4 | 접근성 | 성과 리포트 탭바·정밀도/보정 섹션 탭·D+20/D+5 토글 터치영역 44pt 미달 | `mobile/app/portfolio/trade-history.tsx:549` |  |
| medium | C-포트폴리오/C-5 | 성능 | EquityCurveChart 점별 44pt 히트영역이 1년 백테스트 곡선(~250점)에서 전면 겹침 — 점 선택 불능 + Pressable 250개 렌더 | `mobile/components/portfolio/EquityCurveChart.tsx:149` |  |
| medium | D-설정알림/D-2 | 상태처리 | 알림 '모두 읽음'이 결과 확인 전 성공 스낵바를 띄우고, 실패 시 무음·낙관적 업데이트도 없음 | `mobile/app/(tabs)/notifications/index.tsx:271` |  |
| medium | D-설정알림/D-3 | 상태처리 | 저장 공시 해제: 성공 스낵바 선표시 + 실패 무음 + 항목이 한 왕복 동안 목록에 잔존 | `mobile/app/settings-detail/saved-disclosures.tsx:51` |  |
| medium | D-설정알림/D-5 | 접근성 | 키워드 태그 삭제(X) 버튼: 44pt 미달 + accessibilityLabel/Role 부재 + 제3 아이콘 라이브러리(phosphor) | `mobile/app/settings-detail/notification-settings.tsx:420` |  |
| medium | E-공시기업/E-2 | 인터랙션동선 | 통합 검색 — 섹션 헤더에 '공시 N건' 총계를 보여주면서 첫 페이지 이후를 볼 방법이 없음(막다른 길) | `mobile/app/search/index.tsx:99` |  |
| medium | E-공시기업/E-3 | 상태처리 | 기업 상세 6탭 중 판단·재무·내부자 탭만 pull-to-refresh 부재(공시·통계·적합도 탭은 있음) | `mobile/components/company/DecisionHubTab.tsx:181` |  |
| medium | E-공시기업/E-4 | 접근성 | 전체 공시 목록 — 관심목록·유형 필터 칩에 accessibilityRole/State/Label 전무(보조 필터 칩과 비대칭) | `mobile/app/disclosures/index.tsx:369` |  |
| medium | E-공시기업/E-5 | 접근성 | 공시 목록·상세·원문 뷰어 헤더 뒤로가기 터치 타깃이 44pt 미만(≈42pt) — 철학/기업 화면(44pt 보장)과 비일관 | `mobile/app/disclosures/index.tsx:278` |  |
| medium | E-공시기업/E-6 | 신뢰정합 | 종목 차트 화면 헤더 — 부제 '실시간 분봉 · 현재가'가 장 마감·종가 상태에서도 무조건 표기, 제목은 기업명 없이 원시 코드 | `mobile/app/stock/[stockCode].tsx:93` |  |
| medium | E-공시기업/E-10 | 인터랙션동선 | 기업 상세 '최근 공시' 섹션 — 그 기업의 전체 공시 이력으로 가는 동선이 없음 | `mobile/app/company/[corpCode].tsx:749` |  |
| medium | S-성능/P-2 | 성능 | useCompanyBuySignal이 종목 1건 조회에 전체 매수신호 피드를 corpCode별 캐시키로 매번 전량 fetch | `mobile/hooks/useSignals.ts:44` |  |
| medium | S-성능/P-3 | 성능 | 홈 졸업 트래커·퍼널 45초 폴링이 다른 탭/스택 화면 체류 중에도 세션 내내 지속 | `mobile/hooks/useGraduationMetrics.ts:13` |  |
| medium | S-성능/P-4 | 성능 | 홈 FlatList ListHeader/ListFooter를 useCallback 함수 컴포넌트로 전달 — deps 변경마다 서브트리 전체 unmount/remount | `mobile/app/(tabs)/home/index.tsx:295` |  |
| medium | S-성능/P-5 | 성능 | 포트폴리오 탭 진입 시 6개 서브탭 중 어느 탭이든 실전 3종+모의 1종 쿼리가 무조건 동시 발사 | `mobile/app/(tabs)/portfolio/index.tsx:78` |  |
| medium | S-신뢰정합/A-2 | 신뢰정합 | PriceChangeChip 정보시트 카피('등락률·실시간 아닐 수 있음·호가/체결가 확인')가 모의 수익률 맥락과 모순 | `mobile/components/common/PriceChangeChip.tsx:27` |  |
| medium | S-신뢰정합/B-1 | 이해도 | 내부 용어 'Sharpe'·'Profit Factor'·'졸업지표' 잔존 — 홈(DAR-446 순화 완료)과 이중 네이밍 | `mobile/app/portfolio/backtest-track-record.tsx:103` |  |
| medium | S-신뢰정합/C-1 | 일관성토큰 | numberFormat.ts 정본 우회 인라인 포맷터 클러스터 — '+0.00%'·'-0.00%'(DAR-312 음수영점 규칙 재위반)와 자릿수 드리프트 | `mobile/components/portfolio/SimulationStatusSection.tsx:185` |  |
| medium | S-신뢰정합/D-1 | 신뢰정합 | FOMO·과대약속 카피 — '놓치지 마세요'(Pro)와 '투자 판단 받아보기'(인트로·온보딩) | `mobile/app/settings-detail/pro.tsx:97` |  |
| medium | S-일관성토큰/A-1 | 일관성토큰 | ScreenHeader 미채택 자체 헤더 6개 화면 — 뒤로가기 아이콘·제목 정렬·타이포가 화면마다 제각각 | `mobile/app/philosophy/index.tsx:78` |  |
| medium | S-일관성토큰/A-2 | 일관성토큰 | Feather 외 Ionicons 인라인 아이콘 신규 잔존 7개 파일(알려진 탭 편차·#425 대상 외) | `mobile/app/(tabs)/notifications/index.tsx:38` |  |
| medium | S-접근성/A-3 | 접근성 | 홈 세그먼트 탭·공시 필터 칩: role/accessibilityState(selected) 부재 — 선택 상태가 색 단독 | `mobile/app/(tabs)/home/index.tsx:180` |  |
| medium | S-접근성/A-4 | 접근성 | Button 고정 fontSize(14/16/18) — 전역 allowFontScaling=false 체계에서 사용자 글꼴 배율에 전혀 불응 | `mobile/components/common/Button.tsx:49` |  |
| medium | S-접근성/A-5 | 접근성 | 알림설정 키워드 삭제 X 버튼: 유효 터치 30×30pt + accessibilityLabel/Role 부재 | `mobile/app/settings-detail/notification-settings.tsx:420` |  |
| medium | S-접근성/A-6 | 접근성 | 통합검색 화면 클리어·백 버튼 터치 타깃 미달 — SearchOverlay 정본(symmetricHitSlopForIcon) 미적용 드리프트 | `mobile/app/search/index.tsx:261` |  |
| medium | S-접근성/A-7 | 접근성 | 설정 GUEST '로그인하기' 링크: role 없음 + 유효 높이 약 20pt(hitSlop 없음) | `mobile/app/(tabs)/settings/index.tsx:236` |  |
| low | A-진입홈/A-2 | 접근성 | 게스트 잠금 카드(LockedCard)가 다크모드에서 텍스트·아이콘이 사실상 보이지 않음 | `mobile/components/home/HomeSignalPreview.tsx:167` |  |
| low | A-진입홈/A-7 | 밀도위계 | 홈에 '운용 성과' 제목이 연속 2회 노출 + 하위 섹션 헤딩·카드 타이틀 라벨 불일치('신호가 진입으로' vs '신호에서 체결까지') | `mobile/components/home/GraduationTracker.tsx:231` |  |
| low | A-진입홈/A-8 | 접근성 | 로그인 화면 약관·개인정보 링크가 중첩 Text onPress — 역할(link) 미지정·44pt 터치영역 미달 | `mobile/app/auth/sign-in.tsx:293` |  |
| low | A-진입홈/A-9 | 상태처리 | 게스트 상태에서 탭 셸이 usePositions()를 게이팅 없이 호출 — 보장된 401 요청, 한 줄 위 useUnreadCount 게이팅과 비일관 | `mobile/app/(tabs)/_layout.tsx:28` |  |
| low | A-진입홈/A-10 | 일관성토큰 | 탭 바 스타일 매직넘버(height 88·padding 8·fontSize 12/11) — 토큰 미사용, 고정 높이가 기기별 하단 인셋 변화 흡수 못함 | `mobile/app/(tabs)/_layout.tsx:37` |  |
| low | B-신호/B-6 | 신뢰정합 | 탐색 피드 결과수 'N건' 라벨은 서버 total, 실제 리스트는 종목당 1카드로 디듑된 목록 — 표기 건수와 표시 카드 수 불일치 | `mobile/components/signals/SignalExplorer.tsx:160` |  |
| low | B-신호/B-7 | 상태처리 | 신호 상세만 generic ErrorState 사용 — 연결 실패를 구분하는 ApiErrorState 패턴(리스트 3개 표면 공통)에서 이탈 | `mobile/app/signals/[id].tsx:154` |  |
| low | B-신호/B-8 | 밀도위계 | 상세 화면 만료 정보 이중 표기 — 상단 '유효: 날짜 까지' 메타행과 최하단 '날짜시각 만료' 행이 같은 정보를 다른 형식으로 2회 노출 | `mobile/app/signals/[id].tsx:406` |  |
| low | B-신호/B-9 | 신뢰정합 | 매도 빈 상태 카피 '모든 포지션이 안전 구간에 있어요' — 포지션 0개·평가 미실행이어도 동일하게 안전을 단정 | `mobile/components/common/emptyStateCopy.ts:81` |  |
| low | B-신호/B-10 | 신뢰정합 | 상세 헤더의 대표 표본수가 scoreBreakdown 중 '최대' sampleN — 가장 유리한 표본을 대표값으로 노출해 근거 강건성 과대표현 | `mobile/app/signals/[id].tsx:187` |  |
| low | C-포트폴리오/C-6 | 일관성토큰 | 실전 vs 내 모의 손익 헤드라인 행 비통일 — 아이콘·타이포 위계·금액 '+' 부호 상이 (DAR-451 C2 부분 미완) | `mobile/app/(tabs)/portfolio/index.tsx:310` |  |
| low | C-포트폴리오/C-7 | 상태처리 | 드릴다운 화면 로딩 패턴 드리프트 — 스피너(LoadingState) vs 스켈레톤 혼재 + Thesis 화면 pull-to-refresh 부재 | `mobile/app/portfolio/auto-trading.tsx:232` |  |
| low | C-포트폴리오/C-8 | 인터랙션동선 | 포트폴리오 탭 재탭 최상단 복귀가 실전/내 모의에서만 동작 — 시스템 검증 4개 서브탭 미지원 | `mobile/app/(tabs)/portfolio/index.tsx:72` |  |
| low | C-포트폴리오/C-9 | 일관성토큰 | InlineDisclosure 로컬 3중 복제 — 컴포넌트 드리프트(기능·스타일 편차 잠복) | `mobile/components/portfolio/IntradayScalpSection.tsx:62` | **#424/#425 머지 시 해소** |
| low | C-포트폴리오/C-10 | 인터랙션동선 | 전략 타임라인 잘못된 키 빈상태의 '전략 비교로' 버튼이 실제로는 뒤로가기 — 라벨과 동작 불일치 | `mobile/app/portfolio/strategy/[key].tsx:199` |  |
| low | D-설정알림/D-4 | 상태처리 | 알림 설정의 '공시 유형' 목록이 로딩·에러 시 아무 안내 없이 빈 섹션으로 렌더됨 | `mobile/app/settings-detail/notification-settings.tsx:60` |  |
| low | D-설정알림/D-6 | 상태처리 | 프로필 저장이 React Query를 우회한 직접 api.patch + useMe 캐시 미무효화 | `mobile/app/settings-detail/profile.tsx:33` |  |
| low | D-설정알림/D-7 | 접근성 | 설정 게스트 헤더 '로그인하기' 링크: 터치영역 44pt 미달·role 미지정 | `mobile/app/(tabs)/settings/index.tsx:236` |  |
| low | D-설정알림/D-8 | 이해도 | Pro 화면 제품명 'DART 알리미 Pro'가 앱 브랜드 '공시온'과 불일치 | `mobile/app/settings-detail/pro.tsx:94` |  |
| low | D-설정알림/D-9 | 일관성토큰 | 알림·관심목록·저장 공시 화면에 Ionicons 잔존 — DAR-470 Feather 통일의 미완 영역 | `mobile/app/(tabs)/notifications/index.tsx:12` |  |
| low | D-설정알림/D-10 | 성능 | AI 비용 화면: '고급' 접힘 상태에서도 6개 쿼리 전부 즉시 발화 | `mobile/app/settings-detail/ai-cost.tsx:481` | **#424/#425 머지 시 해소** |
| low | E-공시기업/E-7 | 일관성토큰 | 기업 '통계' 탭 표본 경고가 공용 DataLimitBadge 규약(DAR-121) 대신 자체 배너 + 하드코딩 알파색 사용 | `mobile/app/company/[corpCode].tsx:199` |  |
| low | E-공시기업/E-8 | 일관성토큰 | 검색 규약(E12) 잔존 드리프트 — 공시 검색바는 Ionicons·최소 1자, 통합 검색은 Feather·최소 2자 | `mobile/app/disclosures/index.tsx:304` |  |
| low | E-공시기업/E-9 | 접근성 | 공시 상세 정보 카드 — 비대화형 행까지 TouchableOpacity(disabled)로 렌더되고 탭 가능한 기업명 행에 role/label 부재 | `mobile/app/disclosure/[id].tsx:263` |  |
| low | S-성능/P-6 | 성능 | 보이지 않는 차트 데이터 fetch/폴링 미게이팅 — 접힌 분봉 차트가 장중 60초 폴링, 분봉 탭에서 일봉 선행 fetch | `mobile/app/company/[corpCode].tsx:361` | **#424/#425 머지 시 해소** |
| low | S-성능/P-7 | 성능 | EquityCurveChart가 포인트당 SVG Circle + 절대배치 Pressable을 생성 — 1년 곡선(~250pt)에서 ~500 엘리먼트 | `mobile/components/portfolio/EquityCurveChart.tsx:149` |  |
| low | S-성능/P-8 | 성능 | 시세 폴링 간격이 렌더 시점 정적 평가 — 장 개장 경계를 넘겨도 refetchInterval이 재판정되지 않음 | `mobile/app/company/[corpCode].tsx:349` |  |
| low | S-성능/P-9 | 성능 | AI 비용 화면 진입 시 6개 쿼리 동시 발사 — '고급' 접힘 상태와 무관 | `mobile/app/settings-detail/ai-cost.tsx:481` | **#424/#425 머지 시 해소** |
| low | S-신뢰정합/E-1 | 신뢰정합 | 수수료 반영 기준 고지 비일관 — 단타만 '순수익(수수료 후)' 명시, 시스템 모의·스타일·전략·백테스트는 무고지 | `mobile/components/portfolio/IntradayScalpSection.tsx:173` |  |
| low | S-신뢰정합/F-1 | 이해도 | 같은 필드(upProbD5)가 '승률(D+5)'와 '상승 확률 D+5' 두 이름 — 매매 승률과 어휘 충돌 | `mobile/app/event-stats/index.tsx:148` |  |
| low | S-신뢰정합/G-1 | 신뢰정합 | 승·패 집계에서 본전(손익 0) 처리 정의가 백테스트와 매매 성적표에서 상이 | `backend/src/engine5-trading-risk/paper-simulation/trade-scorecard.ts:206` |  |
| low | S-일관성토큰/B-1 | 일관성토큰 | 공시유형 뱃지 팔레트 14쌍 hex가 theme 밖(utils/disclosureType.ts)에 하드코딩 + isDark 기본값 false 풋건 | `mobile/utils/disclosureType.ts:16` |  |
| low | S-일관성토큰/C-1 | 밀도위계 | 알림 행에 이모지 SSOT(📢 등 10종)와 Ionicons 아이콘이 이중 표기 — 이모지·아이콘 두 시각 시스템 병행 | `mobile/utils/notificationSource.ts:20` |  |
| low | S-일관성토큰/D-1 | 상태처리 | 로딩 표현 드리프트 — settings-detail 3화면이 StateView.LoadingState 대신 수제 스피너 + 고아 Loading.tsx 중복 존재 | `mobile/app/settings-detail/saved-disclosures.tsx:118` |  |
| low | S-일관성토큰/E-1 | 일관성토큰 | 잔존 매직넘버 스페이싱 — 토큰 스케일 밖 값 5곳(borderRadius 18, paddingTop 60, marginLeft 22) | `mobile/components/philosophy/PhilosophyChecklist.tsx:279` |  |
| low | S-일관성토큰/E-2 | 일관성토큰 | GlassCard 장식 그라데이션에 rgba 리터럴 12개 하드코딩(다크 인지형이나 토큰 밖) | `mobile/components/common/GlassCard.tsx:38` |  |
| low | S-일관성토큰/E-3 | 일관성토큰 | 고아 컴포넌트 LogoMark.tsx — 렌더처 0곳인데 하드코딩 색(#2DD4BF·#F43F5E·white)과 fontSize 42 잔존 | `mobile/components/common/LogoMark.tsx:87` |  |
| low | S-접근성/A-8 | 접근성 | 저장공시·관심기업 리스트 카드 행: role=button·합성 라벨 없는 무명 터치 영역 | `mobile/app/settings-detail/saved-disclosures.tsx:67` |  |
| low | S-접근성/A-9 | 접근성 | 온보딩 '나중에 하기' 스킵·공시상세 infoRow: role/label 누락 + 스킵 버튼 36pt | `mobile/app/onboarding/index.tsx:281` |  |

---
*작성: 2026-07-02 UI/UX 정밀 리뷰 세션 (36 에이전트, 발견별 반박검증). 다음 갱신: 1차 UXR 처리 후 재검증 시.*
