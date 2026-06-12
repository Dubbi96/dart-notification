import { useNetInfo } from '@react-native-community/netinfo';
import { isOffline } from '@utils/staleData';

// DAR-173: 전역 오프라인 상태 훅. useNetInfo 구독을 단일 판정(isOffline)으로 감싸
// 배너·카드 보조 라벨이 동일 규칙을 쓰게 한다. 미확정(null)은 온라인으로 간주(오탐 방지).
export interface NetworkStatus {
  isOffline: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const net = useNetInfo();
  return { isOffline: isOffline(net) };
}
