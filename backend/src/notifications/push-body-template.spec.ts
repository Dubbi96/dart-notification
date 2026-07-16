import {
  buildEventLead,
  buildReactionStatPhrase,
  buildOneLineJudgmentBody,
  formatKoreanAmountShort,
  EVENT_PUSH_LEAD_LABEL,
  PUSH_BODY_MAX_LENGTH,
  type ReactionStatInput,
} from './push-body-template';

/**
 * DAR-525(Wave B/B4·P1) — 푸시 본문 '한 줄 판단' 표준 단위테스트.
 *
 * 수용기준:
 *   (1) n<30 → 통계 문구 자동 생략.
 *   (2) 본문 길이 제한(트렁케이션) — 가치문구(통계) 보존 우선.
 *   (3) 유형별 리드 템플릿(팩트/라벨) 결정론 고정.
 */

const MIN = 30;

// ─── (3) 이벤트 리드 유형별 템플릿 ─────────────────────────────────────
describe('buildEventLead — 유형별 리드 템플릿(DAR-525 수용기준 3)', () => {
  it('공급계약 + 금액 팩트 → "수주 1,200억"(동사형)', () => {
    expect(buildEventLead({ eventType: 'SUPPLY_CONTRACT', factText: '1,200억' })).toBe('수주 1,200억');
  });

  it('자사주 취득/소각/유상증자/전환사채 동사형', () => {
    expect(buildEventLead({ eventType: 'SHARE_BUYBACK', factText: '500억' })).toBe('자사주 매입 500억');
    expect(buildEventLead({ eventType: 'SHARE_CANCELLATION', factText: '300억' })).toBe('자사주 소각 300억');
    expect(buildEventLead({ eventType: 'PAID_IN_CAPITAL_INCREASE', factText: '1,000억' })).toBe(
      '유상증자 1,000억',
    );
    expect(buildEventLead({ eventType: 'CB_ISSUANCE', factText: '800억' })).toBe('전환사채 800억');
  });

  it('팩트 없으면 간결 라벨(동사형 미적용)', () => {
    expect(buildEventLead({ eventType: 'SUPPLY_CONTRACT' })).toBe('공급계약');
    expect(buildEventLead({ eventType: 'SHARE_BUYBACK' })).toBe('자사주 취득');
  });

  it('동사형 미등록 유형 + 팩트 → "<라벨> <팩트>"', () => {
    // MERGER_SPLIT 은 동사형 미등록 → 라벨 + 팩트.
    expect(buildEventLead({ eventType: 'MERGER_SPLIT', factText: '합병비율 1:0.5' })).toBe(
      '합병·분할 합병비율 1:0.5',
    );
  });

  it('실적류는 정직 기준 병기(전년동기 대비/자사 전망) — event-type-copy SSOT', () => {
    expect(buildEventLead({ eventType: 'EARNINGS_SURPRISE' })).toBe('실적 서프라이즈(전년동기 대비)');
    expect(buildEventLead({ eventType: 'EARNINGS_SHOCK' })).toBe('실적 쇼크(전년동기 대비)');
    expect(buildEventLead({ eventType: 'EARNINGS_GUIDANCE' })).toBe('실적 가이던스(자사 전망)');
  });

  it('eventType 미상/미등록 + 팩트 없음 → undefined(무리한 표기 금지)', () => {
    expect(buildEventLead({ eventType: undefined })).toBeUndefined();
    expect(buildEventLead({ eventType: 'NONEXISTENT_TYPE' })).toBeUndefined();
    expect(buildEventLead({})).toBeUndefined();
  });

  it('빈/공백 팩트는 팩트 없음으로 취급(꼬리 공백 방지)', () => {
    expect(buildEventLead({ eventType: 'SUPPLY_CONTRACT', factText: '  ' })).toBe('공급계약');
    expect(buildEventLead({ eventType: 'SUPPLY_CONTRACT', factText: '' })).toBe('공급계약');
  });

  it('우선 추출 7종 + 실적 3종은 라벨 맵에 존재', () => {
    for (const t of [
      'SUPPLY_CONTRACT',
      'SHARE_BUYBACK',
      'SHARE_CANCELLATION',
      'DIVIDEND_INCREASE',
      'PAID_IN_CAPITAL_INCREASE',
      'CB_ISSUANCE',
      'BW_ISSUANCE',
      'EARNINGS_SURPRISE',
      'EARNINGS_SHOCK',
      'EARNINGS_GUIDANCE',
    ]) {
      expect(EVENT_PUSH_LEAD_LABEL[t]).toBeTruthy();
    }
  });
});

// ─── 금액 축약 헬퍼 ────────────────────────────────────────────────────
describe('formatKoreanAmountShort — 억/조 축약', () => {
  it('억 단위 천단위 구분', () => {
    expect(formatKoreanAmountShort(120_000_000_000)).toBe('1,200억');
    expect(formatKoreanAmountShort(50_000_000_000)).toBe('500억');
    expect(formatKoreanAmountShort(100_000_000)).toBe('1억');
  });

  it('조 단위(정수 조는 소수 생략·아니면 1자리)', () => {
    expect(formatKoreanAmountShort(2_000_000_000_000)).toBe('2조');
    expect(formatKoreanAmountShort(1_200_000_000_000)).toBe('1.2조');
  });

  it('만/원 단위 및 방어(음수·비유한수 undefined)', () => {
    expect(formatKoreanAmountShort(34_000_000)).toBe('3,400만');
    expect(formatKoreanAmountShort(5_000)).toBe('5,000원');
    expect(formatKoreanAmountShort(-1)).toBeUndefined();
    expect(formatKoreanAmountShort(Number.NaN)).toBeUndefined();
  });

  it('금액 팩트 end-to-end: 원 → 리드', () => {
    const fact = formatKoreanAmountShort(120_000_000_000);
    expect(buildEventLead({ eventType: 'SUPPLY_CONTRACT', factText: fact })).toBe('수주 1,200억');
  });
});

// ─── (1) 통계 문구 + 정직 게이트 ───────────────────────────────────────
describe('buildReactionStatPhrase — 정직 게이트(DAR-525 수용기준 1)', () => {
  const stat = (over: Partial<ReactionStatInput>): ReactionStatInput => ({
    horizon: 'D+5',
    avgReturnPct: 2.1,
    sampleCount: 142,
    minSampleSize: MIN,
    ...over,
  });

  it('n≥30 → "유사공시 D+5 평균 +2.1% (n=142)"', () => {
    expect(buildReactionStatPhrase(stat({}))).toBe('유사공시 D+5 평균 +2.1% (n=142)');
  });

  it('★n<30 → null(문구 통째 생략)', () => {
    expect(buildReactionStatPhrase(stat({ sampleCount: 29 }))).toBeNull();
    expect(buildReactionStatPhrase(stat({ sampleCount: 0 }))).toBeNull();
  });

  it('n=30 경계 포함(≥)', () => {
    expect(buildReactionStatPhrase(stat({ sampleCount: 30 }))).toBe('유사공시 D+5 평균 +2.1% (n=30)');
  });

  it('부호 표기: 음수 -, 0 은 부호 없음', () => {
    expect(buildReactionStatPhrase(stat({ avgReturnPct: -0.8 }))).toBe('유사공시 D+5 평균 -0.8% (n=142)');
    expect(buildReactionStatPhrase(stat({ avgReturnPct: 0 }))).toBe('유사공시 D+5 평균 0.0% (n=142)');
    // -0.04 는 반올림 0.0 → 부호 없음(마이너스 0 방지).
    expect(buildReactionStatPhrase(stat({ avgReturnPct: -0.04 }))).toBe('유사공시 D+5 평균 0.0% (n=142)');
  });

  it('지평 라벨 반영(D+1/D+20)', () => {
    expect(buildReactionStatPhrase(stat({ horizon: 'D+1' }))).toContain('D+1');
    expect(buildReactionStatPhrase(stat({ horizon: 'D+20' }))).toContain('D+20');
  });

  it('비유한수/누락 방어 → null', () => {
    expect(buildReactionStatPhrase(stat({ avgReturnPct: Number.NaN }))).toBeNull();
    expect(buildReactionStatPhrase(null)).toBeNull();
    expect(buildReactionStatPhrase(undefined)).toBeNull();
  });
});

// ─── (2) 본문 조립 + 트렁케이션 ────────────────────────────────────────
describe('buildOneLineJudgmentBody — 조립·트렁케이션(DAR-525 수용기준 2)', () => {
  it('표준 형식: "<lead> — <통계>"', () => {
    const r = buildOneLineJudgmentBody({
      lead: '수주 1,200억',
      statPhrase: '유사공시 D+5 평균 +2.1% (n=142)',
    });
    expect(r.body).toBe('수주 1,200억 — 유사공시 D+5 평균 +2.1% (n=142)');
    expect(r.statsIncluded).toBe(true);
    expect(r.truncated).toBe(false);
  });

  it('통계 없음 + 대체 꼬리: "<lead> · <tail>"', () => {
    const r = buildOneLineJudgmentBody({
      lead: '삼성전자 외 2곳',
      statPhrase: null,
      fallbackTail: '매수 후보 3곳 (적극매수 1)',
    });
    expect(r.body).toBe('삼성전자 외 2곳 · 매수 후보 3곳 (적극매수 1)');
    expect(r.statsIncluded).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it('통계·꼬리 모두 없음 → lead 단독', () => {
    const r = buildOneLineJudgmentBody({ lead: '공급계약' });
    expect(r.body).toBe('공급계약');
    expect(r.statsIncluded).toBe(false);
  });

  it('★상한 초과 시 통계 문구는 온전 보존하고 리드만 말줄임', () => {
    const longLead = '가'.repeat(200);
    const statPhrase = '유사공시 D+5 평균 +2.1% (n=142)';
    const r = buildOneLineJudgmentBody({ lead: longLead, statPhrase, maxLength: 50 });
    expect(r.body.length).toBeLessThanOrEqual(50);
    expect(r.body.endsWith(statPhrase)).toBe(true); // 통계 온전.
    expect(r.body).toContain('…'); // 리드는 말줄임.
    expect(r.statsIncluded).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it('통계 없음도 상한 초과 시 전체 컷', () => {
    const r = buildOneLineJudgmentBody({
      lead: '가'.repeat(200),
      fallbackTail: '매수 후보 3곳',
      maxLength: 40,
    });
    expect(r.body.length).toBeLessThanOrEqual(40);
    expect(r.body.endsWith('…')).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it('기본 상한(PUSH_BODY_MAX_LENGTH) 이하 표준 본문은 트렁케이션 없음', () => {
    const r = buildOneLineJudgmentBody({
      lead: '삼성전자 공급계약 외 4곳',
      statPhrase: '유사공시 D+5 평균 +2.1% (n=142)',
    });
    expect(r.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX_LENGTH);
    expect(r.truncated).toBe(false);
  });
});
