> 상위 문서: [역할 인덱스](./README.md) · [실행 로드맵](../01-execution-roadmap.md)

# 앱 프론트(FE) 역할 정의서

> 최종 수정일: 2026-06-02 · 스택: React Native Expo (Expo Router · React Query · Zustand · RN Paper) · 스타일: StyleSheet + `theme/colors.ts`

---

## 1. 역할 정의 & 책임 범위

### FE가 소유하는 것

| 영역 | 소유 내용 |
|------|-----------|
| **화면 구현** | 모든 Expo Router 화면 파일(`mobile/app/**/*.tsx`), 탭 레이아웃(`(tabs)/_layout.tsx`) |
| **컴포넌트** | `mobile/components/**` — 공통(Button, Card, GlassCard, Input, Loading…) + 도메인별 컴포넌트 |
| **React Query 훅** | `mobile/hooks/**` — 서버 상태 훅(`useSignals`, `usePortfolio`, `useOrderRequest` 등) |
| **Zustand 스토어** | `mobile/stores/**` — 클라이언트 상태(Persona 선택, Kill Switch 상태, 미읽음 배지 등) |
| **푸시·딥링크** | Expo 푸시 권한 요청, 토큰 등록, 딥링크 라우팅 처리 |
| **차트 렌더링** | 주가 차트·지표 시각화 컴포넌트 (M4 이후 단계적 도입) |
| **테마·스타일 규약** | `theme/colors.ts`의 `lightColors`/`darkColors` 기준, 인라인 스타일·매직넘버 금지 |
| **아이콘 규약** | Feather 아이콘 우선, Ionicons 지양 |

### FE가 소유하지 않는 것 (경계)

| 영역 | 담당 파트 |
|------|-----------|
| API 엔드포인트·Prisma 스키마 | BE |
| Buy Score·Exit Score 공식 | DQ |
| AI 프롬프트·출력 스키마 | AI |
| 화면 와이어프레임·정보구조 정의 | 화면 기획 |
| 사용자 시나리오·엣지케이스 정의 | 시나리오 기획 |
| 비투자자문 고지문·약관 문구 | 정책 기획 |
| CI/CD·앱 배포 파이프라인(EAS) | 인프라 |

FE는 화면 기획·시나리오 기획의 **확정 산출물**을 입력으로 받아 구현한다. 화면 사양이 확정되지 않은 상태에서 선행 구현을 시작하지 않는다.

---

## 2. 마일스톤별 업무 (M0~M12)

### M0 — 기준선 & 수집 안정화 · **[R: 주담당]**

책임 매트릭스: FE = `·`(해당 없음)이나, M0에서 확정되는 **유니버스(관심 종목), 공시 5종, Persona 4종** 정의가 M0 이후 모든 FE 화면의 데이터 기반이다.

**FE가 이 단계에서 해야 할 것 (입력 확인·준비)**

- [ ] 기존 온보딩 화면(`app/onboarding/index.tsx`)이 M0 범위 확정 후에도 동작하는지 스모크 테스트
- [ ] 기존 탭 네비게이션(홈/알림/설정), 공시 상세, 딥링크가 스키마 변경 후에도 정상 동작하는지 회귀 확인
- [ ] M0에서 확정되는 **Persona 4종(가치투자형/성장주형/모멘텀형/이벤트드리븐형)** 레이블·설명 문구를 화면 기획(산출물) 수령 후 `theme/colors.ts` 및 상수 파일에 사전 등록
- [ ] 향후 Persona 온보딩 화면 추가에 대비해 `app/onboarding/` 디렉터리 구조 검토

**받아야 할 입력:** 화면 기획으로부터 온보딩 Persona 선택 화면 와이어프레임

---

### M1 — 공시 원문 파싱 · **[해당 없음]**

FE 작업 없음. BE가 `DisclosureDocument`를 구축하는 단계.

**확인할 점:** 기존 공시 상세 화면(`app/disclosure/[id].tsx`)과 WebView 뷰어(`app/disclosure/viewer.tsx`)가 M1 이후 원문 링크 구조(rcpNo 기반 URL)와 정합성을 유지하는지 BE 인터페이스 변경 사항 주시.

---

### M2 — 이벤트·수치 추출 · **[해당 없음]**

FE 작업 없음. BE·DQ가 `DisclosureEvent`를 구축하는 단계.

**확인할 점:** M6 신호 카드에서 이벤트 타입 레이블을 표시하게 되므로, M2 완료 시 확정된 이벤트 enum(`SUPPLY_CONTRACT`, `SHARE_BUYBACK` 등) 목록을 화면 기획과 함께 수령해 한국어 레이블 상수 파일(`constants/eventType.ts`) 초안 작성 가능.

---

### M3 — AI Analyst + 비용계측 토대 · **[C: 협업]**

FE 기여 범위: AI 분석 결과를 표시하는 **공시 상세 화면 AI 요약 섹션** 선행 설계.

- [ ] `app/disclosure/[id].tsx`에 AI 요약 섹션 영역 확보 (BE `GET /disclosures/:rcpNo` 응답에 `aiSummary` 필드 추가 시 즉시 표시 가능한 골격 컴포넌트 작성)
- [ ] `components/disclosure/AiSummaryCard.tsx` 컴포넌트 — 요약·긍정요인·부정요인 표시, AI 미분석 시 스켈레톤/없음 상태 처리
- [ ] `components/disclosure/PersonaViewList.tsx` 컴포넌트 — 4 Persona 해석 목록 (POSITIVE/WATCH/NEUTRAL/NEGATIVE 배지 포함)
- [ ] 화면 기획·시나리오 기획으로부터 AI 요약 표시 화면 사양 수령 확인

**받아야 할 입력:** BE로부터 `DisclosureAnalysis` API 응답 스키마(`GET /disclosures/:rcpNo/analysis`) 계약서

---

### M4 — 시세·시장 데이터 (KRX) · **[C: 협업]**

FE 기여 범위: 주가 차트·지표 표시 컴포넌트 선행 구현.

- [ ] 차트 라이브러리 선정 및 의존성 추가 (`react-native-wagmi-charts` 또는 `victory-native` — `--legacy-peer-deps` 플래그 필수)
- [ ] `components/stock/StockChart.tsx` — 일봉 캔들차트 컴포넌트 (MA20/60 오버레이 선택)
- [ ] `components/stock/TechnicalIndicatorBadge.tsx` — RSI·MACD·거래량 비율 뱃지 컴포넌트
- [ ] `components/stock/PriceHeader.tsx` — 현재가·등락률·거래대금 헤더 컴포넌트
- [ ] `hooks/useStockChart.ts` — React Query 훅 (`GET /stocks/:stockCode/chart`)
- [ ] `hooks/useTechnicalIndicator.ts` — React Query 훅 (`GET /stocks/:stockCode/indicator`)
- [ ] 기업 상세 화면(`app/company/[corpCode].tsx`)에 차트 섹션 추가 (BE API 미완 시 mock data placeholder)
- [ ] 화면 기획으로부터 차트 표시 사양(기간 선택 탭: 1개월/3개월/1년) 수령 확인

**받아야 할 입력:** BE·인프라로부터 차트 조회 API 응답 스키마 및 지표 필드 목록

---

### M5 — Event Study · **[해당 없음]**

FE 작업 없음. DQ가 `EventStudyResult`를 구축하는 단계.

**확인할 점:** M6 신호 카드에서 "과거 유사 공시 평균 수익 +X.X%" 같은 통계를 표시하게 되므로, M5 완료 후 EventStudyResult API 응답 스키마를 BE로부터 수령.

---

### M6 — 매수 Signal Engine · **[R: 주담당]**

FE 주담당. 매수 후보 카드·신호 목록 화면 구현.

**신규 화면**

- [ ] `app/(tabs)/signals/index.tsx` — 매수 신호 피드 화면 (탭 추가 또는 홈 탭 내 섹션)
  - 신호 등급 필터(STRONG_BUY_CANDIDATE / BUY_CANDIDATE / WATCH)
  - Persona 필터 탭(전체 / 가치 / 성장 / 모멘텀 / 이벤트드리븐)
  - 무한 스크롤 (`useInfiniteQuery`)
- [ ] `app/signal/[id].tsx` — 신호 상세 화면
  - 점수 브레이크다운(7개 컴포넌트 바 차트)
  - 진입 조건 체크리스트(충족/미충족 구분)
  - 리스크 팩터 목록
  - AI 요약(`signalSummary`)
  - 공시 원문 링크 (딥링크)

**신규 컴포넌트**

- [ ] `components/signal/BuyCandidateCard.tsx` — 매수 후보 카드
  - corpName, eventType 한국어 레이블, buyScore 게이지, signalGrade 배지
  - entryReady 여부 표시 (진입조건 충족 여부)
  - 탭 → 신호 상세로 라우팅
- [ ] `components/signal/ScoreBreakdownBar.tsx` — 컴포넌트별 점수 시각화 가로 바
- [ ] `components/signal/EntryConditionList.tsx` — 충족(초록)/미충족(회색) 체크리스트
- [ ] `components/signal/SignalGradeBadge.tsx` — 등급 배지 (색상: STRONG_BUY=teal, BUY=blue, WATCH=amber, NEUTRAL=gray, AVOID=red, BLOCKED=black)
- [ ] `components/signal/RiskFactorChips.tsx` — 리스크 팩터 칩 목록

**훅**

- [ ] `hooks/useSignals.ts` — `GET /buy-signal/candidates` React Query 훅 (필터·페이지네이션)
- [ ] `hooks/useSignalDetail.ts` — `GET /buy-signal/:id` React Query 훅
- [ ] `hooks/useSignalsByDisclosure.ts` — `GET /buy-signal/by-disclosure/:rcpNo` 훅

**Zustand 스토어**

- [ ] `stores/signalFilterStore.ts` — Persona 필터·등급 필터·entryReady 필터 클라이언트 상태

**푸시 딥링크 확장**

- [ ] STRONG_BUY_CANDIDATE 푸시 알림 수신 시 `app/signal/[id].tsx`로 딥링크 처리
- [ ] `app/_layout.tsx` 딥링크 핸들러에 `/signal/:id` 경로 추가

**AI 금지영역 FE 관점 준수**

- 신호 상세 화면에 "이 AI 분석은 투자 참고 목적이며, 투자 판단의 책임은 사용자에게 있습니다" 고지 문구 표시 (정책 기획 산출물 기준)
- buyScore·신호 등급을 "매수 지시"로 오인하게 하는 UI 표현(예: "지금 사세요") 사용 금지

**받아야 할 입력:**
- 화면 기획으로부터: 신호 피드·신호 상세 와이어프레임 확정본
- 시나리오 기획으로부터: 신호 알림 수신 → 상세 조회 → 공시 원문 확인 유저 플로우
- BE로부터: `GET /buy-signal/candidates`, `GET /buy-signal/:id` 응답 DTO 계약

---

### M7 — Position Thesis · **[R: 주담당]**

FE 주담당. Thesis 상세 화면 구현.

**신규 화면**

- [ ] `app/portfolio/index.tsx` — 포트폴리오 현황 화면 (포지션 목록)
  - 보유 종목 카드(종목명·평가손익·손익률·ThesisStatus 배지)
  - 가상 포트폴리오(isPaper=true)와 실전 분리 표시
- [ ] `app/portfolio/position/[id].tsx` — 포지션 상세 화면
  - Thesis 요약 (entryReason, persona, eventType)
  - initialThesis 항목 목록
  - invalidConditions 항목 목록 (훼손 감지 시 강조 표시)
  - 손절·익절 기준 표시 (stopLossHardPct, takeProfitPartialPct)
  - ThesisStatus FSM 상태 표시 (ACTIVE/WATCHING/VIOLATED/EXPIRED/CLOSED)
- [ ] `app/portfolio/position/[id]/thesis.tsx` — Thesis 상세 전용 화면

**신규 컴포넌트**

- [ ] `components/portfolio/PositionCard.tsx` — 포지션 카드 (종목·수익률·ThesisStatus)
- [ ] `components/portfolio/ThesisStatusBadge.tsx` — ACTIVE(초록)/WATCHING(주황)/VIOLATED(빨강)/EXPIRED(회색)/CLOSED(어두운 회색)
- [ ] `components/portfolio/ThesisConditionList.tsx` — initialThesis / invalidConditions 목록 (훼손 항목 강조)
- [ ] `components/portfolio/StopLossGauge.tsx` — 현재가 대비 손절선 게이지 (Rule 기반 표시, AI 결정값 절대 표시 금지)
- [ ] `components/portfolio/TakeProfitMarker.tsx` — 익절 기준 마커

**훅**

- [ ] `hooks/usePortfolio.ts` — `GET /portfolios/:id` React Query 훅
- [ ] `hooks/usePosition.ts` — `GET /positions/:id` React Query 훅
- [ ] `hooks/useThesis.ts` — `GET /positions/:id/thesis` React Query 훅

**AI 금지영역 FE 관점 준수**

- 손절·익절 수치는 BE Rule Engine이 계산한 값을 그대로 표시하며, FE에서 사용자가 수정하는 UI 제공 금지 (Phase 13 이전)
- Thesis의 `invalidConditions` 항목을 "AI가 판단한 매도 신호"로 표현하지 않음 — "투자 논리 검토 조건"으로 표현

**받아야 할 입력:**
- 화면 기획으로부터: 포트폴리오·포지션·Thesis 화면 와이어프레임
- BE로부터: `GET /portfolios/:id`, `GET /positions/:id/thesis` 응답 DTO

---

### M8 — Portfolio & Exit Engine · **[R: 주담당]**

FE 주담당. 매도 후보 카드·Exit Alert 화면 구현.

**신규 화면**

- [ ] `app/portfolio/exit-candidates.tsx` — 매도 후보 목록 화면
  - ExitScore 내림차순 정렬
  - 액션별 필터(EXIT / REDUCE / WATCH)
  - 매도 후보 카드 리스트

**신규 컴포넌트**

- [ ] `components/portfolio/ExitCandidateCard.tsx` — 매도 후보 카드
  - corpName, exitScore, exitAction(HOLD/WATCH/REDUCE/EXIT/BLOCK_REBUY) 배지
  - 트리거 요약(손실 제한/투자논리 훼손/차트훼손/시간초과 등)
  - 탭 → Exit 상세로 라우팅
- [ ] `components/portfolio/ExitScoreBreakdown.tsx` — Exit Score 구성 요소 바 (6종 트리거 기여도)
- [ ] `components/portfolio/ExitActionBadge.tsx` — 액션 배지 (EXIT=빨강, REDUCE=주황, WATCH=주황-연, HOLD=초록, BLOCK_REBUY=회색)
- [ ] `components/portfolio/ExitAlertBanner.tsx` — ThesisStatus=VIOLATED 발생 시 화면 상단 배너

**훅**

- [ ] `hooks/useExitCandidates.ts` — `GET /positions/pending-exit` React Query 훅
- [ ] `hooks/useExitSignal.ts` — `GET /exit-signal/:id` React Query 훅

**푸시 딥링크 확장**

- [ ] EXIT 액션 ExitSignal 발생 시 푸시 알림 → `app/portfolio/exit-candidates.tsx` 딥링크
- [ ] VIOLATED Thesis 발생 시 배너 알림 → 해당 포지션 상세 딥링크

**AI 금지영역 FE 관점 준수**

- 매도 후보 카드에 "AI가 매도를 권유합니다" 표현 금지
- Exit Score와 액션은 Rule Engine 산출물임을 UI에서 명확히 표현
- "지금 매도하세요" 같은 지시형 문구 사용 금지 — "매도 검토 필요" 수준으로 표현

**받아야 할 입력:**
- 화면 기획·시나리오 기획으로부터: Exit Alert 화면 사양·엣지케이스(ExitScore 90↑ 즉시알림 등)
- BE로부터: `GET /exit-signal/:id`, `GET /positions/pending-exit` 응답 DTO

---

### M9 — 백테스트 · **[해당 없음]**

FE 작업 없음. DQ·QA·인프라가 백테스트 엔진을 검증하는 단계.

**확인할 점:** M10 모의투자 화면에서 백테스트 성과 지표를 표시할 수 있도록, M9 완료 후 `GET /backtest/:id/result` 응답 스키마를 BE·DQ로부터 수령해 화면 설계에 반영.

---

### M10 — 모의투자 + 비용 거버넌스 ★MVP 졸업 게이트 · **[R: 주담당]**

FE 주담당. 모의 포트폴리오 현황·AI 비용 대시보드 화면 구현.

**신규 화면**

- [ ] `app/(tabs)/paper-portfolio/index.tsx` — 모의 포트폴리오 현황 탭
  - 모의 잔고·누적 손익·손익률
  - 모의 포지션 목록(PositionCard 재사용, isPaper=true 뱃지)
  - 30일/60일/90일 누적 성과 요약 카드
  - 백테스트 성과와 비교 섹션
- [ ] `app/paper-portfolio/metrics.tsx` — 모의투자 성과 지표 화면
  - 신호 적중률, 누적 수익, 수집 성공률, Exit 정확도
  - 이벤트 타입별 성과 테이블
  - AI 비용 섹션(아래 화면 병합 가능)
- [ ] `app/settings-detail/ai-cost.tsx` — AI 비용 현황 화면
  - L0/L1/L2/L3 게이트별 호출 건수·비용 요약
  - AI비용/모의순익 비율 게이지
  - 일별 비용 추이 차트

**신규 컴포넌트**

- [ ] `components/paper/PaperPortfolioSummary.tsx` — 모의 잔고·손익 요약 카드
- [ ] `components/paper/PaperTradeCard.tsx` — 가상 체결 카드 (매수/매도, 체결가, 손익)
- [ ] `components/paper/BacktestComparisonRow.tsx` — 백테스트 가정 vs 모의 실측 비교 행
- [ ] `components/cost/AiCostGauge.tsx` — AI비용/순익 비율 게이지 (목표 ≤20%, 초과 시 경고색)
- [ ] `components/cost/AiCostByLevel.tsx` — L0~L3 비용 내역 테이블

**훅**

- [ ] `hooks/usePaperPortfolio.ts` — `GET /portfolios?isPaper=true` React Query 훅
- [ ] `hooks/usePaperTrades.ts` — `GET /paper-trades` React Query 훅
- [ ] `hooks/useAiCostMetrics.ts` — `GET /ai-usage/metrics` React Query 훅

**MVP 졸업 게이트 관련 FE 완료 조건**

- [ ] M6~M8 구현 화면 전체 회귀 확인 (신호 피드, 포트폴리오, Exit 카드)
- [ ] 기존 M0 화면(홈/알림/설정/공시상세/관심/저장) 회귀 확인
- [ ] `app/(tabs)` 탭 구조가 M10까지 추가된 탭을 모두 수용하는지 레이아웃 검증
- [ ] 딥링크 경로 전수 확인 (`/signal/:id`, `/portfolio/position/:id`, 기존 `/disclosure/:id`)

**받아야 할 입력:**
- BE로부터: `GET /paper-trades`, `GET /ai-usage/metrics` 응답 DTO
- 화면 기획·시나리오 기획으로부터: 모의투자 현황·AI 비용 화면 사양

---

### M11 — 반자동매매 · **[R: 주담당]**

FE 주담당. 주문 승인 카드 UI 구현 (핵심 화면).

**신규 화면**

- [ ] `app/order/[id].tsx` — 주문 승인 카드 화면
  - 매수/매도 구분 헤더
  - 종목명·현재가·주문 수량·예상 금액
  - Buy Score / Exit Score 요약
  - 투자 근거 요약 (PositionThesis.entryReason 또는 ExitSignal 트리거 요약)
  - 리스크 팩터 목록
  - Risk Engine 사전체크 결과 표시 (6항목 통과/차단 여부)
  - **[승인] [거절] [관망] 3-버튼 액션**
  - 고지 문구: "최종 투자 결정 및 책임은 사용자에게 있으며, 본 시스템은 투자자문을 제공하지 않습니다."
- [ ] `app/order/history.tsx` — 주문 이력 화면 (체결/거절/관망 필터)

**신규 컴포넌트**

- [ ] `components/order/OrderApprovalCard.tsx` — 주문 승인 카드 최상위 컴포넌트
- [ ] `components/order/OrderActionButtons.tsx` — [승인] [거절] [관망] 버튼 그룹
  - 승인 버튼: 로딩 상태 처리, 중복 탭 방지 (멱등 처리)
  - 거절/관망 버튼: 사유 선택 하단 시트
- [ ] `components/order/RiskCheckList.tsx` — Risk 사전체크 6항목 통과/차단 표시
- [ ] `components/order/OrderAmountRow.tsx` — 주문 수량·예상 금액 표시 행 (수량은 Rule Engine 산출값, FE에서 수정 UI 제공 금지 — AI 금지영역)
- [ ] `components/order/OrderHistoryItem.tsx` — 주문 이력 리스트 아이템

**훅**

- [ ] `hooks/useOrderRequest.ts` — `GET /order-requests/:id` React Query 훅
- [ ] `hooks/useApproveOrder.ts` — `PATCH /order-requests/:id/approve` React Query mutation
- [ ] `hooks/useRejectOrder.ts` — `PATCH /order-requests/:id/reject` mutation
- [ ] `hooks/useOrderHistory.ts` — `GET /order-requests` 목록 훅

**Zustand 스토어**

- [ ] `stores/pendingOrderStore.ts` — 미처리 주문 건수·배지 상태

**푸시 딥링크 확장**

- [ ] OrderRequest(status=PENDING_USER) 생성 시 푸시 알림 → `app/order/[id].tsx` 딥링크
- [ ] 콜드스타트·포그라운드 딥링크 핸들러에 `/order/:id` 경로 추가

**AI 금지영역 FE 관점 — 가장 중요한 단계**

- **[승인] 버튼은 사용자만 탭할 수 있다.** FE에서 자동 탭·자동 제출 로직 절대 금지
- 주문 수량·금액을 FE에서 계산하거나 수정하는 로직 금지 — BE Risk Engine 산출값 표시만
- "AI가 승인을 권장합니다" 같은 문구 표시 금지
- 모든 버튼 액션은 `OrderApprovalCard` 내부에서 로딩·에러·성공 상태를 완전히 처리

**받아야 할 입력:**
- 화면 기획·시나리오 기획으로부터: 주문 승인 카드 와이어프레임·시나리오(정상/RISK_BLOCKED/타임아웃/네트워크 에러)
- 정책 기획으로부터: 비투자자문 고지 문구 확정본
- BE로부터: `POST /order-requests/:id/approve|reject|watch` 응답 DTO·에러 코드

---

### M12 — 제한적 자동매매 · **[R: 주담당]**

FE 주담당. 자동매매 설정·모니터 화면·Kill Switch 토글 구현.

**신규 화면**

- [ ] `app/settings-detail/auto-trading.tsx` — 자동매매 설정 화면
  - 전략별 자동매매 on/off 토글 목록 (화이트리스트 6종 이벤트)
  - 각 전략의 백테스트 통과 여부·모의투자 성과 요약 표시 (활성화 게이트 정보)
  - 하드 리스크 룰 표시 (1회 최대 1~3%, 단일 종목 5~10%, 일 손실 -2%, 주 손실 -5%) — **읽기 전용 표시, 수정 불가**
  - **Kill Switch 토글 (빨간 버튼, 즉시 동작)** — 탭 시 확인 다이얼로그 표시
- [ ] `app/auto-trading/monitor.tsx` — 자동매매 모니터 화면
  - 오늘 자동 실행된 주문 목록 (실시간 폴링 또는 SSE)
  - 현재 자동매매 상태 (활성/일시정지/Kill Switch 작동)
  - 일 손실 한도 소진 게이지
  - 연속 손실 횟수 표시
  - 이상 감지 알림 배너

**신규 컴포넌트**

- [ ] `components/auto-trading/KillSwitchButton.tsx` — Kill Switch 토글 버튼
  - 활성: 빨간 배경 "자동매매 즉시 중단" 레이블
  - 탭 시 확인 다이얼로그(`DialogProvider` 재사용): "정말 자동매매를 중단하시겠습니까?"
  - 중단 후 재활성화는 설정 화면에서 별도 절차
- [ ] `components/auto-trading/StrategyToggleRow.tsx` — 전략별 on/off 토글 행 (게이트 미통과 전략은 토글 비활성화 + 이유 표시)
- [ ] `components/auto-trading/HardRuleSummary.tsx` — 하드 리스크 룰 읽기 전용 요약 카드
- [ ] `components/auto-trading/DailyLossGauge.tsx` — 일 손실 한도 소진 게이지
- [ ] `components/auto-trading/AutoOrderLogItem.tsx` — 자동 체결 로그 아이템

**훅**

- [ ] `hooks/useAutoTradingConfig.ts` — `GET /auto-trading/config` React Query 훅
- [ ] `hooks/useToggleStrategy.ts` — `PATCH /auto-trading/strategies/:id/toggle` mutation
- [ ] `hooks/useKillSwitch.ts` — `POST /auto-trading/kill-switch` mutation
- [ ] `hooks/useAutoTradingMonitor.ts` — `GET /auto-trading/monitor` 폴링 훅 (30초 interval)

**Zustand 스토어**

- [ ] `stores/autoTradingStore.ts` — Kill Switch 상태·자동매매 전체 활성 여부 로컬 캐시

**AI 금지영역 FE 관점**

- Kill Switch 는 FE에서 낙관적 업데이트(optimistic update)를 사용하지 않는다. 반드시 BE 응답 확인 후 상태 전환
- 하드 리스크 룰 표시는 읽기 전용. 사용자가 수정할 수 있는 UI 제공 금지
- "AI가 추천하는 전략입니다" 같은 자동매매 촉진 문구 금지
- 자동매매 설정 화면 진입 시 위험 고지 모달 표시 (정책 기획 산출물 기준)

**받아야 할 입력:**
- 화면 기획·시나리오 기획·정책 기획으로부터: Kill Switch 화면 사양, 자동매매 고지 문구
- BE로부터: `GET /auto-trading/config`, `POST /auto-trading/kill-switch` API 계약

---

## 3. 다른 역할과의 인터페이스 & 핸드오프

### FE가 받는 입력 (입수 계약)

| 제공처 | 산출물 | 수령 시점 | 형태 |
|--------|--------|-----------|------|
| **BE** | API 응답 DTO 스키마 (TypeScript 타입 또는 Swagger JSON) | 각 마일스톤 구현 시작 전 | `@app-types` 폴더 공유 또는 Swagger `/api/docs` |
| **화면 기획** | 와이어프레임·화면 정의서·컴포넌트 명세 확정본 | FE 구현 착수 1~2스프린트 전 | Figma / PDF |
| **시나리오 기획** | 사용자 플로우·엣지케이스·빈 상태 시나리오 | 화면 기획과 동시 또는 직후 | 문서 |
| **정책 기획** | 비투자자문 고지 문구, 자동매매 위험 고지, 리스크 고지 문구 확정본 | M6(고지), M11(주문), M12(자동매매) 화면 구현 전 | 문서 |
| **DQ** | 이벤트 enum 한국어 레이블 매핑, Buy/Exit Score 컴포넌트 이름 | M6 착수 전 | 상수 파일 또는 문서 |
| **AI** | AI 출력 필드 목록 (summary, polarity, personaViews 등) | M3 착수 시 | 인터페이스 문서 |

### FE가 내보내는 출력 (핸드오프 계약)

| 수신처 | 산출물 | 전달 시점 |
|--------|--------|-----------|
| **QA** | 각 마일스톤 구현 완료 화면 — 회귀 체크 대상 화면 목록 | 마일스톤 종료 시 |
| **정책** | AI 금지영역 UI 위반 여부 셀프 체크 결과 | M6/M11/M12 구현 완료 시 |

### 회귀 체크포인트(↩︎)에서 FE가 재확인할 항목

| 체크포인트 | FE 재확인 내용 |
|-----------|---------------|
| **M0 → 이후 모든 마일스톤** | 기존 화면(홈/알림/설정/공시상세/관심/저장) 정상 동작 |
| **M6↩︎** | BuyCandidateCard에 표시되는 buyScore가 BE DTO 값과 1:1 일치하는지 |
| **M7↩︎** | ThesisStatus FSM 상태가 BE 응답과 동기화되는지, 손절선 게이지 수치가 Rule Engine 값과 일치하는지 |
| **M8↩︎** | Exit 액션 배지가 ExitSignal.action과 정확히 매핑되는지, VIOLATED Thesis 배너가 즉시 표시되는지 |
| **M10↩︎** | 모의 포트폴리오와 실전 포트폴리오가 UI에서 명확히 분리되는지, AI비용/순익 게이지 수치 정확성 |
| **M11↩︎** | [승인] 버튼 중복 탭 방지(멱등), RISK_BLOCKED 상태에서 승인 버튼 비활성화 여부 |
| **M12↩︎** | Kill Switch 낙관적 업데이트 없이 BE 응답 후 상태 전환 확인, 하드 룰 수정 UI 없음 확인 |

---

## 4. 산출물 목록

| 구분 | 경로 / 파일 | 마일스톤 |
|------|-------------|----------|
| **화면** | `app/onboarding/persona.tsx` (Persona 선택) | M0 준비 |
| **화면** | `app/disclosure/[id].tsx` AiSummaryCard 섹션 추가 | M3 |
| **화면** | `app/company/[corpCode].tsx` StockChart 섹션 추가 | M4 |
| **화면** | `app/(tabs)/signals/index.tsx` | M6 |
| **화면** | `app/signal/[id].tsx` | M6 |
| **화면** | `app/portfolio/index.tsx` | M7 |
| **화면** | `app/portfolio/position/[id].tsx` | M7 |
| **화면** | `app/portfolio/exit-candidates.tsx` | M8 |
| **화면** | `app/(tabs)/paper-portfolio/index.tsx` | M10 |
| **화면** | `app/paper-portfolio/metrics.tsx` | M10 |
| **화면** | `app/settings-detail/ai-cost.tsx` | M10 |
| **화면** | `app/order/[id].tsx` | M11 |
| **화면** | `app/order/history.tsx` | M11 |
| **화면** | `app/settings-detail/auto-trading.tsx` | M12 |
| **화면** | `app/auto-trading/monitor.tsx` | M12 |
| **컴포넌트** | `components/disclosure/AiSummaryCard.tsx` | M3 |
| **컴포넌트** | `components/disclosure/PersonaViewList.tsx` | M3 |
| **컴포넌트** | `components/stock/StockChart.tsx` | M4 |
| **컴포넌트** | `components/stock/TechnicalIndicatorBadge.tsx` | M4 |
| **컴포넌트** | `components/stock/PriceHeader.tsx` | M4 |
| **컴포넌트** | `components/signal/BuyCandidateCard.tsx` | M6 |
| **컴포넌트** | `components/signal/ScoreBreakdownBar.tsx` | M6 |
| **컴포넌트** | `components/signal/EntryConditionList.tsx` | M6 |
| **컴포넌트** | `components/signal/SignalGradeBadge.tsx` | M6 |
| **컴포넌트** | `components/signal/RiskFactorChips.tsx` | M6 |
| **컴포넌트** | `components/portfolio/PositionCard.tsx` | M7 |
| **컴포넌트** | `components/portfolio/ThesisStatusBadge.tsx` | M7 |
| **컴포넌트** | `components/portfolio/ThesisConditionList.tsx` | M7 |
| **컴포넌트** | `components/portfolio/StopLossGauge.tsx` | M7 |
| **컴포넌트** | `components/portfolio/ExitCandidateCard.tsx` | M8 |
| **컴포넌트** | `components/portfolio/ExitScoreBreakdown.tsx` | M8 |
| **컴포넌트** | `components/portfolio/ExitActionBadge.tsx` | M8 |
| **컴포넌트** | `components/paper/PaperPortfolioSummary.tsx` | M10 |
| **컴포넌트** | `components/cost/AiCostGauge.tsx` | M10 |
| **컴포넌트** | `components/order/OrderApprovalCard.tsx` | M11 |
| **컴포넌트** | `components/order/OrderActionButtons.tsx` | M11 |
| **컴포넌트** | `components/order/RiskCheckList.tsx` | M11 |
| **컴포넌트** | `components/auto-trading/KillSwitchButton.tsx` | M12 |
| **컴포넌트** | `components/auto-trading/StrategyToggleRow.tsx` | M12 |
| **컴포넌트** | `components/auto-trading/HardRuleSummary.tsx` | M12 |
| **훅** | `hooks/useStockChart.ts`, `useTechnicalIndicator.ts` | M4 |
| **훅** | `hooks/useSignals.ts`, `useSignalDetail.ts` | M6 |
| **훅** | `hooks/usePortfolio.ts`, `usePosition.ts`, `useThesis.ts` | M7 |
| **훅** | `hooks/useExitCandidates.ts`, `useExitSignal.ts` | M8 |
| **훅** | `hooks/usePaperPortfolio.ts`, `useAiCostMetrics.ts` | M10 |
| **훅** | `hooks/useOrderRequest.ts`, `useApproveOrder.ts` | M11 |
| **훅** | `hooks/useKillSwitch.ts`, `useAutoTradingMonitor.ts` | M12 |
| **스토어** | `stores/signalFilterStore.ts` | M6 |
| **스토어** | `stores/pendingOrderStore.ts` | M11 |
| **스토어** | `stores/autoTradingStore.ts` | M12 |
| **상수** | `constants/eventType.ts` (이벤트 enum → 한국어 레이블) | M2 완료 후 |
| **상수** | `constants/persona.ts` (Persona 레이블·설명) | M0 완료 후 |

---

## 5. 역할 특화 표준·체크리스트

### 5-1. CLAUDE.md RN 규약 준수 체크리스트 (매 화면·컴포넌트 완료 시)

- [ ] UI 텍스트 전체 **한국어** 작성
- [ ] 스타일: StyleSheet 객체 사용, 인라인 스타일 금지, 매직넘버 금지 (`theme/spacing.ts` 또는 명명 상수)
- [ ] 테마: `lightColors`/`darkColors`만 참조, 하드코딩 색상값 금지
- [ ] 아이콘: Feather 우선, Ionicons 지양
- [ ] 패키지 설치 시 `--legacy-peer-deps` 플래그 필수
- [ ] 저장소: `expo-secure-store` 사용, `AsyncStorage` 사용 금지
- [ ] 네비게이션: Expo Router 파일 기반 라우팅 사용, `react-navigation` 직접 사용 금지
- [ ] 서버 상태: React Query (`useQuery`, `useMutation`, `useInfiniteQuery`), 클라이언트 상태: Zustand
- [ ] Path alias 사용: `@components`, `@theme`, `@hooks`, `@services`, `@stores`, `@app-types`, `@utils` (NOT `@types`)
- [ ] 컴포넌트 파일명: PascalCase (`BuyCandidateCard.tsx`), 훅 파일명: camelCase (`useSignals.ts`)

### 5-2. AI 금지영역 FE 게이트 (M6 이후 전 화면 배포 전 반드시 확인)

| 항목 | 위반 패턴 | 확인 방법 |
|------|-----------|-----------|
| 최종 주문 승인 | FE에서 자동 `approve()` 호출 | 코드 리뷰: `useApproveOrder` 호출 위치가 사용자 탭 이벤트 핸들러에만 존재하는지 |
| 손익 하드룰 | StopLossGauge에 사용자 수정 입력 필드 존재 | 컴포넌트에 TextInput 또는 Slider 없음 확인 |
| 포트폴리오 한도 | maxWeightPct를 FE에서 계산하거나 덮어쓰는 로직 | BE 응답값 표시만, FE 계산 로직 없음 확인 |
| 주문 수량 결정 | FE에서 quantity를 계산해 API에 전송 | OrderAmountRow는 표시 전용, mutation body의 quantity는 BE 산출값 그대로 사용 |
| 리스크 룰 우회 | RISK_BLOCKED 상태에서 승인 버튼 활성화 | RiskCheckList에서 BLOCKED 항목 있을 때 승인 버튼 disabled 확인 |
| 자동매매 하드룰 수정 | HardRuleSummary에 수정 입력 UI 존재 | 컴포넌트가 읽기 전용 텍스트만 렌더링하는지 확인 |

### 5-3. 비투자자문 고지 표시 게이트 (정책 기획 산출물 기반)

- [ ] M6 신호 상세 화면 — 고지 문구 표시
- [ ] M11 주문 승인 카드 — 고지 문구 표시 (정책 기획 확정본 사용)
- [ ] M12 자동매매 설정 진입 시 — 위험 고지 모달 표시

### 5-4. 빈 상태·에러 상태 처리 기준 (매 목록 화면)

| 상태 | 처리 방법 |
|------|-----------|
| 데이터 로딩 중 | `Loading` 컴포넌트 또는 스켈레톤 |
| 데이터 없음(빈 상태) | 한국어 안내 텍스트 + 행동 유도 문구 (예: "아직 신호가 없습니다. 관심 기업을 추가해보세요.") |
| API 에러 | 에러 메시지 + 재시도 버튼. `SnackbarProvider` 활용 |
| 네트워크 오프라인 | React Query `networkMode` 설정 기반 캐시 표시 + 오프라인 배너 |
| RISK_BLOCKED | 차단 사유 명확히 표시, 승인 버튼 비활성화 |

### 5-5. 딥링크 경로 등록 기준

| 경로 | 대상 화면 | 도입 마일스톤 |
|------|-----------|---------------|
| `/disclosure/:id` | 공시 상세 | 기존 |
| `/signal/:id` | 신호 상세 | M6 |
| `/portfolio/position/:id` | 포지션 상세 | M7 |
| `/portfolio/exit` | 매도 후보 목록 | M8 |
| `/order/:id` | 주문 승인 카드 | M11 |
| `/auto-trading/monitor` | 자동매매 모니터 | M12 |

신규 딥링크 경로는 `app/_layout.tsx` 딥링크 핸들러와 `app.json`의 `scheme` 설정에 함께 등록한다.
