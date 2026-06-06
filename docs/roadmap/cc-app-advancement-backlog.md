# 앱 자체 고도화 백로그 (논의 패널 산출, 2026-06-06)

> 멀티에이전트 논의(5관점·25제안→코드검증 종합)로 도출. **Main Thesis 정렬**: "자동화 투자 정보 최대 수집 + 실제 수익". 상위는 신호·수익 경로를 막는 병목 해소 + 정보 수집 확대.

## 핵심 진단 (코드 검증됨)
- **BUY 신호 0의 근본**: 임계값(60)이 높아서가 아님. `chart(0.15)+historicalEvent(0.10)=점수 25%`가 `technical_indicators=0`·`event_study=0`으로 **구조적 0점**. 강한 공시도 60 미달.
- **모의매수 0의 근본**: 매수 게이트가 `entryReady(=ABOVE_MA20, ma20∈technical_indicators)`를 하드 AND 요구 → TI 결측이라 영구 false. 이중 차단.
- ⇒ 신호→모의운용→수익검증(M10 졸업트랙) 전체가 **데이터 결측 + 결측 점수 처리** 하나에 막힘. 이게 테제(수익) 최대 병목.

## 우선순위 백로그
| # | 항목 | impact/effort | 테제 정합 |
|---|---|---|---|
| 1 | **buy-signal 결측버킷 제외 재정규화**(가용 버킷 합=1.0, 임계값 불변) | high/small | 신호 해금=수익 후보 생성 직접 선행 (DAR-49) |
| 2 | **technical_indicators 백필 + 히스토리컬 주가 수집 확대** | high/medium | 정보 최대 수집 + 차트점수·entryReady 해금=모의매수 작동 (DAR-50) |
| 3 | 철학 조회 REST(GET /philosophies) + 모바일 '투자거장' 화면 | high/small | Persona P-A 노출, 적재자산 가치화 |
| 4 | 게스트 검색 잠금 해제(쓰기만 로그인) | high/small | 비로그인 가치체감 |
| 5 | 검색·공시카드 기업명→종목상세 탐색 동선 | high/medium | 종목중심 탐색 |
| 6 | AI 신뢰도 %를 '라벨+근거수+검증한계'로 분해 | high/small | 과신방지·신뢰 |
| 7 | 신호 미생성 사유 진단 배지(기존 blockedReason/entryConditionUnmet 매핑) | medium/small | "왜 BUY 0" 투명화 |
| 8 | 데이터 성숙도 배지 + 빈상태 CTA | medium/small | 데이터 한계 UX 흡수 |
| 9 | 공시 시그널 카드 '거장별 한 줄 코멘트'(styleTags×persona affinity) | high/medium | P-A→P-B 브릿지, 신규데이터 불요 |
| 10 | signals 탭 점수분포 히스토그램 + 점수분해 워터폴 | medium/small | 빈화면 정보화 |

## 구동 순서(테제 기준)
1. **DAR-49**(재정규화) → 신호가 정당하게 60+로. 2. **DAR-50**(TI 백필+주가 수집 확대=정보수집) → 모의매수 작동. → 이 둘이 수익 검증 트랙 가동. 이후 3·6·7(신뢰/철학 노출), 4·5(탐색), 9·10(시각화).

> 데이터 한계(주가 1일·포지션 0)로 종목 차트·자산곡선·성적표는 빈상태 설계까지만(후순위). "미생성 사유·데이터 성숙도"를 투명 노출해 신뢰 자산화하는 것이 5관점 공통 정공법.

---

## 상용 설계 패널 백로그 (2026-06-06, 7에이전트·26제안 종합·코드검증)

> ★MAIN THESIS 정렬. 핵심: 이미 만든 백엔드 자산을 적은 공수로 노출/확대 + 정보수집 자동 폐루프.

**Quick wins**: ①근거·표본·신뢰도 강제 동반 표시규약(과신방지) ②재무 DEFAULT_LIMIT=50 캡해제+우선순위큐+크론(테제1순위) ③온보딩 Step1 마찰제거.

| # | 항목 | impact/effort | 테제 |
|---|---|---|---|
| 1 | 거장 철학 도감 + 종목상세 거장별 적합도 카드 | high/small | **DAR-54 진행중** |
| 2 | 점수·적합도 '근거·표본·신뢰도' 강제 동반(과신방지) | high/small | 신뢰=수익보존 |
| 3 | **재무 전종목 확대(캡해제)+분기시계열+정기수집 크론** | high/medium | ★정보수집 최대레버 |
| 4 | "버핏이라면" 항목별 통과/미달 체크리스트 분해 | high/small | 판단밀도 |
| 5 | 공시 추가 이벤트 유형 추출 4종(증자·대주주·배당·실적) | high/large | 보유공시 정보밀도(호출0) |
| 6 | 종목 의사결정 허브(company '판단' 탭 통합) | high/medium | 수익깔때기 |
| 7 | 모의 자산곡선 + 졸업 스코어보드 | high/medium | 수익검증 시각화 |
| 8 | 홈 '오늘의 투자판단' 프리뷰(BUY0 정직빈상태) | high/medium | 테제 시각1순위 |
| 9 | 게스트 가치 프리뷰 온보딩 3장 | high/medium | 수집 깔때기상단 |
| 10 | 수집 상태 대시보드(3 CollectionLog) | medium/medium | 수집 측정/안전망 |
| 11 | 진입/청산 사유 + 매매 성적표 | high/large | 신뢰·근거추적 |
| 12 | 온보딩 마찰제거 + 첫종목 코치마크 | medium/small | 관심기업=수집시드 |

**구동 순서(테제)**: DAR-54(거장화면,#1 진행중) → #3 재무확대(정보수집 최대레버) → #2 신뢰규약 → #5 이벤트추출 → #6 판단허브 → #7 자산곡선 …

> ✅ **위 상용 패널 #1~#12 전부 완료**(DAR-54~65, origin 반영). 후속은 아래 패널 v2 백로그로 이어감.

---

## 상용 패널 v2 백로그 (2026-06-06, 7에이전트·29제안·★코드검증 종합)

> 백로그 #1~12 소진 후 재가동. 스카우트가 실제 코드를 읽고, 5관점이 코드근거(evidence)로 제안 → 종합. ★MAIN THESIS 정렬. **핵심 발견: 이미 만들어둔 자산이 "배선 안 됨/빈 입력/계산값 폐기"로 테제(수익) 천장을 막고 있다 — 신규 구축보다 연결이 최고 ROI.**

**코드검증된 핵심 병목**:
- AI 컨슈머가 빈 입력으로 작동: `event-extracted.consumer.ts:33` `tradingValue:200_000_000`(하드코딩)·`:43` `keyMetrics:{}`·`:44` `excerpt:''` → 요약·Persona가 사실상 무내용 → 하위 모든 신호 품질 천장.
- `GraduationMetricsService`(졸업지표 G1~G5) 구현됐으나 **어떤 module/controller에도 미배선** → M10 졸업 진척 측정 불가.
- Event Study가 계산한 `isSignificant`·`upProbD5`·`crashProbD5`·`bucketKey`를 신호가 **버리고 avgArD5 한 값만** 사용.

| # | 항목 | impact/effort | layer | 테제 |
|---|---|---|---|---|
| 1 | **AI Task 입력 충실화**(컨슈머 빈 excerpt/keyMetrics/거래대금 스텁 제거, DB·시세 실조회) | high/medium | backend | ★A 직결·신호 품질 천장 해소 |
| 2 | **졸업게이트 G1~G5 REST 노출 + engine5 모듈 배선 + 홈 졸업 트래커 카드** | high/medium | both | ★B 결승선(M10 측정) |
| 3 | 졸업게이트 위험조정·벤치마크 지표(Sharpe·MDD·vs KOSPI alpha) | high/medium | both | B+안전(상승장 위장통과 방지) |
| 4 | 관리종목·거래정지 플래그 실데이터 매핑(cost-gate L0 정상화, DART 폴백) | high/medium | backend | 안전+B(비용폭주·위험종목 차단) |
| 5 | Event Study bucketKey 신호 정밀화(계약규모·서프라이즈·유의성→BuyScore) | high/medium | backend | B(계산값 폐기 회수) |
| 6 | 고위험 공시 5종 구조화 추출기(소송·감사의견·거래정지·상폐위험·계약해제) | high/medium | backend | A 직결(손실회피 원천) |
| 7 | P-C: AI Persona 해석 × 철학 스코어러 결합(Rule 합성, AI 점수직결 금지) | high/medium | backend | B(기존 자산 결합·저비용) |
| 8 | 신호 사후검증 백테스트(등급·스코어러·이벤트타입별 실현수익 정밀도) | high/large | both | B(가중치 타당성 증거) |
| 9 | 위치테제 invalidConditions 기계평가 연결→보유악재 L3 활성 | medium/medium | backend | A·B+안전 |
| 10 | 라이브 AI 비용게이트 상시 모니터링(스모크→자동 가드+health 엔드포인트) | high/medium | both | A·B 라이브화 안전판 |
| 11 | P-D: 철학 스타일별 모의 포트폴리오 분기 운용·성과 비교 | medium/large | both | B(거장별 실수익 변별) |
| 12 | AssetClass 도메인 추상화 선행(가격/캘린더 포트, 스키마 비파괴) | medium/large | backend | A 중기토대(다자산) |

**구동 순서(테제)**: #1 AI입력충실화(최고 ROI·천장해소) → #2 졸업게이트 배선 → #3 위험조정지표 → #4 L0 안전필터 → #5 EventStudy 정밀화 → #6 고위험 추출기 → #7 P-C → #8 백테스트 → #9 L3 → #10 라이브 모니터링 → #11 P-D → #12 다자산 토대. (#12 다자산 실데이터/실주문은 M10 졸업 후 전제 유지.)

> ✅ **패널 v2 #1~#12 전부 완료**(DAR-66~77, origin 반영). 후속은 아래 패널 v3 백로그.

---

## 상용 패널 v3 백로그 (2026-06-06, 5관점·30제안·★코드검증 종합)

> 패널 v2 소진 후 재가동. ★MAIN THESIS 정렬. **핵심 발견: AI 분석 폐루프가 절반만 가동**(공시→aiQueue→consumer 배선은 있으나 consumer가 `runSummary`만 호출, Persona·PositionThesis Task 라이브 미실행 → personaViews/invalidConditions 미충전 → P-C·L3 입력 공백·AIUsageLog 빈약). + 미수집 고가치 데이터원(내부자·수급)과 백엔드 완비-미노출 자산 다수.

**코드검증된 핵심**:
- `event-extracted.consumer.ts:84`가 `runSummary`만 호출 — 4 AI Task 중 Persona/PositionThesis 미실행(producer disclosure-events.service.ts:194 aiQueue.add는 존재).
- `dart-api.service.ts`에 majorstock/elestock(내부자·5%보유) 호출 0 — 미수집.
- `useEventStudyResults`·persona-philosophy-fusion 모바일 소비처 0 — 백엔드 완비, 화면 미노출.
- krx-api isManagement/isHalted 하드코딩 false(DAR-69 DART폴백은 했으나 KRX 실응답 매핑 TODO 잔존).

| # | 항목 | impact/effort | layer | 테제 |
|---|---|---|---|---|
| 1 | **AI 분석 파이프라인 전체 Task 오케스트레이션**(consumer가 Persona·PositionThesis도 게이트 경유 실행, AIUsageLog 기록) | high/medium | backend | ★A+B·폐루프 완성·G3전제 |
| 2 | 내부자·대량보유 지분변동 수집(DART majorstock/elestock + EventType 3종) | high/large | backend | ★A 최고가치 미수집 |
| 3 | 공급계약·자사주 금액의 시총·매출 대비 정규화 피처(extractedData) | high/small | backend | B(신규수집0·적중률↑) |
| 4 | 등급 정밀도 매트릭스(예측등급 vs 실현 confusion·단조성) | high/small | backend | B+안전(G1 정량토대) |
| 5 | 신호 보정 루프(eventType 실현수익→BASE_SCORE 보정 제안서, 휴먼승인형) | high/medium | backend | B(측정→개선 폐루프) |
| 6 | 통합 알림 이력 모델 일반화(NotificationHistory: SIGNAL/EXIT/THESIS) | high/medium | both | A+B 알림 선행인프라 |
| 7 | 신호·청산·논리훼손 푸시 파이프라인(발송 기본 OFF·토대) | high/medium | both | B(정보→행동 1마일) |
| 8 | 이벤트 유형별 시장 통계 화면(useEventStudyResults 노출) | high/small | mobile | A+B 미소비자산 노출 |
| 9 | 종목×거장철학×AI관점 결합(P-C Fusion) 화면 노출 | high/small | both | A+B 설명가능성 |
| 10 | 외국인·기관 일별 순매수 수급 수집(KRX 투자자별) | high/medium | backend | A+B 스마트머니 |
| 11 | KRX 관리종목·거래정지 실응답 매핑 마감 + L0 실데이터 | medium/small | backend | B+안전(KRX 승인 전제) |
| 12 | 라이브 30일 모의운용 진행률·G1/G2/G3 자동 측정 리포팅 | medium/small | backend | B·M10 졸업 직결 |

**구동 순서(테제)**: #1 AI전체Task오케스트레이션(폐루프 완성·후속 데이터원) → #3 정규화피처(small·즉효) → #4 등급정밀도 → #8 이벤트통계화면 → #9 P-C화면 → #5 보정루프 → #6·#7 알림파이프라인 → #12 졸업측정 → #2·#10 신규수집(large) → #11 KRX매핑(승인 전제). (#2·#10·#11 KRX/DART 신규수집은 rate limit·승인 고려, 미국/코인 실데이터는 M10 졸업 후.)
