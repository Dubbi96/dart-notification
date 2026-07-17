/**
 * DAR-551: 빈 에디션 폴백 브리핑 순수 매핑 단위테스트.
 *
 * 수용기준 커버(순수 계층):
 * - eventType → 한국어 라벨(EVENT_PUSH_LEAD_LABEL SSOT 재사용), OTHER·null·미등록 → '기타 공시'
 * - AI 요약(summaryText) 재사용 → summarySource='AI'
 * - 요약 없음/공백 → 제목(reportName) 폴백 → summarySource='TITLE'
 * - 한 줄 정규화(개행·연속공백 접기) + 최대 길이 말줄임
 */

import {
  DEFAULT_EVENT_LABEL,
  FALLBACK_BRIEFING_LIMIT,
  SUMMARY_LINE_MAX_LEN,
  buildFallbackBriefingItems,
  resolveEventLabel,
  toOneLineSummary,
  type FallbackBriefingRow,
} from './fallback-briefing';
import { EVENT_PUSH_LEAD_LABEL } from '../../notifications/push-body-template';

describe('resolveEventLabel', () => {
  it('분류된 이벤트 → EVENT_PUSH_LEAD_LABEL SSOT 라벨', () => {
    expect(resolveEventLabel('SUPPLY_CONTRACT')).toBe(EVENT_PUSH_LEAD_LABEL.SUPPLY_CONTRACT);
    expect(resolveEventLabel('SUPPLY_CONTRACT')).toBe('공급계약');
    expect(resolveEventLabel('MERGER_SPLIT')).toBe('합병·분할');
  });

  it('null(이벤트 없음) → 기타 공시', () => {
    expect(resolveEventLabel(null)).toBe(DEFAULT_EVENT_LABEL);
    expect(resolveEventLabel(null)).toBe('기타 공시');
  });

  it('OTHER → 기타 공시', () => {
    expect(resolveEventLabel('OTHER')).toBe(DEFAULT_EVENT_LABEL);
  });

  it('미등록 eventType → 기타 공시(폴백)', () => {
    expect(resolveEventLabel('NOT_A_REAL_EVENT')).toBe(DEFAULT_EVENT_LABEL);
  });
});

describe('toOneLineSummary', () => {
  it('개행·연속공백을 단일 공백으로 접는다', () => {
    expect(toOneLineSummary('첫 줄\n둘째  줄\t셋째')).toBe('첫 줄 둘째 줄 셋째');
  });

  it('앞뒤 공백 제거', () => {
    expect(toOneLineSummary('  요약  ')).toBe('요약');
  });

  it('maxLen 이하이면 그대로', () => {
    const s = '짧은 요약';
    expect(toOneLineSummary(s)).toBe(s);
  });

  it('maxLen 초과 시 말줄임(…) 포함, 길이 == maxLen', () => {
    const long = 'x'.repeat(SUMMARY_LINE_MAX_LEN + 50);
    const out = toOneLineSummary(long);
    expect(out.length).toBe(SUMMARY_LINE_MAX_LEN);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildFallbackBriefingItems', () => {
  const row = (over: Partial<FallbackBriefingRow>): FallbackBriefingRow => ({
    rcpNo: '20260716000001',
    corpName: '삼성전자',
    reportName: '단일판매·공급계약 체결',
    eventType: 'SUPPLY_CONTRACT',
    summaryText: 'AI가 만든 한 줄 요약입니다.',
    ...over,
  });

  it('AI 요약 존재 → summaryLine=AI 요약, summarySource=AI', () => {
    const [item] = buildFallbackBriefingItems([row({})]);
    expect(item.rcpNo).toBe('20260716000001');
    expect(item.corpName).toBe('삼성전자');
    expect(item.eventLabel).toBe('공급계약');
    expect(item.summaryLine).toBe('AI가 만든 한 줄 요약입니다.');
    expect(item.summarySource).toBe('AI');
  });

  it('요약 null → 제목(reportName) 폴백, summarySource=TITLE', () => {
    const [item] = buildFallbackBriefingItems([row({ summaryText: null })]);
    expect(item.summaryLine).toBe('단일판매·공급계약 체결');
    expect(item.summarySource).toBe('TITLE');
  });

  it('요약 공백만 → 제목 폴백(TITLE)', () => {
    const [item] = buildFallbackBriefingItems([row({ summaryText: '   \n  ' })]);
    expect(item.summaryLine).toBe('단일판매·공급계약 체결');
    expect(item.summarySource).toBe('TITLE');
  });

  it('이벤트 없음(null) → eventLabel=기타 공시', () => {
    const [item] = buildFallbackBriefingItems([row({ eventType: null })]);
    expect(item.eventLabel).toBe('기타 공시');
  });

  it('빈 입력 → 빈 배열', () => {
    expect(buildFallbackBriefingItems([])).toEqual([]);
  });

  it('입력 순서(SQL 랭킹)를 보존한다', () => {
    const items = buildFallbackBriefingItems([
      row({ rcpNo: 'A' }),
      row({ rcpNo: 'B' }),
      row({ rcpNo: 'C' }),
    ]);
    expect(items.map((i) => i.rcpNo)).toEqual(['A', 'B', 'C']);
  });
});

describe('상수 계약', () => {
  it('브리핑 top N = 5', () => {
    expect(FALLBACK_BRIEFING_LIMIT).toBe(5);
  });
});
