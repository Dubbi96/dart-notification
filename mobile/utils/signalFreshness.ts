// 신호 신선도 판정 단일소스(DAR-326) — Buy/Exit Score 는 생성시점 스냅샷인데
// 경과/만료 단서가 없어 급변 후에도 유효해 보이는 '구식 전제' 문제를 교정한다.
//
// 정직성 원칙(공포조장 금지):
//  - 만료(validUntil/expiresAt 경과): now ≥ expiresAt → 'expired'(재평가 필요).
//  - 오래됨(createdAt 경과): 만료 정보가 없거나 미래면 createdAt 경과로 판정.
//    경과는 '평일 환산'(주말·시장 휴장 구간 제외) — 금요일 평가가 월요일에 자동
//    '오래됨'으로 과대평가되지 않게 한다.
//  - 신선: 위 어느 것도 아니면 'fresh' → 배지 미표시(노이즈 방지). 억지 경고를 만들지 않는다.
//
// UI 무지(tone/icon/label 만 반환) — 색상 토큰은 호출부(SignalFreshnessBadge)가 테마로 매핑.
// 순수 함수 + now 주입 가능 → 결정론적 단위검증(scripts/check-signal-freshness.ts).

import { getSignalTiming } from './signalTiming';

import type React from 'react';
import type { Feather } from '@expo/vector-icons';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export type SignalFreshnessLevel = 'fresh' | 'stale' | 'expired';

/** 신선도 판정 입력 — TradingSignal/CompanySignalBadge 의 시각 필드 부분집합. */
export interface SignalFreshnessInput {
  /** ISO 8601 — 신호 생성/평가 시각 */
  createdAt?: string | null;
  /** ISO 8601 — 신호 만료 시각(백엔드 validUntil → expiresAt) */
  expiresAt?: string | null;
}

export interface SignalFreshness {
  level: SignalFreshnessLevel;
  /** 배지를 그릴지 여부 — 'fresh' 는 false(미표시). */
  show: boolean;
  /** 압축 배지 라벨(행동 유도, 공포조장 금지). 'fresh' 는 빈 문자열. */
  label: string;
  /** Feather 아이콘명(색상은 호출부 지정) */
  icon: FeatherName;
  /** 색상 톤 의미 — 'alert'(만료) / 'warn'(오래됨) / 'muted'(신선). */
  tone: 'alert' | 'warn' | 'muted';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 평일 환산 경과가 이 시간(시) 이상이면 '오래됨'. 영업일 ~3일치(거래 갱신 주기 여유). */
export const STALE_BUSINESS_HOURS = 24;

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * from~to 사이의 '평일 경과(ms)'. 주말(토·일) 구간은 제외한다.
 * 자정 기준으로 일 단위를 훑되 부분 겹침(주말 진입/이탈)을 정확히 차감한다.
 * to ≤ from 이면 0. 비정상적으로 긴 구간은 안전 상한(366일)에서 멈춘다.
 */
export function businessElapsedMs(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const total = toMs - fromMs;

  const dayCursor = new Date(fromMs);
  dayCursor.setHours(0, 0, 0, 0);
  let cursor = dayCursor.getTime();

  let weekendMs = 0;
  let guard = 0;
  while (cursor < toMs && guard < 366) {
    const dow = new Date(cursor).getDay(); // 0=일, 6=토
    if (dow === 0 || dow === 6) {
      const overlapStart = Math.max(cursor, fromMs);
      const overlapEnd = Math.min(cursor + DAY_MS, toMs);
      if (overlapEnd > overlapStart) weekendMs += overlapEnd - overlapStart;
    }
    cursor += DAY_MS;
    guard++;
  }
  return Math.max(0, total - weekendMs);
}

/**
 * 신호 신선도 판정. now 는 주입 가능(테스트 결정론). 기본 Date.now().
 * 우선순위: 만료 > 오래됨 > 신선. createdAt 결측이면 판단 불가 → 미표시(억지 경고 금지).
 */
export function getSignalFreshness(
  input: SignalFreshnessInput,
  now: number = Date.now(),
): SignalFreshness {
  const FRESH: SignalFreshness = {
    level: 'fresh',
    show: false,
    label: '',
    icon: 'clock',
    tone: 'muted',
  };

  const expiresMs = parseMs(input.expiresAt);
  if (expiresMs !== null && now >= expiresMs) {
    return {
      level: 'expired',
      show: true,
      label: '만료 · 재평가 필요',
      icon: 'alert-triangle',
      tone: 'alert',
    };
  }

  const createdMs = parseMs(input.createdAt);
  if (createdMs === null) return FRESH;

  const businessHours = businessElapsedMs(createdMs, now) / HOUR_MS;
  if (businessHours >= STALE_BUSINESS_HOURS) {
    return {
      level: 'stale',
      show: true,
      label: '오래됨 · 조건 재확인',
      icon: 'clock',
      tone: 'warn',
    };
  }

  return FRESH;
}

// ── 에디션 날짜 배지 상태 파생(SSOT, DAR-506) ────────────────────────────
// 홈·에디션·explore 신호 카드가 '절대 MM/DD 상시 병기 + 상태(오늘/어제/N일 전·만료·지연)'를
// 단일 규약으로 쓰도록 배지 모델을 파생한다. 'N시간 전' 상대시간 단독 배지는 폐기하고,
// 항상 절대 발생일(공시 접수일 우선, 없으면 신호 생성일 폴백)을 함께 노출한다(정본 §3 정직 규약).
//
// 정직성:
//  - 날짜/상대표기/출처는 signalTiming(getSignalTiming) SSOT 를 재사용한다 — 공시 접수일
//    (rcpDt / rcpNo 앞 8자리) 우선, 없으면 createdAt 폴백('신호' 출처로 레코드 시각임을 명시).
//  - 만료(expiresAt 경과): now ≥ expiresAt → 'expired'(재평가 필요). 최우선.
//  - 지연 반영: 공시 접수일과 신호 발행일(createdAt) 간극이 ATTRIBUTION_DELAY_TRADING_DAYS
//    거래일 이상이면 'delayed'. 파싱 지연으로 X일 공시가 X+2일에 신호화된 걸 '오늘 판단'으로
//    위장하지 않게 명시한다(귀속일 정직화). 거래일은 평일 근사(FE 공휴일 캘린더 미보유 — 정본
//    §3 폴백 관례, 주말 간극은 지연으로 오분류하지 않음).
//  - 색상 톤(tone)만 의미로 반환 — 실제 색은 호출부(SignalDateBadge)가 테마 토큰으로 매핑.

/** 공시 접수일 대비 신호 발행일 간극이 이 거래일수 이상이면 '지연 반영'(귀속일 정직화). */
export const ATTRIBUTION_DELAY_TRADING_DAYS = 2;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type SignalDateStatusKind = 'current' | 'delayed' | 'expired';

/** 날짜 배지 파생 입력 — TradingSignal / 일일에디션 item 의 시각 필드 부분집합. */
export interface SignalDateInput {
  /** ISO 8601 — 신호 생성/발행 시각(공시 접수일 폴백). */
  createdAt?: string | null;
  /** 'YYYYMMDD' — 공시 접수일(S1 daily-edition payload). 귀속일 정직화 1순위. */
  rcpDt?: string | null;
  /** DART 접수번호(앞 8자리 = 접수일). rcpDt 미제공 시 폴백. */
  relatedDisclosureRcpNo?: string | null;
  /** ISO 8601 — 신호 만료 시각. */
  expiresAt?: string | null;
}

export interface SignalDateStatus {
  /** 귀속 근거(공시 접수일 / createdAt) 전무면 false → 배지 미표시(억지 표기 금지). */
  show: boolean;
  /** 절대 'M/D'(같은 해) 또는 'YYYY/M/D'(다른 해) — 상시 병기. show=false 면 ''. */
  dateText: string;
  /** 스크린리더 음성 날짜('M월 D일'). show=false 면 ''. */
  dateA11yText: string;
  /** 상대 표기(오늘/어제/그제/N일 전). */
  relativeText: string;
  /** 날짜 출처 — 'disclosure'(공시 접수일) / 'signal'(createdAt 폴백). */
  source: 'disclosure' | 'signal';
  /** 상태 종류 — current(정상) / delayed(지연 반영) / expired(만료). */
  kind: SignalDateStatusKind;
  /** 배지 꼬리 라벨 — expired='만료', delayed='지연 반영', current=relativeText. */
  statusLabel: string;
  /** 배지 전체 표기(출처 접두 + 절대일 + 꼬리). 예: '공시 6/18 · 지연 반영'. */
  label: string;
  /** 색상 톤 의미 — 'alert'(만료) / 'warn'(지연) / 'muted'(정상). */
  tone: 'alert' | 'warn' | 'muted';
  /** Feather 아이콘명(색상은 호출부 지정). */
  icon: FeatherName;
  /** 카드 a11y 합성 라벨(예: '공시 접수 6월 18일, 지연 반영'). */
  accessibleText: string;
}

/** 'YYYYMMDD'(앞 8자리) → 자정(UTC) epoch 일 서수. 실재하지 않는 날짜면 null. */
function ordinalFromYmd8(head: string | null | undefined): number | null {
  if (!head) return null;
  const s = head.slice(0, 8);
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** epoch ms → KST 달력일 자정 일 서수. */
function kstOrdinalFromMs(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}

/** 일 서수 → KST 달력일 {m,d}('M월 D일' a11y 용). */
function mdFromOrdinal(ord: number): { m: number; d: number } {
  const dt = new Date(ord * DAY_MS);
  return { m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 일 서수가 평일(월~금)인가 — FE 거래일 근사(공휴일 미반영). */
function isWeekdayOrdinal(ord: number): boolean {
  const dow = new Date(ord * DAY_MS).getUTCDay(); // 0=일 … 6=토
  return dow >= 1 && dow <= 5;
}

/** (from, to] 구간의 평일(거래일 근사) 수. to ≤ from 이면 0. 안전 상한 400. */
function tradingDayGap(fromOrd: number, toOrd: number): number {
  if (toOrd <= fromOrd) return 0;
  let count = 0;
  for (let o = fromOrd + 1; o <= toOrd && count < 400; o++) {
    if (isWeekdayOrdinal(o)) count++;
  }
  return count;
}

/**
 * 신호 날짜 배지 상태 파생(SSOT). 절대 발생일 + 상대표기 + 만료/지연 상태를 한 번에 산출한다.
 * 날짜/상대/출처는 getSignalTiming(발생 시점 SSOT)을 재사용하고, 만료·지연 오버레이만 얹는다.
 * now 주입 가능(테스트 결정론). 기본 Date.now(). 우선순위: 만료 > 지연 > 정상.
 */
export function getSignalDateStatus(
  input: SignalDateInput,
  now: number = Date.now(),
): SignalDateStatus {
  // 공시 접수일 키: rcpDt('YYYYMMDD') 우선, 없으면 rcpNo(앞 8자리를 접수일로 파싱).
  const disclosureKey = input.rcpDt ?? input.relatedDisclosureRcpNo ?? null;
  const timing = getSignalTiming(
    { relatedDisclosureRcpNo: disclosureKey, createdAt: input.createdAt },
    now,
  );

  if (!timing.show) {
    return {
      show: false,
      dateText: '',
      dateA11yText: '',
      relativeText: '',
      source: 'signal',
      kind: 'current',
      statusLabel: '',
      label: '',
      tone: 'muted',
      icon: 'calendar',
      accessibleText: '',
    };
  }

  // a11y 날짜('M월 D일')는 getSignalTiming 이 고른 것과 동일 출처에서 재산출한다.
  const disclosureOrd = ordinalFromYmd8(disclosureKey);
  const createdMs = parseMs(input.createdAt);
  const sourceOrd =
    timing.source === 'disclosure'
      ? (disclosureOrd as number)
      : kstOrdinalFromMs(createdMs as number);
  const md = mdFromOrdinal(sourceOrd);
  const dateA11yText = `${md.m}월 ${md.d}일`;

  // 만료(최우선): now ≥ expiresAt.
  const expiresMs = parseMs(input.expiresAt);
  const expired = expiresMs !== null && now >= expiresMs;

  // 지연 반영: 공시 접수일 기준일 때만, 접수일 → 발행일 거래일 간극 ≥ 임계.
  let delayed = false;
  if (!expired && timing.source === 'disclosure' && disclosureOrd !== null && createdMs !== null) {
    const createdOrd = kstOrdinalFromMs(createdMs);
    delayed = tradingDayGap(disclosureOrd, createdOrd) >= ATTRIBUTION_DELAY_TRADING_DAYS;
  }

  let kind: SignalDateStatusKind;
  let statusLabel: string;
  let tone: SignalDateStatus['tone'];
  let icon: FeatherName;
  if (expired) {
    kind = 'expired';
    statusLabel = '만료';
    tone = 'alert';
    icon = 'alert-triangle';
  } else if (delayed) {
    kind = 'delayed';
    statusLabel = '지연 반영';
    tone = 'warn';
    icon = 'clock';
  } else {
    kind = 'current';
    statusLabel = timing.relativeText;
    tone = 'muted';
    icon = 'calendar';
  }

  const sourcePrefix = timing.source === 'disclosure' ? '공시' : '신호';
  const sourceWord = timing.source === 'disclosure' ? '공시 접수' : '신호 생성';
  const a11yTail =
    kind === 'expired'
      ? '만료 · 재평가 필요'
      : kind === 'delayed'
        ? `${timing.relativeText} · 지연 반영`
        : timing.relativeText;

  return {
    show: true,
    dateText: timing.dateText,
    dateA11yText,
    relativeText: timing.relativeText,
    source: timing.source,
    kind,
    statusLabel,
    label: `${sourcePrefix} ${timing.dateText} · ${statusLabel}`,
    tone,
    icon,
    accessibleText: `${sourceWord} ${dateA11yText}, ${a11yTail}`,
  };
}
