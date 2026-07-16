// utils/signalTerms.ts — 신호 도메인 용어 위계 단일 정본(SSOT) (DAR-217)
//
// 문제: 같은 데이터(공시 기반 매수 시그널)가 화면마다 '투자판단'·'매수 신호'·'Buy Score'로
// 혼용되어, 신규 사용자가 홈 '오늘의 투자판단' = 신호 탭임을 스스로 추론해야 했다.
// 게다가 일부 카드의 a11y 라벨이 시각 헤더와 다른 어휘를 써서 화면낭독 불일치가 있었다
// (데이터정합·copy 감사 배치4, 2026-06-14).
//
// 해결: 용어 위계를 이 파일 1곳에 명문화하고, 모든 화면/카드/접근성 라벨이
// 여기서 문구를 가져가 드리프트를 차단한다. 카피 변경은 반드시 이 파일에서만 한다.
//
// ── 용어 위계(3단) ───────────────────────────────────────────────
//   L0 탭 라벨        : '신호'       — 5탭 IA(app/(tabs)/_layout). 도메인 진입점.
//   L1 화면/섹션 헤더 : '투자판단'    — 상위 '우산' 개념. 예) 홈 에디션 헤더(buildEditionTitle),
//                                     화면 단위 로딩/에러 상태 문구.
//   L2 개별 카드/점수 : '매수 신호' + 'Buy Score'
//                                   — 개별 시그널 카드와 점수는 항상 이 고정 어휘.
//
// ── 규칙 ─────────────────────────────────────────────────────────
//   1) 화면/섹션 헤더는 L1('투자판단') 어휘를 쓴다(우산 개념).
//   2) 개별 카드·점수 라벨과 그 a11y는 항상 L2('매수 신호'/'Buy Score')로 고정한다.
//   3) a11y 라벨은 그 요소의 시각 헤더와 같은 위계의 어휘를 쓴다(시각=a11y 어휘 일치).
//   4) 카드 a11y는 buildSignalCardA11yLabel로만 만들어 전 카드 동일 포맷을 보장한다.

export const SIGNAL_TERMS = {
  /** L0 — 도메인 탭 라벨(신호 탭). */
  tab: '신호',
  /** L1 — 화면/섹션 우산 헤더 어휘. */
  screenHeader: '투자판단',
  /** L2 — 개별 매수 시그널 카드 명사. */
  card: '매수 신호',
  /** L2 — 매수 점수 라벨(영문 고정). */
  buyScore: 'Buy Score',
  /** L2 — 청산 점수 라벨(영문 고정). */
  exitScore: 'Exit Score',
} as const;

/**
 * 매수 신호 카드 공통 접근성 라벨(SSOT) — 전 카드 동일 포맷·동일 어휘 보장.
 * 시각 위계(L2)와 일치: 항상 '매수 신호' + 'Buy Score'를 포함하고 '투자판단'은 쓰지 않는다.
 * @param corpName    기업명
 * @param buyScore    매수 점수(0~100)
 * @param gradeText   gradeLabel(grade) 결과(한국어 등급 문구)
 * @param dateText    선택 — 발행일 음성 표기(예: '7월 14일', DAR-504). 시각 날짜배지와 SR 병행 노출.
 * @param riskSummary 선택 — 위험 요약(있으면 끝에 덧붙임)
 */
export function buildSignalCardA11yLabel({
  corpName,
  buyScore,
  gradeText,
  dateText,
  riskSummary,
}: {
  corpName: string;
  buyScore: number;
  gradeText: string;
  dateText?: string | null;
  riskSummary?: string | null;
}): string {
  const base = `${corpName} ${SIGNAL_TERMS.card}, ${SIGNAL_TERMS.buyScore} ${buyScore}점, ${gradeText}`;
  const withDate = dateText ? `${base}, ${dateText}` : base;
  return riskSummary ? `${withDate}, ${riskSummary}` : withDate;
}

// ── 에디션(신문 '호') 라벨 SSOT (DAR-504) ────────────────────────────
// 문제: 홈 헤더가 정적 '오늘의 투자판단'으로 데이터 최신일과 무관하게 항상 '오늘'을 단정했다.
//   그런데 홈 큐레이션은 최대 14일 창(useSignals sinceDays:14) + buyScore desc라, 최고점 1건이
//   최대 14일 상단에 정체 → 과거 판단이 '오늘'로 오인됐다. 공시 카운트는 이미 '최신 M/D 기준'
//   (DAR-422)으로 정직화됐으므로 신호 헤더도 같은 규약을 따른다.
// 해결: createdAt(발행일)의 KST 달력일을 축으로 헤더를 동적 생성한다. 하드코딩 '오늘' 금지.
//   디바이스 타임존에 무의존하도록 KST(+9h) 오프셋으로 달력일을 산출 → 결정론 단위검증 가능
//   (now 주입, signalTiming.ts와 동일 관례).

const EDITION_DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO(UTC) → epoch ms. null/빈문자열/파싱불가면 null. */
function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** epoch ms → KST 달력일 자정의 일(day) 서수(자정 기준 일수 차 계산용). */
function kstDayOrdinal(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / EDITION_DAY_MS);
}

/**
 * epoch ms → KST 달력일 compact 'YYYYMMDD'(에디션 date 키) — 백엔드 tradeDateFromMs 와 동형.
 * 에디션 조회(useEdition/useDailyEditions)의 '오늘' 판정 SSOT. now 주입으로 결정론
 * (디바이스 타임존·Date.now() 무의존, +9h 오프셋 벽시계). isToday 배지 단정 아닌 캐시 분기용.
 */
export function kstEditionDate(now: number = Date.now()): string {
  const shifted = new Date(now + KST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 에디션 date(YYYYMMDD)가 KST '오늘'인가 — useEdition staleTime 분기용(오늘 짧게·과거 불변 길게).
 * 형식 불일치/결측이면 false(과거 취급 = 안전측 긴 staleTime). now 주입으로 결정론.
 */
export function isTodayEditionDate(
  date: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!date || !/^\d{8}$/.test(date)) return false;
  return date === kstEditionDate(now);
}

/**
 * ISO(createdAt) → KST 달력일 'M/D'(예: '7/14'). 유효하지 않으면 null(호출부가 결측 처리).
 * 프리뷰/에디션 카드 날짜배지 SSOT — 디바이스 타임존과 무관하게 KST 기준 표기.
 */
export function editionDateLabel(iso: string | null | undefined): string | null {
  const ms = isoToMs(iso);
  if (ms === null) return null;
  const shifted = new Date(ms + KST_OFFSET_MS);
  return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()}`;
}

/**
 * ISO(createdAt) → KST 달력일 'M월 D일'(스크린리더 음성 표기). 유효하지 않으면 null.
 * 'M/D' 시각 배지는 SR이 '슬래시'로 읽어 어색하므로, a11y 라벨엔 이 음성 형태를 병기한다.
 */
export function editionDateA11yLabel(iso: string | null | undefined): string | null {
  const ms = isoToMs(iso);
  if (ms === null) return null;
  const shifted = new Date(ms + KST_OFFSET_MS);
  return `${shifted.getUTCMonth() + 1}월 ${shifted.getUTCDate()}일`;
}

/**
 * iso 의 KST 달력일이 now 의 KST 달력일과 같은가('오늘' 판정 SSOT).
 * now 주입 가능(테스트 결정론, 기본 Date.now()). iso 결측/무효면 false('오늘' 단정 금지).
 */
export function isTodayKst(iso: string | null | undefined, now: number = Date.now()): boolean {
  const ms = isoToMs(iso);
  if (ms === null) return false;
  return kstDayOrdinal(ms) === kstDayOrdinal(now);
}

/**
 * 홈/에디션 섹션 헤더 문구 SSOT(정적 '오늘' 폐기, DAR-504).
 *  - isToday=true  → '오늘의 투자판단'
 *  - isToday=false → '최신 투자판단 · M/D'(createdAt KST일 기준). 간극 ≥2일이면 ' · N일 전' 병기.
 *  - latestCreatedAtISO 결측/무효(빈 상태·로딩·게스트) → 날짜 단정 없는 우산 헤더 '투자판단'.
 * now 주입 가능(테스트 결정론). isToday 는 호출부가 isTodayKst 로 산출(S1 이후 백엔드 todayHasEdition 대체 가능).
 */
export function buildEditionTitle(
  latestCreatedAtISO: string | null | undefined,
  isToday: boolean,
  now: number = Date.now(),
): string {
  if (isToday) return `오늘의 ${SIGNAL_TERMS.screenHeader}`;
  const label = editionDateLabel(latestCreatedAtISO);
  if (label === null) return SIGNAL_TERMS.screenHeader; // 날짜 미상 → '오늘' 단정 없는 우산 헤더
  const ms = isoToMs(latestCreatedAtISO) as number;
  const gapDays = kstDayOrdinal(now) - kstDayOrdinal(ms);
  const base = `최신 ${SIGNAL_TERMS.screenHeader} · ${label}`;
  // 간극 ≥2일(그제 이상)만 'N일 전' 병기 — 어제(1일)는 M/D만으로 충분(노이즈 방지).
  return gapDays > 1 ? `${base} · ${gapDays}일 전` : base;
}

// ── 에디션 신선도 표기 규약 SSOT (DAR-506) ──────────────────────────
// 화면 간 신선도 규약을 이 파일에 명문화한다(마스트헤드 = buildEditionTitle, 카드 = SignalDateBadge).
//
//   규약 1) 신호 카드는 '절대 MM/DD'를 상시 병기한다. 날짜 없는 카드(구 홈 프리뷰)나
//           'N시간 전' 상대시간 '단독' 배지는 폐기한다 — 상대표기는 절대일의 보조로만 붙는다.
//   규약 2) 발생일 귀속은 공시 접수일(rcpDt / rcpNo 앞 8자리)을 1순위로, 없으면 createdAt를
//           '신호' 출처로 폴백한다(레코드 시각을 공시 발생으로 오인 금지 — DAR-369 계승).
//   규약 3) 만료(expiresAt 경과)·지연 반영(접수일↔발행일 ≥2거래일)은 톤으로 시각 구분한다.
//   규약 4) 마스트헤드 헤더는 buildEditionTitle 로만 만든다(정적 '오늘' 단정 금지 — DAR-504).
//
// 카드 날짜/상태 파생은 utils/signalFreshness.getSignalDateStatus(SSOT), 렌더는
// components/signals/SignalDateBadge 가 담당한다. 카피/규약 변경은 반드시 이 두 파일에서만 한다.
export const EDITION_FRESHNESS_CONVENTION = {
  /** 카드 절대 MM/DD 상시 병기 여부(규약 1). false 로 되돌리는 회귀 차단용 명시 상수. */
  absoluteDateAlways: true,
  /** 'N시간 전' 상대시간 단독 배지 폐기(규약 1). */
  relativeOnlyBadgeDeprecated: true,
} as const;
