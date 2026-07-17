import {
  resolveDeepLink,
  isAllowedDeepLink,
  ALLOWED_DEEPLINK_PREFIXES,
} from '@utils/deeplink';

// DAR-524: PRICE_MOVE 알림 → '왜 움직였나' 카드(/price-move/:refId) 딥링크 라우팅 검증.
//   순수 모듈을 그대로 임포트해 화이트리스트·타입별 폴백·신뢰 경계·기존 회귀를 단언한다.
const REF_ID = '000200-20260717';
const CARD_PATH = `/price-move/${REF_ID}`;

describe('utils/deeplink — PRICE_MOVE 카드 라우팅(DAR-524)', () => {
  it('/price-move 가 허용 prefix 에 편입됐다', () => {
    expect(ALLOWED_DEEPLINK_PREFIXES).toContain('/price-move');
    expect(isAllowedDeepLink(CARD_PATH)).toBe(true);
  });

  it('deepLink 필드로 카드 경로를 실으면 그대로 라우팅한다', () => {
    expect(resolveDeepLink({ deepLink: CARD_PATH })).toBe(CARD_PATH);
  });

  it('type=PRICE_MOVE·refId 만 있어도 타입별 폴백으로 카드에 도달한다(dead tap 제거)', () => {
    expect(resolveDeepLink({ type: 'PRICE_MOVE', refId: REF_ID })).toBe(CARD_PATH);
  });

  it('refId 없는 PRICE_MOVE 는 대상 특정 불가 → 라우팅하지 않는다(오도 방지)', () => {
    expect(resolveDeepLink({ type: 'PRICE_MOVE' })).toBeNull();
  });

  it('신뢰 경계 — prefix 우회(/price-moveX)·외부 스킴은 거부한다', () => {
    expect(isAllowedDeepLink('/price-moveX')).toBe(false);
    expect(isAllowedDeepLink('gongsion://price-move/x')).toBe(false);
    expect(isAllowedDeepLink('/price-move/../portfolio')).toBe(false);
  });

  it('★현행 백엔드 회귀 문서화 — deepLink=/company 가 실리면 그 필드가 우선한다', () => {
    // engine3 발화는 아직 deepLink=/company/<corpCode> 를 실으므로 카드가 아닌 기업상세로 간다.
    // 카드 진입은 BE deepLink 재타겟(/price-move/<refId>)이 선행돼야 한다 — 자식 이슈로 위임.
    expect(
      resolveDeepLink({ deepLink: '/company/C002', type: 'PRICE_MOVE', refId: REF_ID }),
    ).toBe('/company/C002');
  });

  it('기존 타입 라우팅 회귀 없음 — SIGNAL·공시 폴백 보존', () => {
    expect(resolveDeepLink({ type: 'SIGNAL', refId: 's1' })).toBe('/signals/s1');
    expect(resolveDeepLink({ disclosureRcpNo: '20260717000001' })).toBe(
      '/disclosure/20260717000001',
    );
  });
});

// DAR-527: 에디션 발행 푸시 → 신호탭 '해당 호'(거래일) 직행 딥링크 검증.
const EDITION_DATE = '20260717';
const EDITION_PATH = `/signals?date=${EDITION_DATE}`;

describe('utils/deeplink — 에디션 발행 딥링크 직행(DAR-527)', () => {
  it('/signals?date=YYYYMMDD 는 /signals prefix 의 쿼리 규칙으로 화이트리스트 통과', () => {
    expect(isAllowedDeepLink(EDITION_PATH)).toBe(true);
    expect(ALLOWED_DEEPLINK_PREFIXES).toContain('/signals'); // 새 prefix 불요
  });

  it('deepLink 필드로 날짜 경로를 실으면 그대로 라우팅한다(신 payload — 해당 호 직행)', () => {
    expect(resolveDeepLink({ deepLink: EDITION_PATH, type: 'EDITION', refId: EDITION_DATE })).toBe(
      EDITION_PATH,
    );
  });

  it('deepLink 누락이어도 type=EDITION·refId(=editionDate)로 해당 호에 직행한다(dead tap 제거)', () => {
    expect(resolveDeepLink({ type: 'EDITION', refId: EDITION_DATE })).toBe(EDITION_PATH);
  });

  it('refId 없는 EDITION 은 신호탭(최신 호)로 무해 폴백한다(dead tap 아님)', () => {
    expect(resolveDeepLink({ type: 'EDITION' })).toBe('/signals');
  });

  it('★현행 백엔드 회귀 문서화 — deepLink=/signals(날짜 없음)가 우선한다', () => {
    // DAR-523 발화는 아직 범용 deepLink=/signals(날짜 없음)를 실으므로 신호탭 최신 호로 간다.
    // '해당 호 직행'은 BE deepLink 재타겟(/signals?date=<editionDate>)이 선행돼야 한다 — 자식 이슈로 위임.
    expect(resolveDeepLink({ deepLink: '/signals', type: 'EDITION', refId: EDITION_DATE })).toBe(
      '/signals',
    );
  });

  it('신뢰 경계 — 잘못된 refId(형식 아님)는 날짜 경로를 만들지 않는다', () => {
    expect(resolveDeepLink({ type: 'EDITION', refId: '../portfolio' })).toBe('/signals');
    expect(resolveDeepLink({ type: 'EDITION', refId: '2026-07-17' })).toBe('/signals');
  });
});
