import { useCallback, useState } from 'react';

/**
 * DAR-472: 당겨서 새로고침(pull-to-refresh) 보일러플레이트 추출.
 * DAR-460에서 auto-trading·backtest-track-record 가 동일하게 복제하던
 *   `const [refreshing,setRefreshing]=useState(false); const onRefresh=useCallback(async()=>{...await refetch()...},[refetch])`
 * 패턴을 단일 훅으로 통일한다.
 *
 * RN 코어 <RefreshControl refreshing onRefresh /> 에 그대로 바인딩한다(커스텀 래퍼 금지 규약 유지).
 * refetch 가 던지더라도 finally 에서 스피너를 반드시 내려 무한 로딩을 막는다.
 *
 * @param refetch 데이터 재요청 함수(보통 React Query 의 query.refetch — 안정 참조라 deps 안전).
 */
export function useManualRefresh(refetch: () => Promise<unknown>): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, onRefresh };
}
