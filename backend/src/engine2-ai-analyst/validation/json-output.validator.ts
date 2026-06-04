/**
 * AI JSON 출력 검증 — 파싱 + 필드 화이트리스트 + 타입 강제.
 * 스키마에 없는 필드는 버린다(프롬프트 인젝션·환각 필드 차단). 외부 의존성 없음.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'string[]' | 'enum';

export interface FieldSpec {
  type: FieldType;
  values?: readonly string[]; // type === 'enum' 일 때
}

export type OutputSchema = Record<string, FieldSpec>;

export class JsonOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonOutputValidationError';
  }
}

export function parseAndValidate<T>(raw: string, schema: OutputSchema): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JsonOutputValidationError('JSON 파싱 실패');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JsonOutputValidationError('최상위가 객체가 아님');
  }

  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    validateField(key, src[key], spec);
    out[key] = src[key]; // 화이트리스트: 스키마 정의 필드만 통과
  }
  return out as T;
}

export function parseAndValidateArray<T>(raw: string, itemSchema: OutputSchema): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JsonOutputValidationError('JSON 파싱 실패');
  }
  if (!Array.isArray(parsed)) {
    throw new JsonOutputValidationError('최상위가 배열이 아님');
  }
  return parsed.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new JsonOutputValidationError(`항목[${idx}]: 객체가 아님`);
    }
    const src = item as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(itemSchema)) {
      validateField(key, src[key], spec);
      out[key] = src[key];
    }
    return out as T;
  });
}

function validateField(key: string, value: unknown, spec: FieldSpec): void {
  const fail = (msg: string): never => {
    throw new JsonOutputValidationError(`필드 '${key}': ${msg}`);
  };
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') fail('문자열이어야 함');
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) fail('숫자여야 함');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('불리언이어야 함');
      break;
    case 'string[]':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        fail('문자열 배열이어야 함');
      }
      break;
    case 'enum':
      if (typeof value !== 'string' || !spec.values?.includes(value)) {
        fail(`허용값(${spec.values?.join(', ')}) 중 하나여야 함`);
      }
      break;
  }
}
