import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { isOnline } from '@utils/staleData';

// DAR-173: React Query onlineManager 를 NetInfo 에 연동.
// 단절→복구 시 onlineManager 가 online 전환을 브로드캐스트하고, refetchOnReconnect(기본 true)
// 로 stale 쿼리가 자동 재요청된다(복구 시 자동 refetch). 모듈 1회만 구독(중복 리스너 방지).
let configured = false;

export function configureOnlineManager(): void {
  if (configured) return;
  configured = true;
  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      setOnline(isOnline(state));
    });
  });
}
