import {
  parseAndValidate,
  JsonOutputValidationError,
  OutputSchema,
} from './json-output.validator';

const SCHEMA: OutputSchema = {
  summary: { type: 'string' },
  positiveFactors: { type: 'string[]' },
  polarity: { type: 'enum', values: ['POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL'] },
};

describe('parseAndValidate', () => {
  it('유효한 JSON을 파싱하고 스키마 필드만 통과시킨다', () => {
    const raw = JSON.stringify({
      summary: '요약',
      positiveFactors: ['a', 'b'],
      polarity: 'POSITIVE',
      hallucinatedField: '버려져야 함', // 화이트리스트로 제거
    });
    const out = parseAndValidate<Record<string, unknown>>(raw, SCHEMA);
    expect(out).toEqual({ summary: '요약', positiveFactors: ['a', 'b'], polarity: 'POSITIVE' });
    expect('hallucinatedField' in out).toBe(false);
  });

  it('JSON 파싱 실패 시 예외', () => {
    expect(() => parseAndValidate('not json', SCHEMA)).toThrow(JsonOutputValidationError);
  });

  it('타입 불일치 시 예외', () => {
    const raw = JSON.stringify({ summary: 123, positiveFactors: [], polarity: 'POSITIVE' });
    expect(() => parseAndValidate(raw, SCHEMA)).toThrow(/summary/);
  });

  it('enum 허용값 위반 시 예외', () => {
    const raw = JSON.stringify({ summary: 's', positiveFactors: [], polarity: 'UNKNOWN' });
    expect(() => parseAndValidate(raw, SCHEMA)).toThrow(/polarity/);
  });

  it('문자열 배열에 비문자열 포함 시 예외', () => {
    const raw = JSON.stringify({ summary: 's', positiveFactors: ['a', 1], polarity: 'MIXED' });
    expect(() => parseAndValidate(raw, SCHEMA)).toThrow(/positiveFactors/);
  });
});
