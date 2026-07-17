import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

// 에디션 '놓친 호' 열람 기록(영속) — DAR-527 (Wave B/B3·P1).
// '1거래일=1호' 소비 리듬을 완성하기 위해, 안 읽은 에디션(호)을 신호탭 날짜 스트립에 뱃지로 표시한다.
// ★서버 스키마 변경 0: 열람 상태는 전적으로 클라이언트 로컬(zustand persist·expo-secure-store)에만 둔다.
//
// 모델(정직·저소음):
//   - readDates: 사용자가 실제로 '연' 에디션 날짜 집합(YYYYMMDD → true). 명시적 열람만 기록.
//   - baselineDate: 이 기기에서 에디션을 '처음 관측한 시점'의 최신 호(YYYYMMDD). 이보다 오래된 호는
//       '놓친 호' 대상이 아니다 — 앱을 처음 켠 사용자에게 과거 백카탈로그 전체가 뱃지로 쏟아지는 소음을 막는다.
//   - '놓친 호'(미열람) = baselineDate 초과(엄격히 더 최신) & 미열람. 기준선 이하(과거·현재 최신)는 대상 아님.
// 이 규칙 덕에: (a) 설치 직후는 조용, (b) 이후 발행되는 새 호만 뱃지, (c) 수요일을 열어도 화요일 미열람은
//   그대로 '놓친 호'로 남는다(고수위 마크가 아닌 날짜별 집합이라 정확).

const secureStorage: StateStorage = {
  getItem: async (name) => {
    return await SecureStore.getItemAsync(name);
  },
  setItem: async (name, value) => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name) => {
    await SecureStore.deleteItemAsync(name);
  },
};

// 영속 집합 무한 증가 방지 — 최신 N개만 유지(YYYYMMDD 사전식=시간순이라 오래된 것부터 제거).
export const MAX_READ_DATES = 400;

interface EditionReadState {
  /** 열람(오픈)한 에디션 날짜 집합 — 명시적 읽음(YYYYMMDD → true). */
  readDates: Record<string, true>;
  /** 뱃지 기준선 — 최초 에디션 관측 시점의 최신 호(YYYYMMDD). 미시드면 null(조용). */
  baselineDate: string | null;
  /** 해당 호를 열람 처리(뱃지 해제). 이미 읽음이면 no-op. */
  markRead: (date: string) => void;
  /** 기준선을 최초 1회만 시드한다(이미 있으면 무시 — 이후 발행분만 뱃지 대상). */
  setBaseline: (latestDate: string) => void;
  /** 열람 기록 초기화(로그아웃·테스트용). */
  reset: () => void;
}

/** YYYYMMDD 8자리 숫자만 유효한 에디션 날짜로 취급. */
function isValidEditionDate(date: string): boolean {
  return /^\d{8}$/.test(date);
}

export const useEditionReadStore = create<EditionReadState>()(
  persist(
    (set) => ({
      readDates: {},
      baselineDate: null,
      markRead: (date) =>
        set((s) => {
          if (!isValidEditionDate(date) || s.readDates[date]) return s;
          const next: Record<string, true> = { ...s.readDates, [date]: true };
          const keys = Object.keys(next);
          if (keys.length > MAX_READ_DATES) {
            keys.sort(); // 사전식=시간순 오름차순 → 앞쪽이 가장 오래됨.
            for (let i = 0; i < keys.length - MAX_READ_DATES; i += 1) delete next[keys[i]];
          }
          return { readDates: next };
        }),
      setBaseline: (latestDate) =>
        set((s) =>
          s.baselineDate || !isValidEditionDate(latestDate) ? s : { baselineDate: latestDate },
        ),
      reset: () => set({ readDates: {}, baselineDate: null }),
    }),
    {
      name: 'edition-read-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);

/**
 * 순수 판정 — 해당 호가 '놓친 호'(미열람 뱃지 대상)인가.
 *   - 기준선 미시드(null) → 항상 false(조용 — 최초 관측 전엔 뱃지 없음).
 *   - date ≤ baselineDate → false(과거·현재 최신 호는 대상 아님).
 *   - date > baselineDate & 미열람 → true.
 * YYYYMMDD 사전식 비교=시간순 비교라 문자열 대소 비교로 안전.
 */
export function isEditionUnread(
  date: string,
  opts: { readDates: Record<string, true>; baselineDate: string | null },
): boolean {
  if (!opts.baselineDate) return false;
  if (!isValidEditionDate(date)) return false;
  if (date <= opts.baselineDate) return false;
  return !opts.readDates[date];
}
