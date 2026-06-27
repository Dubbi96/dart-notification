import { useEffect, useState } from 'react';

/**
 * DAR-472: 검색 입력 디바운스 공통 지연(ms). 통합검색·관심기업 검색이 동일 지연을 공유하도록
 * SSOT 상수로 통일(DAR-457에서 두 화면에 각각 `const SEARCH_DEBOUNCE_MS = 300` 으로 복제돼 있던 값).
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * 값이 `delay`(ms) 동안 변하지 않으면 디바운스된 값을 반환한다.
 * 검색 입력처럼 빈번한 상태 변경을 줄여 API 호출을 억제하는 데 사용한다.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
