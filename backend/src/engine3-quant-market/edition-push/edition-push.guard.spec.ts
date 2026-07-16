import {
  decideEditionPush,
  buildEditionPushContent,
  type EditionQueryResultShape,
  type EditionPushPublish,
} from './edition-push.guard';

/**
 * DAR-523(Wave B/B2·P0) — 에디션 발행 하드 가드 단위테스트.
 *
 * ★수용기준 1: 빈 에디션(매수등급 0) 날은 발송 금지. emptyReason(QUIET/CLOSED/PENDING/FUTURE/
 *   COLD_START) 불문 무조건 미발행임을 결정론으로 고정한다.
 */

/** 빈 에디션 결과(items 0건 + 주어진 emptyReason). */
function emptyEdition(date: string, emptyReason?: string): EditionQueryResultShape {
  return { items: [], meta: { date, isEmpty: true, emptyReason } };
}

/** 매수등급 items 를 담은 비어있지 않은 에디션 결과. */
function nonEmptyEdition(
  date: string,
  items: { corpName: string; grade: string }[],
): EditionQueryResultShape {
  return { items, meta: { date, isEmpty: false } };
}

describe('decideEditionPush — 빈 에디션 발송 금지 하드 가드(DAR-523)', () => {
  describe('★빈 에디션(매수등급 0)은 emptyReason 불문 미발행', () => {
    const reasons = ['CLOSED', 'QUIET', 'PENDING', 'FUTURE', 'COLD_START', undefined];
    for (const reason of reasons) {
      it(`emptyReason=${reason ?? 'undefined'} → publish=false(발송 0)`, () => {
        const decision = decideEditionPush(emptyEdition('20260717', reason));
        expect(decision.publish).toBe(false);
        if (!decision.publish) {
          expect(decision.reason).toBe('EMPTY_EDITION');
          expect(decision.editionDate).toBe('20260717');
          expect(decision.emptyReason).toBe(reason);
        }
      });
    }

    it('isEmpty=false 라도 items 가 실제 0건이면 미발행(방어적 이중 판정)', () => {
      const decision = decideEditionPush({
        items: [],
        meta: { date: '20260717', isEmpty: false },
      });
      expect(decision.publish).toBe(false);
    });
  });

  describe('매수등급 >0 이면 발행 + 집계 산출', () => {
    it('count·strongBuyCount·headline(최상위) 산출', () => {
      const decision = decideEditionPush(
        nonEmptyEdition('20260717', [
          { corpName: '삼성전자', grade: 'STRONG_BUY' },
          { corpName: 'LG에너지솔루션', grade: 'BUY' },
          { corpName: 'SK하이닉스', grade: 'STRONG_BUY' },
        ]),
      );
      expect(decision.publish).toBe(true);
      if (decision.publish) {
        expect(decision.count).toBe(3);
        expect(decision.strongBuyCount).toBe(2);
        // findDailyEdition 이 buyScore desc 정렬 → items[0] 이 헤드라인.
        expect(decision.headlineCorpName).toBe('삼성전자');
        expect(decision.editionDate).toBe('20260717');
      }
    });

    it('단일 매수후보(적극매수 0)도 발행', () => {
      const decision = decideEditionPush(
        nonEmptyEdition('20260717', [{ corpName: 'LG전자', grade: 'BUY' }]),
      );
      expect(decision.publish).toBe(true);
      if (decision.publish) {
        expect(decision.count).toBe(1);
        expect(decision.strongBuyCount).toBe(0);
        expect(decision.headlineCorpName).toBe('LG전자');
      }
    });
  });
});

describe('buildEditionPushContent — 정직 카피(DAR-523)', () => {
  const base: EditionPushPublish = {
    publish: true,
    editionDate: '20260717',
    count: 3,
    strongBuyCount: 1,
    headlineCorpName: '삼성전자',
  };

  it('제목 고정·본문 팩트(헤드라인+후보수+적극매수)·딥링크 /signals', () => {
    const c = buildEditionPushContent(base);
    expect(c.title).toBe('오늘의 투자판단 에디션');
    expect(c.body).toBe('삼성전자 외 2곳 · 매수 후보 3곳 (적극매수 1)');
    expect(c.deepLink).toBe('/signals');
  });

  it('단일 후보는 "외 N곳" 없음·적극매수 0 이면 괄호 없음', () => {
    const c = buildEditionPushContent({
      ...base,
      count: 1,
      strongBuyCount: 0,
      headlineCorpName: 'LG전자',
    });
    expect(c.body).toBe('LG전자 · 매수 후보 1곳');
  });

  it('제목·본문에 권고/과장·대괄호 문구 없음(정직 원칙)', () => {
    const c = buildEditionPushContent(base);
    expect(c.title).not.toContain('[');
    expect(c.body).not.toContain('[');
    // 권고성 단어를 쓰지 않는다(팩트 표기만).
    for (const word of ['추천', '지금', '급등', '보장', '확실']) {
      expect(c.body).not.toContain(word);
    }
  });
});
