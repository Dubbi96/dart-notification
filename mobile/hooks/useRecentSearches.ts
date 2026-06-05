import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import type { Company } from '@app-types/user.types';

const STORAGE_KEY = 'recent_company_searches';
const MAX_RECENT = 8;

/**
 * 검색 오버레이의 "최근 검색" 항목을 expo-secure-store 에 보관한다.
 * 사용자가 검색 결과를 선택(추가/조회)하면 최근 목록 맨 앞에 누적한다.
 */
export function useRecentSearches() {
  const [recent, setRecent] = useState<Company[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(STORAGE_KEY);
        if (mounted && raw) {
          const parsed = JSON.parse(raw) as Company[];
          if (Array.isArray(parsed)) setRecent(parsed);
        }
      } catch {
        // 파싱 실패 시 빈 목록 유지
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const persist = useCallback(async (items: Company[]) => {
    setRecent(items);
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // 저장 실패는 무시 (다음 변경 시 재시도)
    }
  }, []);

  const addRecent = useCallback(
    (company: Company) => {
      setRecent((prev) => {
        const deduped = prev.filter((c) => c.corpCode !== company.corpCode);
        const next = [company, ...deduped].slice(0, MAX_RECENT);
        void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const removeRecent = useCallback(
    (corpCode: string) => {
      setRecent((prev) => {
        const next = prev.filter((c) => c.corpCode !== corpCode);
        void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const clearRecent = useCallback(() => {
    void persist([]);
  }, [persist]);

  return { recent, loaded, addRecent, removeRecent, clearRecent };
}
