/**
 * 페이지네이션/리스트 정수 쿼리 파라미터 안전 파싱 정본 (DAR-273).
 *
 * 쿼리스트링 값은 항상 `string | undefined` 이다. 각 read 컨트롤러가
 * `Number(raw)` / `parseInt(raw, 10)` 로 손수 변환하면 `?limit=abc` → `NaN` 이
 * 그대로 Prisma `take`/`skip` 으로 흘러 `invalid value NaN` 500 을 일으키고,
 * 상한이 없으면 거대 `limit` 이 무한 쿼리(부하)로 이어진다.
 *
 * 이 헬퍼로 변환을 단일화한다:
 *  - 비숫자 / `NaN` / 공백 / 미지정 → `default`(미지정 시 `undefined`)
 *  - 소수 → `Math.floor`
 *  - `min`(기본 1) 미만(음수 포함) → `min` 으로 클램프
 *  - `max` 초과 → `max` 로 클램프 (`max` 미지정 시 상한 없음)
 *
 * 정상 입력(평범한 정수 문자열)의 결과는 기존 동작과 동일하다. 잘못된 입력만
 * 안전한 기본값/경계값으로 보정된다.
 */
export interface ParsePaginationOptions {
  /**
   * 값이 없거나(undefined/null/빈 문자열) 숫자로 해석 불가(NaN)일 때 반환할 기본값.
   * 생략하면 그런 경우 `undefined` 를 반환한다(미지정·무제한 의미 보존).
   */
  default?: number;
  /** 하한(포함). 기본 1. offset 류 0-기반 파라미터는 0 을 전달한다. */
  min?: number;
  /** 상한(포함). 생략하면 상한을 적용하지 않는다. */
  max?: number;
}

/**
 * 쿼리 정수 파라미터를 안전하게 파싱한다.
 *
 * @param raw   원시 쿼리 값(보통 `string | undefined`).
 * @param options `default`/`min`/`max`.
 * @returns 보정된 정수. `default` 미지정 + 무효 입력일 때만 `undefined`.
 */
export function parsePaginationInt(
  raw: unknown,
  options: ParsePaginationOptions & { default: number },
): number;
export function parsePaginationInt(
  raw: unknown,
  options?: ParsePaginationOptions,
): number | undefined;
export function parsePaginationInt(
  raw: unknown,
  options: ParsePaginationOptions = {},
): number | undefined {
  const { default: fallback, min = 1, max } = options;

  const parsed = toFiniteNumber(raw);
  if (parsed === undefined) {
    return fallback === undefined ? undefined : clamp(fallback, min, max);
  }

  return clamp(Math.floor(parsed), min, max);
}

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clamp(value: number, min: number, max?: number): number {
  let v = value;
  if (v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}
