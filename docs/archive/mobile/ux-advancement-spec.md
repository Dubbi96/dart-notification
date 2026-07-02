# UX 고도화 구현 상세 기획 — 개발자 실행 스펙

> 작성: PLANNER (DAR-30) · 작성일: 2026-06-05  
> 입력 문서: [ux-advancement-direction.md](./ux-advancement-direction.md) (멀티에이전트 패널 종합 방향)  
> 상위 기획: [screen-plan.md](../../mobile/screen-plan.md) · [ux-detail-plan.md](./ux-detail-plan.md)  
> 📦 아카이브(2026-07-02): P0~P2 전 항목 구현 완료(DAR-143~166·452~472). 현행 UX 정본은 `docs/roadmap/cc-ui-ux-audit-2026-06-27.md`.  
> **⚠️ PLANNER 산출물 — docs/ 전용. 코드 변경 금지.**

---

## 핵심 원칙 (모든 구현 단계 준수)

1. **숫자는 절대 혼자 나타나지 않는다**: 점수·극성·enum에는 (a)평문 뜻 또는 (b)근거 분해 또는 (c)출처/시점 중 최소 하나를 항상 동반.
2. **`(참고)` 꼬리표 강제**: 모든 해석 문구는 `utils/copy.ts` 단일 상수 파일에 모으고, `(참고)` 미포함 시 린트 경고 대상.
3. **과신/FOMO 연출 금지**: STRONG_BUY 글로우·무한 펄스·AI 의인화·자동 타이머 승인 UI 절대 금지.
4. **모든 모션 `useReducedMotion` 폴백 의무**: 설정 ON 시 정적(즉시) 표시로 대체.
5. **면책 본문·`투자자문 아님` 변경 금지**: 시각 정돈(borderLeft teal 액센트)은 허용, 문구 약화 금지.
6. **하드코딩 색상·AsyncStorage 신규 사용 금지**: 테마 토큰 + `expo-secure-store` 강제.
7. **백엔드 계약 없으면 껍데기 금지**: evidenceKey 의존(EvidenceBreadcrumb)·M4 시세 의존(스파크라인) 착수 보류.

---

## 목차

1. [우선순위 요약 (P0 / P1 / P2)](#1-우선순위-요약)
2. [P0-A: 다크모드 대비 결함 수정](#2-p0-a-다크모드-대비-결함-수정)
3. [P0-B: 평문 번역 레이어](#3-p0-b-평문-번역-레이어)
4. [P0-C: ScoreBreakdownSection](#4-p0-c-scorebrekdownsection)
5. [P1-A: ScoreGauge 등급 밴드 세그먼트](#5-p1-a-scoregauge-등급-밴드-세그먼트)
6. [P1-B: DisclaimerSection contextNotes](#6-p1-b-disclaimersection-contextnotes)
7. [P1-C: ProvenanceBar](#7-p1-c-provenancebar)
8. [P1-D: 접근성 강화](#8-p1-d-접근성-강화)
9. [P1-E: Dynamic Type (makeTypography)](#9-p1-e-dynamic-type-maketypography)
10. [P1-F: 홈 헤더 SearchOverlay 직결](#10-p1-f-홈-헤더-searchoverlay-직결)
11. [P2-A: ScoreGauge 카운트업 모션](#11-p2-a-scoregauge-카운트업-모션)
12. [P2-B: PriceChangeChip](#12-p2-b-pricechangechip)
13. [신규 공통 컴포넌트 목록](#13-신규-공통-컴포넌트-목록)
14. [구현 순서 & 단계별 DoD](#14-구현-순서--단계별-dod)
15. [화면별 적용표](#15-화면별-적용표)
16. [전체 DoD 체크리스트](#16-전체-dod-체크리스트)

---

## 1. 우선순위 요약

| 우선순위 | 항목 | 영향 파일(핵심) | 신규 의존성 |
|---------|------|--------------|-----------|
| **P0-A** | 다크모드 대비 수정 | `theme/colors.ts`, `ScoreGauge.tsx`, `StateView.tsx`, `BuyScoreCard.tsx` | 0 |
| **P0-B** | 평문 번역 레이어 + copy.ts | `utils/copy.ts`(신규), `utils/signalDisplay.ts`, `utils/disclosureType.ts` | 0 |
| **P0-C** | ScoreBreakdownSection | `components/signals/ScoreBreakdownSection.tsx`(신규), `components/common/ScoreProgressRow.tsx`(신규) | 0 |
| **P1-A** | ScoreGauge 등급 밴드 | `components/common/ScoreGauge.tsx` | 0 |
| **P1-B** | DisclaimerSection contextNotes | `components/common/DisclaimerSection.tsx` | 0 |
| **P1-C** | ProvenanceBar | `components/common/ProvenanceBar.tsx`(신규) | 0 (date-fns 기설치) |
| **P1-D** | 접근성 그룹핑/상태어 | `BuyScoreCard.tsx`, `ExitScoreCard.tsx`, `DisclaimerSection.tsx`, `ScoreGauge.tsx` | 0 |
| **P1-E** | Dynamic Type makeTypography | `theme/typography.ts`, `theme/index.ts`, `stores/settingsStore.ts` | 0 |
| **P1-F** | 홈 헤더 SearchOverlay | `app/(tabs)/home/index.tsx` | 0 |
| **P2-A** | ScoreGauge 카운트업 모션 | `components/common/ScoreGauge.tsx` | reanimated (PoC 게이트 필수) |
| **P2-B** | PriceChangeChip | `components/common/PriceChangeChip.tsx`(신규), `PositionCard.tsx` | 0 |

---

## 2. P0-A: 다크모드 대비 결함 수정

### 현황 문제

`darkColors.textTertiary = '#5C6180'`이 `surface = '#0C1026'` 위에서 대비 비율 **약 2.8:1**로 WCAG AA(4.5:1) 미달.  
아래 컴포넌트들이 이 토큰으로 핵심 투자 정보를 표시:

| 컴포넌트 | 현재 토큰 | 사용 위치 |
|---------|---------|---------|
| `ScoreGauge.tsx` | `textSecondary` (라벨) ← 현재 OK | score 숫자 `captionMedium`: OK |
| `BuyScoreCard.tsx` line 87 | **`textTertiary`** | ticker (`signal.ticker`) |
| `BuyScoreCard.tsx` line 25 | **`textTertiary`** | 필수 미충족 조건 (red는 OK, textTertiary 조건은 미충족) |
| `StateView.tsx` | 확인 필요 | EmptyState 보조 문구 |
| `BuyScoreCard.tsx` line 56 | `textSecondary` | 요약 텍스트 ← 현재 OK |

### 수정 규칙

**읽어야 하는 텍스트** = 점수 라벨·근거·면책·EmptyState 메인+보조 문구·ticker·종목코드  
→ `textSecondary(#8B90A8)` 이상 사용 (대비 약 6.1:1, AA 통과)

**순수 장식·비활성** = 구분선·비활성 Chip·BLOCKED 카드 보조 텍스트  
→ `textTertiary` 허용

### 수정 대상 (파일/라인 기준)

| 파일 | 현재 | 변경 후 | 이유 |
|-----|------|--------|------|
| `components/signals/BuyScoreCard.tsx:87` | `colors.textTertiary` (ticker) | `colors.textSecondary` | ticker는 읽어야 할 종목 식별자 |
| `components/signals/BuyScoreCard.tsx:25` | `colors.textTertiary` (미충족·비필수) | `colors.textSecondary` | 진입 조건 정보는 읽어야 함 |
| `components/common/StateView.tsx` | `textTertiary` (보조문구 확인) | `textSecondary` | EmptyState 보조 문구 |

### 빌드타임 대비 점검 스크립트 (개발자 참고)

```
// scripts/check-contrast.ts (단일 실행 스크립트, 런타임 비용 0)
// 전경×배경 쌍을 나열하고 WCAG 대비 계산, AA 미달 시 비-0 exit
// 입력: darkColors.textTertiary × darkColors.surface
// 기준: 4.5:1 (AA normal text)
// 통과 기준: 0 위반
```

**변경 금지 사항**: `darkColors.primary('#818CF8')` 이미 6.30:1 통과, 브랜드 teal 환원 요구는 별개 디자인 승인 이슈로 분리.

---

## 3. P0-B: 평문 번역 레이어

### 현황 문제

- `BuyScoreCard.tsx:68-69`: `signal.eventType` 값이 `'SUPPLY_CONTRACT'` 등 raw enum으로 Chip에 직접 표시
- `BuyScoreCard.tsx:89`: `signal.eventType` 재노출 (두 번째 raw)
- `signals/[id].tsx`: Buy Score 78 숫자만, 78점이 무슨 의미인지 없음
- `disclosure/[id].tsx`: AI polarity `'POSITIVE'` raw 노출 가능

### 3-1. EVENT_TYPE_LABEL 맵 — `utils/disclosureType.ts` 확장

기존 `TYPE_LABELS`(공시 분류용)와 별도로 **신호 이벤트 타입** 매핑 추가:

```typescript
// utils/disclosureType.ts 에 추가할 상수 (기존 파일 확장)
export const EVENT_TYPE_LABEL: Record<string, string> = {
  SUPPLY_CONTRACT:       '대규모 공급계약',
  SHARE_BUYBACK:         '자기주식 취득',
  SHARE_CANCELLATION:    '자기주식 소각',
  DIVIDEND_INCREASE:     '배당 확대',
  EARNINGS_SURPRISE:     '어닝 서프라이즈',
  AUDIT_RISK_RESOLVED:   '감사 리스크 해소',
  // 추가 이벤트 타입은 백엔드 enum 확정 후 여기에 동일 패턴으로 추가
};

export function getEventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType] ?? eventType;
}
```

**적용 위치**:
- `BuyScoreCard.tsx` Chip: `signal.eventType` → `getEventTypeLabel(signal.eventType)`
- `BuyScoreCard.tsx` 두 번째 노출 동일 적용
- `disclosure/[id].tsx` 이벤트 배지 동일 적용

### 3-2. POLARITY_LABEL — `utils/disclosureType.ts` 확장

```typescript
export const POLARITY_LABEL: Record<string, string> = {
  POSITIVE: '호재 성격(참고)',
  NEGATIVE: '악재 성격(참고)',
  MIXED:    '복합 성격(참고)',
  NEUTRAL:  '중립 성격(참고)',
};

export function getPolarityLabel(polarity: string): string {
  return POLARITY_LABEL[polarity] ?? polarity;
}
```

### 3-3. `utils/copy.ts` — 단일 평문 결론 상수 파일 (신규)

**경로**: `mobile/utils/copy.ts`  
**목적**: 모든 해석 문구(scoreOneLiner, 위험 맥락 등)를 단일 파일에 모아 컴플라이언스/법무 검토 대상으로 지정 + `(참고)` 강제

```typescript
// utils/copy.ts
// ⚠️ 이 파일의 모든 문구는 컴플라이언스 검토 대상입니다.
// '(참고)' 꼬리표 없는 해석 문구 추가 시 린트 경고 → PR 차단.

// Buy Score 구간별 1줄 평문 (항상 '(참고)' 포함)
export const SCORE_ONE_LINER: Record<string, string> = {
  STRONG_BUY: '여러 조건이 두루 맞는 구간 (참고)',
  BUY:        '관심을 가져볼 만한 수준 (참고)',
  WATCH:      '아직 일부 조건이 부족한 구간 (참고)',
  BLOCKED:    '필수 조건 미충족으로 진입 부적합 (참고)',
  // 숫자 범위 기준 추가
  SCORE_80_PLUS: '여러 조건이 두루 맞는 구간 (참고)',
  SCORE_60_79:   '관심을 가져볼 만한 수준 (참고)',
  SCORE_30_59:   '아직 근거가 충분하지 않은 구간 (참고)',
  SCORE_0_29:    '진입 근거가 약한 구간 (참고)',
};

// Exit Score 구간별 평문
export const EXIT_SCORE_ONE_LINER: Record<string, string> = {
  EXIT:       '청산 조건이 여럿 충족된 구간 (참고)',
  REDUCE:     '일부 청산 검토 구간 (참고)',
  WATCH:      '추이를 주의 깊게 볼 필요가 있는 구간 (참고)',
  HOLD:       '현재 청산 사유가 뚜렷하지 않은 구간 (참고)',
};

// riskFlags → contextNote 변환 (위험 맥락 고지)
export const RISK_CONTEXT_NOTE: Record<string, string> = {
  RECENT_SURGE:         '이 신호는 최근 5거래일 급등 구간에서 생성됨',
  LOW_SAMPLE:           '과거 통계 표본이 적어 신뢰도가 제한적임',
  EXPIRY_SOON:          '신호 유효 기간이 얼마 남지 않음',
  MARKET_VOLATILITY:    '시장 변동성이 높은 구간에서 생성됨',
  TRADING_HALT:         '거래정지 이력이 있는 종목임',
};

// '(참고)' 강제 린트 규칙 가이드:
// eslint 커스텀 룰 또는 PR 리뷰 체크리스트에서 아래 패턴 차단:
// SCORE_ONE_LINER, EXIT_SCORE_ONE_LINER, RISK_CONTEXT_NOTE 값이
// '(참고)' 또는 '참고'를 포함하지 않으면 eslint-plugin-custom warn.
```

**`scoreOneLiner(score, grade)` 헬퍼** — `utils/signalDisplay.ts` 추가:

```typescript
// utils/signalDisplay.ts 에 추가
import { SCORE_ONE_LINER } from './copy';

export function scoreOneLiner(score: number, grade: SignalGrade): string {
  switch (grade) {
    case 'STRONG_BUY': return SCORE_ONE_LINER.STRONG_BUY;
    case 'BUY':        return SCORE_ONE_LINER.BUY;
    case 'WATCH':      return SCORE_ONE_LINER.WATCH;
    case 'BLOCKED':    return SCORE_ONE_LINER.BLOCKED;
    default:
      if (score >= 80) return SCORE_ONE_LINER.SCORE_80_PLUS;
      if (score >= 60) return SCORE_ONE_LINER.SCORE_60_79;
      if (score >= 30) return SCORE_ONE_LINER.SCORE_30_59;
      return SCORE_ONE_LINER.SCORE_0_29;
  }
}
```

**적용 위치**: `ScoreGauge.tsx` 하단 — `scoreOneLiner(score, grade)` 결과를 `textSecondary`로 항상 표시. 단 `ScoreGauge`가 `grade`를 받지 않으므로 **`oneLiner?: string` prop**을 추가받고, 상위에서 계산 후 전달.

### 3-4. ScoreGauge props 확장

```typescript
// 기존 ScoreGaugeProps에 추가
interface ScoreGaugeProps {
  score: number;
  kind?: 'buy' | 'exit';
  label?: string;
  statusText?: string;
  /** 점수 아래 1줄 평문 (항상 '(참고)' 포함, utils/copy.ts 기준) */
  oneLiner?: string;
}
```

렌더링: ProgressBar 아래에 `oneLiner`가 있으면 `typo.small` + `colors.textSecondary`로 표시.

---

## 4. P0-C: ScoreBreakdownSection

### 현황 문제

`app/signals/[id].tsx`에 `ScoreGauge` 임포트만 있고, **왜 78점인지**를 보여주는 가산 분해 섹션이 없어 점수가 블랙박스.

### 4-1. ScoreProgressRow (신규 공통 컴포넌트)

**경로**: `components/common/ScoreProgressRow.tsx`

```typescript
interface ScoreProgressRowProps {
  label: string;        // 기여 요소명 (예: '공시 이벤트')
  score: number;        // 기여 점수 (양수 가산, 음수 리스크 패널티)
  maxContribution: number; // ProgressBar 최대값 기준 (예: 20)
  /** 특이 표시: 'sample'이면 표본수(n) 동반 노출 */
  kind?: 'normal' | 'sample';
  sampleN?: number;     // eventStudy 표본수
}
```

**렌더링 구조**:
```
[라벨 텍스트]  [ProgressBar mini]  [부호+점수 칩]
공시 이벤트    ████████░░░         +18
리스크 패널티  ░░░░░░░░░░          -12   ← error 색
과거 통계      ████░░░░░░          +10 (n=23건)  ← 표본수 동반
```

- `score > 0`: ProgressBar `colors.success` / 점수 칩 `+{score}` + `success` 색
- `score < 0`: ProgressBar `colors.error` / 점수 칩 `-{|score|}` + `error` 색
- `kind === 'sample'` && `sampleN !== undefined`: 라벨 뒤 `(n=${sampleN}건)` caption 추가

**과신 역설 차단**: 리스크 패널티 행은 반드시 포함, 표본수는 양수 기여와 동등 비중으로 노출.

### 4-2. ScoreBreakdownSection (신규 신호 컴포넌트)

**경로**: `components/signals/ScoreBreakdownSection.tsx`

```typescript
interface ScoreBreakdownItem {
  id: string;
  label: string;
  score: number;        // 양수 가산 또는 음수 패널티
  maxContribution?: number;  // 기본 20
  sampleN?: number;    // eventStudy n
}

interface ScoreBreakdownSectionProps {
  items: ScoreBreakdownItem[];
  totalScore: number;  // 헤더 점수와 일치하는 합계
}
```

**렌더링 구조**:
```
── Score 근거 ─────────────────────────  [SectionHeader]
공시 이벤트      ████████░░░  +18
핵심 수치        ████████░░░  +16
Persona 적합     ██████░░░░   +12
과거 유사 공시   █████░░░░░   +10  (n=23건)
차트             ██████░░░░   +12
거래량·수급      ████████░░░  +14
시장·업종        ████░░░░░░   +8
리스크 패널티    ██████████   -12   ← 항상 마지막, error 색
────────────────────────────────────────
             합계 = 78점            ← 합계 꼬리줄 (bodyMedium)
```

**합계 꼬리줄 규칙**: `items.reduce((sum, i) => sum + i.score, 0) === totalScore` 일치 여부를 `__DEV__` 경고로 검증.  
**Optional chaining**: `signal.scoreBreakdown?.map(...)` — 백엔드 미연동 시 섹션 전체 `null` (graceful fallback).  
**항목 수 8개 고정**이므로 `FlatList` 미사용, `View.map()` 허용.  
**신규 의존성 0**: RN Paper `ProgressBar`/`Chip` 재사용.

### 4-3. app/signals/[id].tsx 삽입 위치

```
HeaderSection (corpName, grade, score, validUntil)
  ↓ [ScoreBreakdownSection 삽입]  ← HeaderSection 직후
ScoreGauge (기존)
EntryConditionSection
RiskSection
SignalSummarySection (AI 텍스트 + AiReferenceLabel)
RelatedDisclosureSection
ExpirySection
DisclaimerSection
```

---

## 5. P1-A: ScoreGauge 등급 밴드 세그먼트

### 현황 문제

8dp 단색 ProgressBar + 숫자만. 78점이 BUY(60~79) 중간인지 STRONG_BUY(80) 직전인지 시각적으로 안 보임.

### 구현 명세

**파일**: `components/common/ScoreGauge.tsx` 확장

**추가 상수** (`utils/signalDisplay.ts`에 정의):
```typescript
// utils/signalDisplay.ts 에 추가
export const BUY_SCORE_CUTS = [30, 60, 80] as const;   // 등급 경계
export const EXIT_SCORE_CUTS = [30, 70] as const;       // Exit 등급 경계
```

**레이아웃 구조**:
```
[View style={{ position: 'relative' }}]           ← 컨테이너 (기존 ProgressBar 자리)
  [ProgressBar progress={clamped/100} ...]         ← 기존 8dp 바
  [등급 컷 틱 View × 3]                            ← position:absolute, left:`${cut}%`
  [노브 View]                                      ← position:absolute, left:`${clamped}%`
[View style={styles.captionRow}]                  ← 우측 '다음 등급까지 +N'
```

**등급 컷 틱 View**:
- `position: 'absolute'`, `left: \`${cut}%\``, `width: 1`, `height: 8`, `backgroundColor: colors.background` (흰/네이비 구분선)
- 틱 3개: 30/60/80 지점

**노브 View**:
- `position: 'absolute'`, `left: \`${clamped}%\``, `width: 10`, `height: 10`, `borderRadius: 5`
- `backgroundColor: color` (현재 점수 색상)
- `marginTop: -1` (바 중앙 정렬)

**'다음 등급까지 +N' 캡션**:
```typescript
function nextCutGap(score: number, kind: 'buy' | 'exit'): string | null {
  const cuts = kind === 'buy' ? BUY_SCORE_CUTS : EXIT_SCORE_CUTS;
  const next = cuts.find(c => c > score);
  if (!next) return null;
  return `+${next - score}`;
}
// ScoreGauge 우측 숫자 옆: '다음 등급까지 +2' (typo.small, textSecondary)
```

**접근성 라벨 합성**:
```
accessibilityLabel={`${label ?? title} ${clamped}점, ${statusText ?? ''} 구간${nextGap ? `, 다음 등급까지 ${nextGap}` : ''}`}
```

예: `"Buy Score 78점, 매수후보 구간, 다음 등급까지 +2"`

**신규 라이브러리 0, Expo Go 호환.**

---

## 6. P1-B: DisclaimerSection contextNotes

### 현황 문제

모든 화면 동일 정적 문구 → '읽지 않고 넘기는 법적 문구'로 죽어있음.

### 구현 명세

**파일**: `components/common/DisclaimerSection.tsx`

**Props 변경**:
```typescript
interface DisclaimerSectionProps {
  style?: ViewStyle;
  /** 화면별 동적 위험 맥락 고지 (기존 면책 위에 추가만 — 약화 금지) */
  contextNotes?: string[];
}
```

**렌더링 구조** (면책 본문은 변경 없음):
```
[Surface(surfaceSecondary)]
  ├── [contextNotes 동적 행] — contextNotes?.map((note) => ...)
  │    feather:alert-triangle (warning) + Text (textSecondary, captionMedium)
  ├── [기존 면책 헤더] feather:alert-triangle + '⚠ 투자자문 아님'
  └── [기존 면책 본문] DISCLAIMER_TEXT (변경 금지)
```

**문구 규칙** (이 파일에서 직접 생성 금지, 상위에서 주입):
- 올바른 예: `'이 신호는 최근 5거래일 +18% 급등 구간에서 생성됨'`
- 금지 예: `'지금 위험하니 매도 고려하세요'` (투자 권유로 오인)

**상위 화면에서 전달 예시** (`app/signals/[id].tsx`):
```typescript
// riskFlags → contextNotes 변환 (상위 화면 책임)
import { RISK_CONTEXT_NOTE } from '@utils/copy';

const contextNotes = signal.riskFlags
  ?.filter(f => RISK_CONTEXT_NOTE[f.key])
  .map(f => RISK_CONTEXT_NOTE[f.key]);

// eventStudy 표본 부족
if (signal.eventStudy?.sampleN !== undefined && signal.eventStudy.sampleN < 30) {
  contextNotes?.push(RISK_CONTEXT_NOTE.LOW_SAMPLE);
}

<DisclaimerSection contextNotes={contextNotes} />
```

**적용 화면**:
- `app/signals/[id].tsx` (riskFlags 기반)
- `app/disclosure/[id].tsx` (AI 분석 결과 품질/시점 기반)

**접근성**: contextNotes 각 행 `accessibilityLabel={note}` 포함.

---

## 7. P1-C: ProvenanceBar

### 현황 문제

AI 분석/시세에 생성 시각·기준 시각이 없음 → 캐시된 구버전 데이터가 무엇 기준인지 알 수 없음.

### 7-1. ProvenanceBar 컴포넌트 (신규)

**경로**: `components/common/ProvenanceBar.tsx`

```typescript
interface ProvenanceItem {
  icon: 'clock' | 'database' | 'hash' | 'calendar';
  label: string;        // 예: '분석 2분 전', '시세 14:32 기준', '룰 v1.2'
  stale?: boolean;      // true이면 warning 색상 + alert-circle
}

interface ProvenanceBarProps {
  items: ProvenanceItem[];
  style?: ViewStyle;
}
```

**렌더링**:
```
feather:clock '분석 2분 전'  ·  feather:database '시세 14:32 기준'  ·  feather:hash '룰 v1.2'
```
- 기본 색: `colors.textSecondary` (대비 확보)
- `stale=true` 항목: 아이콘을 `feather:alert-circle` + `colors.warning`으로 승격
- `·` 구분자: `colors.textTertiary`
- 타이포: `typo.small`

**날짜 포맷 헬퍼** (date-fns 4.1.0 기설치):
```typescript
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko });
}
// 예: '2분 전', '14시간 전'
```

**신선도 임계 (시세)**:
```typescript
// 장중(09:00~15:30 평일)에서 15분 초과 → stale=true
function isPriceStale(priceAt: string | undefined): boolean {
  if (!priceAt) return false;
  const diff = (Date.now() - new Date(priceAt).getTime()) / 1000 / 60; // 분
  return diff > 15;
}
```

**Optional chaining**: `generatedAt`·`priceAt` 백엔드 미존재 시 조건부 렌더 (`if (!generatedAt) return null`).

### 7-2. 적용 위치

| 화면 | 위치 | 전달 데이터 |
|------|------|-----------|
| `app/disclosure/[id].tsx` | AI 헤더 아래 (SectionHeader 직후) | `analysis.generatedAt` |
| `app/signals/[id].tsx` | AI 매수 근거 Surface 상단 | `signal.generatedAt`, `signal.priceAt`, `signal.ruleVersion` |

---

## 8. P1-D: 접근성 강화

### 8-1. BuyScoreCard 카드 그룹핑

**현황 문제**: 카드 전체 `accessibilityLabel`이 있지만 내부 ScoreGauge·EntryConditionRow가 각각 별도 요소로 중복 읽힘.

**수정 방안**:
```typescript
// BuyScoreCard의 내부 콘텐츠 View
<View importantForAccessibility="no-hide-descendants">
  {/* 모든 내부 요소 */}
</View>
```

단, 카드 내 **보조 액션** (`[상세보기]` 버튼 등)은 `accessibilityActions` 패턴으로 유지:
```typescript
accessibilityActions={[
  { name: 'activate', label: '신호 상세 보기' },
]}
onAccessibilityAction={(event) => {
  if (event.nativeEvent.actionName === 'activate') onPress?.(signal);
}}
```

### 8-2. EntryConditionRow 상태어 합성

**현황 문제**: `met=false` + `required=true` 필수 미충족을 색상으로만 구분. 스크린리더·색맹 미대응.

**수정 방안**:

```typescript
// 기존
const iconName = condition.met ? 'check-circle' : 'circle';

// 변경 후
const iconName = condition.met
  ? 'check-circle'
  : (condition.required ? 'alert-circle' : 'circle');  // 필수 미충족 = alert-circle (형태 구분)

// accessibilityLabel 합성
const conditionStatus = condition.met
  ? '충족'
  : (condition.required ? '필수 미충족' : '미충족');

accessibilityLabel={`${condition.required ? '필수 진입 조건' : '선택 진입 조건'} ${condition.label}: ${conditionStatus}`}
```

예: `"필수 진입 조건 현재가 20일선 위: 충족"` / `"필수 진입 조건 거래량 3배: 필수 미충족"`

### 8-3. ScoreGauge `accessibilityElementsHidden` prop

카드 안에서 ScoreGauge가 중복 읽히지 않도록:
```typescript
interface ScoreGaugeProps {
  // ... 기존
  /** 상위 카드가 합성 읽기를 담당할 때 true */
  accessibilityHidden?: boolean;
}

// 렌더링
<View
  {...(accessibilityHidden
    ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' }
    : {})}
>
```

`BuyScoreCard` 내부: `<ScoreGauge ... accessibilityHidden={true} />`  
단독 화면(`signals/[id].tsx`) 내부: `accessibilityHidden={false}` (기본)

### 8-4. ExitScoreCard 동일 패턴 적용

`components/signals/ExitScoreCard.tsx`에 BuyScoreCard와 동일하게:
- 카드 내부 `importantForAccessibility="no-hide-descendants"`
- ExitConditionRow 상태어 합성
- ScoreGauge `accessibilityHidden={true}`

---

## 9. P1-E: Dynamic Type (makeTypography)

> **주의**: 이 항목은 전 화면 파급이 크다. 모션·면책과 섞지 않고 **독립된 단일 PR**로 격리 처리.

### 9-1. makeTypography 함수 (theme/typography.ts)

```typescript
// theme/typography.ts 변경 후

import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

const BASE_SIZES = {
  h1: 28, h2: 22, h3: 18,
  body: 16, bodyMedium: 16,
  caption: 14, captionMedium: 14,
  small: 12,
  amount: 32,
} as const;

const BASE_HEIGHTS = {
  h1: 34, h2: 28, h3: 24,
  body: 22, bodyMedium: 22,
  caption: 20, captionMedium: 20,
  small: 16,
  amount: 40,
} as const;

const FONT_WEIGHTS = {
  h1: '700', h2: '700', h3: '600',
  body: '400', bodyMedium: '500',
  caption: '400', captionMedium: '500',
  small: '400',
  amount: '700',
} as const;

const MIN_FONT_SIZE = 12; // small 바닥값

export function makeTypography(scale: number) {
  const clamped = Math.min(Math.max(scale, 1.0), 1.5); // 클램프 1.0~1.5
  return Object.fromEntries(
    (Object.keys(BASE_SIZES) as (keyof typeof BASE_SIZES)[]).map((key) => [
      key,
      {
        fontFamily,
        fontSize: Math.max(MIN_FONT_SIZE, Math.round(BASE_SIZES[key] * clamped)),
        fontWeight: FONT_WEIGHTS[key] as '400' | '500' | '600' | '700',
        lineHeight: Math.round(BASE_HEIGHTS[key] * clamped),
      },
    ]),
  ) as ReturnType<typeof buildTypography>;
}

// 기존 API 호환 (scale=1.0으로 고정)
export const typography = makeTypography(1.0);
```

### 9-2. useTheme 시그니처 확장 (theme/index.ts)

```typescript
// theme/index.ts 기존 useTheme에 textScale 추가

import { PixelRatio } from 'react-native';
import { useSettingsStore } from '@stores/settingsStore';
import { makeTypography } from './typography';

export function useTheme() {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const textScaleOverride = useSettingsStore((s) => s.textScaleOverride);
  const systemScale = PixelRatio.getFontScale();
  // 사용자 재정의 우선, 없으면 시스템 스케일 사용 (클램프 1.5x)
  const scale = textScaleOverride ?? systemScale;
  const typography = makeTypography(scale);

  return { colors, typography, isDark };
}
```

### 9-3. settingsStore 확장

```typescript
// stores/settingsStore.ts 에 추가
interface SettingsState {
  // ... 기존
  /** 글자 크기 배율: 1.0 보통 / 1.25 크게 / 1.5 아주 크게 (null=시스템 따름) */
  textScaleOverride: 1.0 | 1.25 | 1.5 | null;
  setTextScaleOverride: (scale: 1.0 | 1.25 | 1.5 | null) => void;
}
```

### 9-4. 설정 화면 UI

`app/(tabs)/settings/index.tsx`에 "글자 크기" 항목 추가:
```
글자 크기
  ○ 시스템 따름 (기본)
  ○ 크게 (1.25x)
  ● 아주 크게 (1.5x)       ← SegmentedButtons 또는 RadioButton
```

### 9-5. numberOfLines 해제 주의

`makeTypography` 적용 시 카드 내 `numberOfLines` 고정값이 레이아웃 붕괴를 일으킬 수 있음:
- `BuyScoreCard`: `signal.summary numberOfLines={2}` → scale 1.5에서 2줄이 잘림 → 3줄로 완화 또는 해제
- `DisclosureCard` 제목: `numberOfLines={2}` → 유지하되 최소 높이 보장

---

## 10. P1-F: 홈 헤더 SearchOverlay 직결

### 현황 문제

SearchOverlay가 완성됐지만 홈 헤더에 진입점 없음. 초심자가 설정→관심목록 깊은 경로로만 추가 가능.

### 구현 명세

**파일**: `app/(tabs)/home/index.tsx`

**변경 사항**:
1. 헤더 우측 알림 아이콘 왼쪽에 `feather:search` 추가 (44×44, `hitSlop`)
2. `useState<boolean>(false)` → `searchVisible` 상태
3. 검색 아이콘 탭 → `setSearchVisible(true)`
4. `<SearchOverlay visible={searchVisible} onClose={() => setSearchVisible(false)} />`
5. 빈 관심목록 EmptyState `onAction` → `setSearchVisible(true)` (기존 라우팅 대신)
6. 빈 피드 유도 배너 `onPress` → 동일

**비로그인 게이트 유지**:
```typescript
const handleSearchOpen = () => {
  if (!isLoggedIn) {
    requireAuth(); // 기존 패턴
    return;
  }
  setSearchVisible(true);
};
```

**신규 의존성 0**: `SearchOverlay`는 `visible`/`onClose` prop으로 이미 모듈화.

---

## 11. P2-A: ScoreGauge 카운트업 모션

> **착수 전 게이트 필수**: reanimated 4.3.1 Expo Go 실기기 PoC 통과 없이 착수 금지.

### PoC 조건

```
1. 빈 화면(컴포넌트 1개)에서 reanimated withTiming 1회 실행
2. Expo Go 실기기(iOS + Android)에서 실제 애니메이션 동작 확인
3. newArchEnabled 설정 여부 확인
4. 통과: ScoreGauge 카운트업 착수
5. 실패: RN 내장 Animated로 강등하거나 전체 보류
```

### 통과 시 구현 명세

**파일**: `components/common/ScoreGauge.tsx`

```typescript
// props 추가
interface ScoreGaugeProps {
  // ... 기존
  /** 카운트업 모션 비활성화 (기본 true = 모션 ON) */
  animated?: boolean;
}
```

**모션 규칙**:
- 0 → `score` 600ms, `Easing.out(Easing.cubic)`, 화면 진입 1회만
- `useReducedMotion()` = true이면 **즉시 정적 표시** (폴백 의무)
- 중복 방지: 이미 렌더된 카드가 재마운트 시 중복 트리거 방지 (`useRef` guard)
- 리스트 안에서는 보이는 카드만 애니메이션 (진입 시에만 트리거)

**금지 사항**:
- STRONG_BUY 글로우 효과 금지
- 무한 펄스 금지
- 반복 카운트업 금지 (1회만)
- AI 의인화 (스코어가 "생각하는 척" 연출) 금지

**`useReducedMotion` 폴백 구현**:
```typescript
import { useReducedMotion } from 'react-native-reanimated';
// 또는 AccessibilityInfo.isReduceMotionEnabled() polyfill

const reducedMotion = useReducedMotion();

if (reducedMotion) {
  // 정적 ProgressBar + 숫자 즉시 표시 (기존 로직)
} else {
  // reanimated withTiming 카운트업
}
```

---

## 12. P2-B: PriceChangeChip

### 현황 문제

`PositionCard`가 손익률을 `pnlColor` 텍스트 1줄로만 표시 → 색상 단독 의미 전달.

### 구현 명세

**경로**: `components/common/PriceChangeChip.tsx` (신규)

```typescript
interface PriceChangeChipProps {
  /** 손익률 (%) 예: +2.04 또는 -3.21 */
  value: number;
  /** 절대 금액 (표시 선택) */
  amount?: number;
  style?: ViewStyle;
}
```

**렌더링**:
```
[RN Paper Chip]
  feather:trending-up(+) / feather:trending-down(-) / feather:minus(0)
  +2.04%
  배경: successSurface / error(투명) / surfaceSecondary
```

구체 스타일:
```typescript
const iconName = value > 0 ? 'trending-up' : value < 0 ? 'trending-down' : 'minus';
const chipBg   = value > 0 ? colors.successSurface : value < 0 ? colors.errorSurface : colors.surfaceSecondary;
const textColor = pnlColor(value, colors); // 기존 utils 재사용
```

`errorSurface` 토큰이 없으면 `colors.error + opacity 0.12` 또는 `theme/colors.ts`에 `errorSurface` 추가 (다크 모드 대응).

**접근성**:
```typescript
accessibilityLabel={`수익률 ${Math.abs(value).toFixed(2)}% ${value > 0 ? '상승' : value < 0 ? '하락' : '보합'}`}
```

**스파크라인 보류**: M4 시세 차트 API + react-native-svg 방향 결정 전까지 미착수.

**적용 위치**: `PositionCard.tsx` 손익률 → `<PriceChangeChip value={pnlPercent} />`

---

## 13. 신규 공통 컴포넌트 목록

| 컴포넌트 경로 | Props 핵심 | 재사용 화면 | 단계 |
|------------|---------|-----------|------|
| `components/common/ScoreProgressRow.tsx` | `label, score, maxContribution, kind?, sampleN?` | ScoreBreakdownSection | P0-C |
| `components/signals/ScoreBreakdownSection.tsx` | `items: ScoreBreakdownItem[], totalScore` | `signals/[id].tsx` | P0-C |
| `components/common/ProvenanceBar.tsx` | `items: ProvenanceItem[]` | `disclosure/[id].tsx`, `signals/[id].tsx` | P1-C |
| `components/common/PriceChangeChip.tsx` | `value, amount?` | `PositionCard.tsx`, `company/[corpCode].tsx` | P2-B |

---

## 14. 구현 순서 & 단계별 DoD

### 1단계 (P0 — 신뢰/가독 기반, 신규 의존성 0)

**직렬 순서**: P0-A → P0-B → P0-C

| 순서 | 작업 | DoD 확인 |
|------|------|---------|
| 1 | P0-A: textTertiary → textSecondary 3개소 | `check-contrast.ts` 0 위반, `npx tsc --noEmit 0`, `npm run lint` 통과 |
| 2 | P0-B: `copy.ts` 생성 + `EVENT_TYPE_LABEL` + `POLARITY_LABEL` + `scoreOneLiner` | `copy.ts`의 모든 해석 문구 `(참고)` 포함 확인, 기존 테스트 회귀 0 |
| 3 | P0-C: `ScoreProgressRow` + `ScoreBreakdownSection` + `signals/[id].tsx` 삽입 | `signal.scoreBreakdown` null 시 섹션 null (graceful), 합계 = totalScore 검증 |

### 2단계 (P1 — 기존 컴포넌트 확장)

**단계 분리** (한 컴포넌트에 동시 prop 폭발 금지):

| 순서 | 작업 | 주의 |
|------|------|------|
| 4 | P1-A: ScoreGauge 등급밴드 | (1) 틱 추가 → (2) a11y 라벨 갱신 — 분리 PR |
| 5 | P1-B: DisclaimerSection contextNotes | 기존 면책 본문 변경 없는지 diff 확인 필수 |
| 6 | P1-C: ProvenanceBar 신규 컴포넌트 | `generatedAt` null 시 컴포넌트 null 반환 |
| 7 | P1-D: 접근성 (BuyScoreCard + ExitScoreCard + ScoreGauge) | VoiceOver 수동 테스트 |
| 8 | P1-F: 홈 헤더 SearchOverlay | 비로그인 게이트 유지 확인 |

### 3단계 (P1-E — 테마엔진 격리 PR)

| 순서 | 작업 | 주의 |
|------|------|------|
| 9 | `makeTypography` + `useTheme` 시그니처 + settingsStore | 전 화면 파급 — 광범위 회귀 매트릭스 (모든 카드/탭바/면책 시각 검수) |

### 4단계 (P2 — PoC 게이트 후)

| 순서 | 작업 | 조건 |
|------|------|------|
| 10 | P2-A: reanimated PoC (Expo Go 실기기) | PoC 통과 후 ScoreGauge 카운트업 |
| 11 | P2-B: PriceChangeChip | svg 미사용, 스파크라인 보류 |

---

## 15. 화면별 적용표

| 화면 | P0-A | P0-B | P0-C | P1-A | P1-B | P1-C | P1-D | P1-E | P1-F | P2-A | P2-B |
|------|------|------|------|------|------|------|------|------|------|------|------|
| `/(tabs)/home` | △ | ○ | — | △ | — | — | — | ○ | **●** | △ | — |
| `/(tabs)/signals` | ○ | **●** | — | △ | ○ | — | **●** | ○ | — | △ | — |
| `signals/[id]` | ○ | **●** | **●** | ○ | **●** | **●** | **●** | ○ | — | △ | — |
| `disclosure/[id]` | ○ | **●** | — | — | **●** | **●** | — | ○ | — | — | — |
| `/(tabs)/portfolio` | ○ | — | — | △ | — | — | — | ○ | — | — | **●** |
| `company/[corpCode]` | ○ | ○ | — | △ | — | **●** | — | ○ | — | △ | **●** |
| `settings/index` | — | — | — | — | — | — | — | **●** | — | — | — |

`●` 주 적용 · `○` 자동 전파(컴포넌트 공유) · `△` 간접 적용(useTheme/ScoreGauge 공유) · `—` 해당 없음

---

## 16. 전체 DoD 체크리스트

### P0 완료 기준

- [ ] 앱의 어떤 화면에서도 점수·극성·raw enum이 평문 뜻/근거/출처 없이 단독 노출되는 곳이 0 (코드 grep 확인)
- [ ] `utils/copy.ts`의 모든 해석 문구에 `(참고)` 포함 확인
- [ ] 다크모드 '읽어야 하는 텍스트' 전경×배경 대비 WCAG AA(4.5:1) 이상, 빌드타임 스크립트 0 위반
- [ ] `ScoreBreakdownSection` 리스크 패널티·표본수(n) 동등 비중 노출
- [ ] `signal.scoreBreakdown` null 시 섹션 graceful null
- [ ] 합계 꼬리줄 = totalScore 일치 (`__DEV__` 경고로 검증)
- [ ] `npx tsc --noEmit` 에러 0
- [ ] `npm run lint` 통과
- [ ] `jest` 기존 테스트 회귀 0

### P1 완료 기준

- [ ] `ScoreGauge` 등급 컷 틱 3개(30/60/80) + 노브 + '다음 등급까지 +N' 캡션 표시
- [ ] `DisclaimerSection` `contextNotes` 주입 시 기존 면책 본문 변경 없음 (diff 확인)
- [ ] `ProvenanceBar` `generatedAt`/`priceAt` null 시 null 반환
- [ ] VoiceOver: `BuyScoreCard`가 단일 단위로 합성 읽힘 확인
- [ ] `EntryConditionRow` 필수 미충족 = `alert-circle` + '필수 미충족' 상태어 텍스트 (스크린리더·색맹 대응)
- [ ] `makeTypography(1.5)` 적용 시 BuyScoreCard·탭바·ScoreGauge 줄바꿈으로 수용, 레이아웃 미붕괴
- [ ] 홈 헤더 검색 아이콘 1탭으로 SearchOverlay 오픈 확인
- [ ] 비로그인 시 SearchOverlay 열리지 않음 확인

### P2 완료 기준

- [ ] reanimated PoC: Expo Go 실기기(iOS + Android)에서 `withTiming` 1개 동작 확인
- [ ] `ScoreGauge` 카운트업: 화면 진입 1회만, 중복 트리거 없음
- [ ] `useReducedMotion` ON → 즉시 정적 표시 (VoiceOver 환경에서 확인)
- [ ] STRONG_BUY 글로우·무한 펄스·AI 의인화 코드 미존재 (grep 확인)
- [ ] `PriceChangeChip`: feather 아이콘 + 텍스트 + 배경색 3중 인코딩
- [ ] `accessibilityLabel` 수익률 방향 텍스트 포함 확인

### 전체 공통 기준

- [ ] 코드 변경 0 (이 문서는 docs/ 기획 산출물, 코드 파일 미수정)
- [ ] 면책 본문·`투자자문 아님` 문구 변경 없음
- [ ] `contextNotes`는 기존 면책에 추가만, 약화 없음
- [ ] 하드코딩 색상(`#XXXXXX`) 신규 사용 없음
- [ ] AsyncStorage 신규 사용 없음 (expo-secure-store 강제)
- [ ] EvidenceBreadcrumb·스파크라인 미착수 (백엔드 계약 전 보류 명시)

---

## 기존 기획 정합 확인

| 문서 | 충돌 여부 | 비고 |
|------|---------|------|
| `docs/mobile/screen-plan.md` | 없음 | ScoreBreakdownSection = SCR-SIGNAL-DETAIL §가산식 구현 |
| `docs/archive/mobile/ux-detail-plan.md` (구 docs/mobile/) | 없음 | §8-2 BuyScore 툴팁·§11 재사용 컴포넌트 실체화 |
| `docs/roadmap/roles/plan-policy.md` | 없음 | 면책 본문 불변·`투자자문 아님` 불변·`(참고)` 강제 준수 |
| `mobile/CLAUDE.md` | 없음 | RN Paper·Feather·React Query·Zustand·expo-secure-store 스택 준수 |

---

*작성: PLANNER (DAR-30) · 2026-06-05 · feat/DAR-30 브랜치*  
*이 문서를 기반으로 FE 개발 담당자가 UX 고도화 항목을 단계적으로 구현한다.*
