import {
  DISCLOSURE_TYPES,
  EVENT_TYPE_LABEL,
  POLARITY_LABEL,
  getEventTypeLabel,
  getPolarityLabel,
  getTypeLabel,
  getTypeStyle,
} from '@utils/disclosureType';

// 공시유형·이벤트·극성 라벨 매핑(raw enum 노출 방지 DAR-306) 전수성 회귀 가드.
describe('utils/disclosureType', () => {
  it('7개 공시유형 전수가 한국어 라벨을 가진다(raw enum 미노출)', () => {
    for (const type of DISCLOSURE_TYPES) {
      const label = getTypeLabel(type);
      expect(label).not.toBe(type); // 매핑 누락 시 raw enum 그대로 반환됨
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('미매핑 공시유형은 입력값 그대로 폴백한다', () => {
    expect(getTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('뱃지 스타일은 라이트/다크 팔레트에서 7개 유형 전수를 해소한다', () => {
    for (const type of DISCLOSURE_TYPES) {
      for (const isDark of [false, true]) {
        const style = getTypeStyle(type, isDark);
        expect(style.bg).toMatch(/^#/);
        expect(style.text).toMatch(/^#/);
      }
    }
  });

  it('미매핑 유형의 뱃지 스타일은 OTHER 로 폴백한다', () => {
    expect(getTypeStyle('UNKNOWN_TYPE', false)).toEqual(getTypeStyle('OTHER', false));
    expect(getTypeStyle('UNKNOWN_TYPE', true)).toEqual(getTypeStyle('OTHER', true));
  });

  it('이벤트 타입 라벨: 매핑 전수 비어있지 않고, 미매핑은 기타로 폴백(DAR-306)', () => {
    for (const [key, label] of Object.entries(EVENT_TYPE_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
      expect(getEventTypeLabel(key)).toBe(label);
    }
    expect(getEventTypeLabel('BRAND_NEW_EVENT')).toBe(EVENT_TYPE_LABEL.OTHER);
  });

  it("극성 라벨: 전수가 '(참고)' 꼬리표를 포함하고, 미매핑은 미분류 폴백", () => {
    for (const label of Object.values(POLARITY_LABEL)) {
      expect(label).toContain('(참고)');
    }
    expect(getPolarityLabel('WEIRD')).toBe(POLARITY_LABEL.UNKNOWN);
  });
});
