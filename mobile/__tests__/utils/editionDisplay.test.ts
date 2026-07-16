import {
  editionDateOrdinal,
  formatEditionChipLabel,
  getEditionEmptyCopy,
} from '@utils/editionDisplay';

// DAR-509: 에디션 브라우징 표시 SSOT 순수 로직 검증 — 날짜 스트립 칩 라벨(오늘/어제/M.D) +
// 빈 에디션 정직 4분기+미래 카피. date/todayDate(KST 'YYYYMMDD') 비교만으로 결정론(now 무주입).

describe('utils/editionDisplay — editionDateOrdinal', () => {
  it('유효 YYYYMMDD를 단조 증가 일 서수로 변환한다', () => {
    const a = editionDateOrdinal('20260716');
    const b = editionDateOrdinal('20260717');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((b as number) - (a as number)).toBe(1);
  });

  it('형식/실존 위반이면 null(억지 표기 금지)', () => {
    expect(editionDateOrdinal('2026071')).toBeNull(); // 7자리
    expect(editionDateOrdinal('20260230')).toBeNull(); // 2월 30일 미존재
    expect(editionDateOrdinal('abcd1234')).toBeNull();
    expect(editionDateOrdinal(undefined)).toBeNull();
    expect(editionDateOrdinal('')).toBeNull();
  });
});

describe('utils/editionDisplay — formatEditionChipLabel', () => {
  const TODAY = '20260717';

  it('오늘/어제는 상대 라벨, isToday 플래그를 정확히 세팅한다', () => {
    expect(formatEditionChipLabel('20260717', TODAY)).toEqual({
      primary: '오늘',
      a11y: '오늘',
      isToday: true,
    });
    expect(formatEditionChipLabel('20260716', TODAY)).toEqual({
      primary: '어제',
      a11y: '어제',
      isToday: false,
    });
  });

  it('그제 이상은 절대 M.D(음성은 M월 D일)', () => {
    expect(formatEditionChipLabel('20260714', TODAY)).toEqual({
      primary: '7.14',
      a11y: '7월 14일',
      isToday: false,
    });
  });

  it('연말→연초 경계에서도 어제를 올바르게 판정한다', () => {
    expect(formatEditionChipLabel('20251231', '20260101').primary).toBe('어제');
  });

  it('todayDate 미상이면 상대 판정 없이 절대 M.D', () => {
    expect(formatEditionChipLabel('20260714', undefined).primary).toBe('7.14');
  });

  it('date 파싱 불가면 원문을 그대로(억지 변환 금지)', () => {
    expect(formatEditionChipLabel('bad-date', TODAY)).toEqual({
      primary: 'bad-date',
      a11y: 'bad-date',
      isToday: false,
    });
  });
});

describe('utils/editionDisplay — getEditionEmptyCopy', () => {
  it('4분기 사유별로 서로 다른 정직 카피를 반환한다', () => {
    expect(getEditionEmptyCopy('CLOSED').title).toContain('휴장');
    expect(getEditionEmptyCopy('PENDING').title).toContain('준비 중');
    expect(getEditionEmptyCopy('PENDING').description).toContain('7시');
    expect(getEditionEmptyCopy('QUIET').title).toContain('주목할 신호가 없');
    expect(getEditionEmptyCopy('QUIET').description).toContain('조용');
    expect(getEditionEmptyCopy('COLD_START').title).toContain('발행');
  });

  it('FUTURE는 별도(미래) 카피 — 빈 상태와 혼동 금지', () => {
    expect(getEditionEmptyCopy('FUTURE').title).toContain('오지 않은');
  });

  it('사유 미상은 QUIET로 폴백(단정 없는 중립 카피)', () => {
    expect(getEditionEmptyCopy(undefined)).toEqual(getEditionEmptyCopy('QUIET'));
  });

  it('모든 사유가 유효한 Feather 아이콘명·비어있지 않은 카피를 갖는다', () => {
    for (const reason of ['CLOSED', 'PENDING', 'QUIET', 'COLD_START', 'FUTURE', undefined] as const) {
      const copy = getEditionEmptyCopy(reason);
      expect(typeof copy.icon).toBe('string');
      expect(copy.icon.length).toBeGreaterThan(0);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });
});
