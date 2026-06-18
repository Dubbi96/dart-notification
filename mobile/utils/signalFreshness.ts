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
