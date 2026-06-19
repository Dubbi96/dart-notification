// 신호 '발생 시점' 표기 단일소스(DAR-369) — 신호 카드는 신선/만료와 무관하게
// '이 신호가 언제 발생했는지'를 항상 보여줘야 사용자가 판단할 수 있다.
//
// 정직성 원칙(시점 의미를 오인시키지 않는다):
//  - 우선순위 1) 공시 접수일: relatedDisclosureRcpNo 의 앞 8자리(YYYYMMDD)는 DART 접수일자다
//    (schema.prisma: rcpNo = YYYYMMDD + 일련번호, 사전식 단조). 이는 신호 레코드 생성 시각이
//    아니라 '근거가 된 공시가 접수된 날'이므로 발생 시점으로 가장 정직하다(백엔드 추가 노출 불필요).
//  - 우선순위 2) 신호 시각: 공시 접수일을 못 구하면 createdAt 으로 폴백하되, '신호' 라벨을 붙여
//    레코드 생성/재생성 시각임을 명확히 한다('공시 발생'으로 오인 방지 — DAR-369 작업 §2).
//  - 둘 다 없으면 show:false(억지 표기 금지).
//
// 상대시간은 KST 달력일 기준 차이로 계산한다(접수일은 시각 정보가 없는 날짜이므로 일 단위가 정직).
// 디바이스 타임존에 의존하지 않도록 KST(+9h) 오프셋으로 달력일을 산출 → 결정론적 단위검증 가능.
// 순수 함수 + now 주입 가능(scripts/check-signal-timing.ts).

export type SignalTimingSource = 'disclosure' | 'signal';

/** 시점 표기 입력 — TradingSignal/CompanySignalBadge 의 부분집합. */
export interface SignalTimingInput {
  /** DART 접수번호(YYYYMMDD+일련번호). 앞 8자리가 공시 접수일. */
  relatedDisclosureRcpNo?: string | null;
  /** ISO 8601 — 신호 레코드 생성/평가 시각(공시 접수일 폴백). */
  createdAt?: string | null;
}

export interface SignalTiming {
  /** 표기할 시점의 출처 — 'disclosure'(공시 접수일) / 'signal'(신호 시각 폴백). */
  source: SignalTimingSource;
  /** 절대일 압축 표기. 같은 해면 'M/D', 다른 해면 'YYYY/M/D'. (예: '6/18') */
  dateText: string;
  /** 상대 표기(KST 달력일 기준). '오늘' / '어제' / '그제' / 'N일 전'. */
  relativeText: string;
  /** 카드 인라인 합성 라벨. (예: '공시 6/18 · 어제') */
  label: string;
  /** 스크린리더용 합성 라벨(카드 a11y 라벨에 합성). (예: '공시 접수 6월 18일, 어제') */
  accessibleText: string;
  /** 표기 가능 여부 — 공시 접수일도 createdAt 도 없으면 false. */
  show: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** ms(UTC) → KST 달력일 {y,m,d}. */
function kstYmdFromMs(ms: number): Ymd {
  const shifted = new Date(ms + KST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** 'YYYYMMDD…'(앞 8자리) → KST 달력일 {y,m,d}. 유효한 실제 날짜가 아니면 null. */
function ymdFromRcpNo(rcpNo: string | null | undefined): Ymd | null {
  if (!rcpNo) return null;
  const head = rcpNo.slice(0, 8);
  if (!/^\d{8}$/.test(head)) return null;
  const y = Number(head.slice(0, 4));
  const m = Number(head.slice(4, 6));
  const d = Number(head.slice(6, 8));
  if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // 라운드트립 검증(예: 20260230 같은 비실재일 배제).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** KST 달력일을 일(day) 서수로 환산(자정 기준 차이 계산용). */
function dayOrdinal({ y, m, d }: Ymd): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** KST 달력일 차이(now - target) → 상대 표기. 미래(클럭 스큐)는 '오늘'으로 정직화. */
function relativeFromDayDiff(diffDays: number): string {
  if (diffDays <= 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays === 2) return '그제';
  return `${diffDays}일 전`;
}

function dateText(target: Ymd, nowY: number): string {
  return target.y === nowY ? `${target.m}/${target.d}` : `${target.y}/${target.m}/${target.d}`;
}

/**
 * 신호 발생 시점 표기. 공시 접수일(rcpNo 앞 8자리) 우선, 없으면 createdAt 폴백.
 * now 는 주입 가능(테스트 결정론). 기본 Date.now().
 */
export function getSignalTiming(
  input: SignalTimingInput,
  now: number = Date.now(),
): SignalTiming {
  const nowYmd = kstYmdFromMs(now);
  const nowOrd = dayOrdinal(nowYmd);

  const disclosureYmd = ymdFromRcpNo(input.relatedDisclosureRcpNo);
  if (disclosureYmd) {
    const diff = nowOrd - dayOrdinal(disclosureYmd);
    const rel = relativeFromDayDiff(diff);
    const date = dateText(disclosureYmd, nowYmd.y);
    return {
      source: 'disclosure',
      dateText: date,
      relativeText: rel,
      label: `공시 ${date} · ${rel}`,
      accessibleText: `공시 접수 ${disclosureYmd.m}월 ${disclosureYmd.d}일, ${rel}`,
      show: true,
    };
  }

  const createdMs = input.createdAt ? new Date(input.createdAt).getTime() : NaN;
  if (!Number.isNaN(createdMs)) {
    const createdYmd = kstYmdFromMs(createdMs);
    const diff = nowOrd - dayOrdinal(createdYmd);
    const rel = relativeFromDayDiff(diff);
    const date = dateText(createdYmd, nowYmd.y);
    return {
      source: 'signal',
      dateText: date,
      relativeText: rel,
      // '신호' 라벨로 공시 발생이 아닌 신호 레코드 시각임을 명확히 한다(오인 방지).
      label: `신호 ${date} · ${rel}`,
      accessibleText: `신호 생성 ${createdYmd.m}월 ${createdYmd.d}일, ${rel}`,
      show: true,
    };
  }

  return {
    source: 'signal',
    dateText: '',
    relativeText: '',
    label: '',
    accessibleText: '',
    show: false,
  };
}
