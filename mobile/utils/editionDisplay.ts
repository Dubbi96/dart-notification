// utils/editionDisplay.ts — 일일 투자판단 에디션 브라우징 표시 SSOT (DAR-509)
//
// 날짜 스트립 칩 라벨(오늘/어제/M.D)과 빈 에디션 정직 카피(4분기 + 미래)를 파생한다.
// 순수 함수 — date/todayDate(둘 다 KST 'YYYYMMDD' compact 키) 비교만으로 결정론적이라
// now 주입이 필요 없다(백엔드가 서버 KST 오늘을 todayDate 로 내려주므로 디바이스 타임존 무의존).
//
// 정직 규약(정본 §3): 빈 날을 '평가했으나 없음'으로 위장하지 않고 사유를 4분기(CLOSED/PENDING/
// QUIET/COLD_START)로 구분하며, 미래(FUTURE)는 별도로 명시한다. 다른 날로 빈 자리를 채우지
// 않고 명시 CTA(직전 거래일)만 제공한다(CTA 렌더는 호출부 EditionSignalList).

import type { EditionEmptyReason } from '@app-types/signal.types';

import type React from 'react';
import type { Feather } from '@expo/vector-icons';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYYMMDD'(앞 8자리) → UTC 자정 일 서수. 형식/실존(예: 20260230) 위반이면 null. */
export function editionDateOrdinal(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const s = ymd.slice(0, 8);
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** 일 서수 → {m,d}. */
function mdFromOrdinal(ord: number): { m: number; d: number } {
  const dt = new Date(ord * DAY_MS);
  return { m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export interface EditionChipLabel {
  /** 스트립 칩 큰 라벨 — '오늘' | '어제' | 'M.D'. */
  primary: string;
  /** 스크린리더 음성 라벨 — '오늘' | '어제' | 'M월 D일'. */
  a11y: string;
  /** 이 날짜가 서버 기준 KST 오늘인가. */
  isToday: boolean;
}

/**
 * 날짜 스트립 칩 라벨 파생 — todayDate 기준 상대(오늘/어제)를 우선, 그 외엔 절대 'M.D'.
 * date/todayDate 모두 KST 'YYYYMMDD'. date 파싱 불가면 원문을 그대로 노출(억지 표기 금지).
 */
export function formatEditionChipLabel(
  date: string,
  todayDate: string | null | undefined,
): EditionChipLabel {
  const dateOrd = editionDateOrdinal(date);
  if (dateOrd === null) return { primary: date, a11y: date, isToday: false };

  const { m, d } = mdFromOrdinal(dateOrd);
  const md = `${m}.${d}`;
  const mdA11y = `${m}월 ${d}일`;

  const todayOrd = editionDateOrdinal(todayDate);
  if (todayOrd !== null) {
    const diff = todayOrd - dateOrd;
    if (diff === 0) return { primary: '오늘', a11y: '오늘', isToday: true };
    if (diff === 1) return { primary: '어제', a11y: '어제', isToday: false };
  }
  return { primary: md, a11y: mdA11y, isToday: false };
}

export interface EditionEmptyCopy {
  icon: FeatherName;
  title: string;
  /** 사유 설명(직전 거래일 CTA 문구는 호출부 버튼이 담당 — 여기 미포함). */
  description: string;
}

/**
 * 빈 에디션 정직 카피 SSOT(정본 §3) — 사유별 title/description.
 * 사유 미상(구 서버·누락)이면 QUIET 로 폴백(단정 없는 중립 카피). '다른 날로 안 채움' 원칙:
 * 설명은 사유만 밝히고, 대체 콘텐츠(직전 거래일 이동)는 CTA 버튼으로만 유도한다.
 */
export function getEditionEmptyCopy(
  reason: EditionEmptyReason | undefined,
): EditionEmptyCopy {
  switch (reason) {
    case 'CLOSED':
      return {
        icon: 'calendar',
        title: '이 날은 증시 휴장일이에요',
        description: '장이 열리지 않아 이 날의 매수 판단은 없어요.',
      };
    case 'PENDING':
      return {
        icon: 'clock',
        title: '오늘 판단은 아직 준비 중이에요',
        description: '평일 저녁 7시에 그날의 매수 판단이 발행돼요.',
      };
    case 'COLD_START':
      return {
        icon: 'inbox',
        title: '아직 발행된 판단이 없어요',
        description: '첫 에디션이 발행되면 여기에서 볼 수 있어요.',
      };
    case 'FUTURE':
      return {
        icon: 'calendar',
        title: '아직 오지 않은 날짜예요',
        description: '미래 날짜에는 판단이 없어요. 최신 에디션을 확인해 보세요.',
      };
    case 'QUIET':
    default:
      return {
        icon: 'moon',
        title: '이 날은 주목할 신호가 없었어요',
        description: '조건에 맞는 매수 판단이 없던 조용한 하루였어요.',
      };
  }
}
