import { API_BASE_URL } from './api';

/**
 * 공시 공유 페이지 URL 빌더 (W3b).
 *
 * 백엔드가 서빙하는 공개 공유 페이지(GET /share/:rcpNo — og 메타 + 공시 정보 +
 * 캐시된 AI 요약 + 앱 딥링크)를 가리킨다. 도메인 하드코딩 대신 API base URL
 * (단일 진실원천, `…/api`)에서 웹 오리진을 유도한다.
 *  - prod:  https://168.138.198.152.nip.io/api → https://168.138.198.152.nip.io/share/:rcpNo
 *  - dev:   http://10.0.2.2:3000/api          → http://10.0.2.2:3000/share/:rcpNo
 */
export function buildDisclosureShareUrl(rcpNo: string): string {
  const origin = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  return `${origin}/share/${encodeURIComponent(rcpNo)}`;
}
