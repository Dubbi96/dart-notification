# 푸시 본문 '한 줄 판단' 표준 (DAR-525 / Wave B·B4)

> 최종 업데이트: 2026-07-17
> 정본 계획: `docs/roadmap/cc-pm-cycle1-plan-2026-07-17.md` §4 Wave B
> 코드 SSOT: `backend/src/notifications/push-body-template.ts` (+ `push-body-template.spec.ts`)

## 1. 목적

잠금화면 1줄을 제품으로 만든다 — **열지 않아도 가치를 전달**하는 표준 푸시 본문.

```
수주 1,200억 — 유사공시 D+5 평균 +2.1% (n=142)
└── 이벤트 리드(유형별 팩트) ──┘   └── 유사공시 반응 통계 문구 ──┘
```

- **이벤트 리드**: 이벤트 유형 + (있으면) 핵심 수치 팩트.
- **반응 통계 문구**: 과거 유사공시(같은 eventType)의 실제 주가 반응 — Wave A
  `disclosure-reaction-stats`(DAR-511) 페이로드를 **재사용**한다(재계산 없음, SSOT).

점수(권고)가 아니라 과거 통계(사실)라 유사투자자문 게이트 밖 — '봉인된 신호'의 합법 대체
셀링포인트(계획 §2-2)를 잠금화면에서 직접 전달한다.

## 2. 조립 규칙 (순수 함수)

`push-body-template.ts` 의 순수 함수 3종으로 조립한다(I/O·시각·DI 없음).

| 함수 | 역할 |
|------|------|
| `buildEventLead({ eventType, factText })` | 유형별 리드 문구 산출 |
| `buildReactionStatPhrase({ horizon, avgReturnPct, sampleCount, minSampleSize })` | 통계 문구(정직 게이트) |
| `buildOneLineJudgmentBody({ lead, statPhrase, fallbackTail, maxLength })` | 결합 + 길이 트렁케이션 |
| `formatKoreanAmountShort(won)` | 금액 팩트 축약('1,200억'/'1.2조') |

### 최종 형식

- **통계 있음(n≥30)**: `<lead> — <statPhrase>`
  예) `삼성전자 공급계약 외 4곳 — 유사공시 D+5 평균 +2.1% (n=142)`
- **통계 없음(n<30·미추출)**: `<lead> · <fallbackTail>`
  예) `삼성전자 공급계약 외 4곳 · 매수 후보 5곳 (적극매수 2)`

## 3. 유형별 리드 템플릿

리드는 **팩트가 있으면 동사형**, 없으면 **간결 라벨**로 산출한다.
라벨 SSOT는 모바일 `EVENT_TYPE_LABEL`(`mobile/utils/disclosureType.ts`)와 의미를 맞추되
push 밀도를 위해 간결화했다. 실적류(EARNINGS_*)는 판정 기준(전년동기 대비 / 자사 전망)을
**반드시 병기**한다(시장 기대치 대비 판정 오인 방지 — `event-type-copy.ts` 정직 카피 재사용).

### 동사형 + 팩트 (핵심 수치가 있을 때)

| eventType | 팩트 있을 때 | 팩트 없을 때(라벨) |
|-----------|--------------|---------------------|
| SUPPLY_CONTRACT | `수주 1,200억` | `공급계약` |
| SHARE_BUYBACK | `자사주 매입 500억` | `자사주 취득` |
| SHARE_CANCELLATION | `자사주 소각 300억` | `자사주 소각` |
| PAID_IN_CAPITAL_INCREASE | `유상증자 1,000억` | `유상증자` |
| CB_ISSUANCE | `전환사채 800억` | `전환사채 발행` |
| BW_ISSUANCE | `신주인수권부사채 800억` | `신주인수권부사채 발행` |
| INVESTMENT_DECISION | `투자 결정 2,000억` | `신규 투자 결정` |
| DEBT_GUARANTEE | `채무보증 500억` | `채무보증` |

### 라벨만 (동사형 미등록)

DIVIDEND_INCREASE(배당 확대) · EARNINGS_SURPRISE(실적 서프라이즈(전년동기 대비)) ·
EARNINGS_SHOCK(실적 쇼크(전년동기 대비)) · EARNINGS_GUIDANCE(실적 가이던스(자사 전망)) ·
MAJOR_SHAREHOLDER_CHANGE · LAWSUIT · TRADING_SUSPENSION · DELISTING_RISK ·
INSIDER_BUY/SELL · MAJOR_HOLDER_5PCT · MERGER_SPLIT · BONUS_ISSUE · CAPITAL_REDUCTION ·
그 외 확장 유형 — 전체 매핑은 `EVENT_PUSH_LEAD_LABEL` 참조.

- **eventType 미상/미등록 + 팩트 없음** → 리드 라벨 생략(무리한 표기 금지 — 정직).
  이때 본문은 `<기업명> …` 만으로 조립(하위호환).

## 4. 수용기준 준수

### (1) n<30 → 통계 문구 자동 생략 (정직 규약 승계)

`buildReactionStatPhrase` 는 `sampleCount < minSampleSize` 이면 **null** 을 반환해 문구를
통째 생략한다. `minSampleSize` 는 Wave A 노출 게이트와 동일 상수
(`DisclosureReactionStatsService.MIN_SAMPLE_SIZE = 30`)를 재사용한다 — "노출 가능 =
통계적으로 준비됨"을 SSOT로 묶어 소표본 허수('평균 +X% n=3')를 원천 차단한다.

### (2) 본문 길이 제한 (Android/iOS 트렁케이션)

- 상한: `PUSH_BODY_MAX_LENGTH = 110` 문자(보수적 컷). FCM 페이로드 상한(4KB)보다 훨씬
  좁은 잠금화면 폭 기준. 표준 본문(≈34자)은 여유롭게 통과한다.
- **가치문구 보존 우선**: 상한 초과 시 통계 문구는 온전히 보존하고 **리드만 말줄임(…)** 한다.
  통계까지 넣으면 리드가 사라지는 극단에서만 통계를 떨군다.
- 통계 없는 본문은 전체를 상한 이내로 컷한다.

### (3) 유형별 템플릿 문서화 + 단위테스트

- 문서: 본 문서 §3.
- 테스트: `push-body-template.spec.ts`(24 케이스) — 유형별 리드·정직 게이트·트렁케이션·
  금액 축약. 에디션 배선은 `edition-push.guard.spec.ts` / `edition-push.service.spec.ts`.

### (4) 에디션 푸시부터 적용, 공시·PRICE_MOVE 는 점진

- **적용 완료**: 일일 에디션 발행 푸시(DAR-523). 헤드라인 종목(최고 buyScore)의 eventType +
  유사공시 반응 통계(D+5)를 본문에 주입한다. 조회 실패·미추출·n<30 은 전부 대체 꼬리로 폴백
  (발송 신뢰 우선 — 통계 조회 예외는 삼켜서 발행 계속).
- **점진 예정(후속)**: 기존 공시 알림 · PRICE_MOVE 알림 본문. 템플릿(§3)과 순수 함수는 이미
  준비됐고, 각 발송 경로에서 eventType·팩트·rcpNo(통계 키)를 주입해 배선하면 된다.

## 5. 경계

- 읽기·알림 계층 전용 — engine5(매매·체결)·Buy Score·M10 클록 무접점(AI 0).
- 통계 원천은 Wave A 페이로드 재사용(재계산 금지). 스키마 변경 0 · 마이그레이션 0.
