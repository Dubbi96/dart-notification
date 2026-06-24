/**
 * DAR-431 결정론적 검증: 체결 알림 딥링크 라우팅 + 전략별(5+1트랙) 식별.
 *
 * 실제 화면이 쓰는 순수 모듈을 그대로 임포트해 다음을 증명한다.
 *
 * A. 트랙별 딥링크가 화이트리스트를 통과하고 ★자기 자신으로 라우팅된다(포트폴리오 루트
 *    `/portfolio` 폴백 X). 시스템 모의는 `/portfolio?tab=sim`, 단타·4전략은
 *    `/portfolio/strategy/<key>`.
 * B. push data 의 strategyKey 및 인박스의 deepLink 양쪽으로 트랙을 역식별할 수 있다.
 * C. 시스템 모의 딥링크의 `tab=sim` 파라미터가 포트폴리오 시스템 모의 서브탭으로 해석된다.
 * D. 신뢰 경계 — 미지원 전략/외부 스킴은 트랙 미식별·라우팅 거부.
 *
 * 실행: npx tsx scripts/check-trade-deeplink-routing.ts  (실패 시 exit 1)
 */

import { resolveDeepLink, isAllowedDeepLink } from '../utils/deeplink';
import { TRADE_TRACKS, trackByDeepLink, trackByKey } from '../utils/tradeTracks';
import { resolveInitialSubTab } from '../utils/portfolioTabs';

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? `\n   ${detail}` : ''}`);
}

// A. 트랙별 딥링크 — 화이트리스트 통과 + 자기 자신으로 라우팅(루트 폴백 X)
for (const t of TRADE_TRACKS) {
  check(`A1 ${t.key} 딥링크 화이트리스트 통과`, isAllowedDeepLink(t.deepLink), t.deepLink);

  // 인박스 알림 아이템 형태(deepLink 충전) → 자기 경로 그대로 라우팅
  const routed = resolveDeepLink({ deepLink: t.deepLink, type: 'TRADE_ENTRY', refId: 'x' });
  check(`A2 ${t.key} → 자기 경로 라우팅`, routed === t.deepLink, `routed=${routed}`);

  // ★핵심 회귀: 포트폴리오 루트로 폴백하지 않는다(시스템 모의 포함)
  check(`A3 ${t.key} 루트 폴백 아님`, routed !== '/portfolio', `routed=${routed}`);
}

// B. 트랙 역식별 — strategyKey / deepLink 양쪽
for (const t of TRADE_TRACKS) {
  check(`B1 ${t.key} strategyKey 역식별`, trackByKey(t.key)?.key === t.key);
  check(`B2 ${t.key} deepLink 역식별`, trackByDeepLink(t.deepLink)?.key === t.key);
  check(`B3 ${t.key} 라벨 비어있지 않음`, t.label.length > 0, t.label);
}

// 라이브 체결 알림 발행 트랙 = 단타 + 시스템 모의 2종(4전략은 백테스트 전용)
const emitting = TRADE_TRACKS.filter((t) => t.emitsTradeNotifications).map((t) => t.key).sort();
check(
  'B4 라이브 발행 트랙 = 단타·시스템 모의',
  JSON.stringify(emitting) === JSON.stringify(['intraday-scalp', 'paper-simulation']),
  emitting.join(','),
);

// C. 시스템 모의 — tab=sim → 포트폴리오 시스템 모의 서브탭
check('C1 시스템 모의 딥링크 = /portfolio?tab=sim', trackByKey('paper-simulation')?.deepLink === '/portfolio?tab=sim');
check("C2 tab=sim → 'sim' 서브탭", resolveInitialSubTab('sim') === 'sim');
check('C3 미지정 tab → live 폴백', resolveInitialSubTab(undefined) === 'live');
check('C4 미허용 tab → live 폴백', resolveInitialSubTab('evil') === 'live');

// D. 신뢰 경계 — 미지원 전략/외부 스킴 거부
check('D1 미지원 전략 deepLink → 트랙 null', trackByDeepLink('/portfolio/strategy/evil') === null);
check('D2 외부 스킴 화이트리스트 거부', !isAllowedDeepLink('https://evil.com'));
check('D3 트래버설 거부', !isAllowedDeepLink('/portfolio/../secrets'));
check('D4 prefix 우회(/portfolioX) 거부', !isAllowedDeepLink('/portfolioX'));

console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error(`${failures}건 실패`);
  process.exit(1);
}
console.log('All cases passed');
