import { useAuthStore } from '@stores/authStore';
import { buildTesterEventPayload, type TesterEvent } from '@utils/testerEvents';

import { api } from './api';

/**
 * DAR-516 [Wave A/A6] 테스터 코호트 계측 전송 — fire-and-forget.
 *
 * 로그인 후 인앱 참여 이벤트(에디션 오픈·카드 탭·푸시 오픈·통계 노출·waitlist CTA·iOS 설문)를
 * 인증 POST /ops/tester-event 로 기록한다.
 *
 * ★계측은 제품 경로가 아니다: 어떤 실패(오프라인·서버 다운·401)도 호출 화면으로 전파하지
 *   않는다 — 전 구간 try/catch 흡수. 호출부는 `void recordTesterEvent(...)` 로 발화한다.
 * ★인증 게이팅: accessToken 이 없는 게스트/로그인 이전 상태에서는 전송하지 않는다
 *   (엔드포인트가 JwtAuthGuard 이므로 401 스팸을 원천 차단). 서버는 userId·event·ts 만 적재.
 * ★서버 상태가 아니므로 React Query 훅 대상이 아니다(일회성 계측 발화 — funnel.service 관례).
 */
export async function recordTesterEvent(event: TesterEvent): Promise<void> {
  try {
    // 인증 사용자만 계측(게스트/미로그인은 조용히 스킵 — 엔드포인트가 인증 필수).
    if (!useAuthStore.getState().accessToken) return;
    await api.post('/ops/tester-event', buildTesterEventPayload(event));
  } catch {
    // 계측 실패는 무시 — 사용자 흐름·화면에 어떤 영향도 주지 않는다.
  }
}
