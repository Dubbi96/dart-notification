import { createHash } from 'crypto';

import {
  CanonicalFeatureSnapshot,
  FeatureQualityInput,
  FeatureSnapshotDomainError,
  FeatureSnapshotInput,
  FeatureSnapshotJsonObject,
  FeatureSnapshotJsonValue,
} from './feature-snapshot.types';

const CORP_CODE = /^[0-9]{8}$/;
const STOCK_CODE = /^[0-9]{6}$/;
const SCHEMA_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MARKET_SESSION_DATE = /^[0-9]{8}$/;

export function buildFeatureSnapshot(input: FeatureSnapshotInput): CanonicalFeatureSnapshot {
  if (input.instrumentType !== undefined && input.instrumentType !== 'KR_STOCK') {
    throw invalidSnapshot('instrumentType', 'must be KR_STOCK');
  }
  const corpCode = matching(input.corpCode, CORP_CODE, 'corpCode', '8 digits');
  const stockCode = matching(input.stockCode, STOCK_CODE, 'stockCode', '6 digits');
  const schemaVersion = matching(
    input.schemaVersion,
    SCHEMA_VERSION,
    'schemaVersion',
    '1-64 letters, digits, dot, underscore, or hyphen',
  );
  const marketSessionDate = validSessionDate(input.marketSessionDate);
  const asOf = validInstant(input.asOf);
  const features = jsonObject(input.features, 'features');
  const sourceRefs = jsonObject(input.sourceRefs, 'sourceRefs');
  const quality = canonicalQuality(input.quality);

  const payload = {
    instrumentType: 'KR_STOCK' as const,
    corpCode,
    stockCode,
    asOf,
    marketSessionDate,
    schemaVersion,
    features,
    sourceRefs,
    quality,
  };

  return Object.freeze({
    ...payload,
    contentHash: createHash('sha256').update(canonicalizeFeatureJson(payload)).digest('hex'),
  });
}

export function canonicalizeFeatureJson(value: unknown): string {
  return serialize(value, '$', new WeakSet<object>());
}

/** null로 고정된 결측 leaf 경로를 정렬해 quality 원장 입력으로 만든다. */
export function collectMissingFeatureKeys(value: unknown): readonly string[] {
  const missing: string[] = [];
  collectMissing(value, '', missing, new WeakSet<object>());
  return Object.freeze([...new Set(missing)].sort());
}

function collectMissing(
  value: unknown,
  path: string,
  missing: string[],
  ancestors: WeakSet<object>,
): void {
  if (value === null) {
    if (path) missing.push(path);
    return;
  }
  if (typeof value !== 'object') return;
  if (ancestors.has(value)) throw invalidJson(path || '$', 'cyclic references are not supported');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectMissing(item, `${path}[${index}]`, missing, ancestors));
      return;
    }
    for (const key of Object.keys(value).sort()) {
      collectMissing(
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        missing,
        ancestors,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

function serialize(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidJson(path, 'numbers must be finite');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'object') {
    throw invalidJson(path, `unsupported value type: ${typeof value}`);
  }
  if (ancestors.has(value)) throw invalidJson(path, 'cyclic references are not supported');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw invalidJson(`${path}[${index}]`, 'sparse arrays are invalid');
        }
        items.push(serialize(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidJson(path, 'only plain JSON objects are supported');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw invalidJson(path, 'symbol keys are not supported');
    }
    if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length) {
      throw invalidJson(path, 'non-enumerable keys are not supported');
    }

    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || descriptor.get || descriptor.set) {
          throw invalidJson(`${path}.${key}`, 'accessors are not supported');
        }
        return `${quoteString(key)}:${serialize(descriptor.value, `${path}.${key}`, ancestors)}`;
      })
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function quoteString(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function jsonObject(value: unknown, field: string): FeatureSnapshotJsonObject {
  canonicalizeFeatureJson(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidJson(field, 'must be a JSON object');
  }
  return deepFreezeJson(value as FeatureSnapshotJsonObject) as FeatureSnapshotJsonObject;
}

function deepFreezeJson(value: FeatureSnapshotJsonValue): FeatureSnapshotJsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => deepFreezeJson(item)));
  const clone = Object.create(null) as Record<string, FeatureSnapshotJsonValue>;
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) clone[key] = deepFreezeJson(child);
  }
  return Object.freeze(clone);
}

function canonicalQuality(value: FeatureQualityInput): FeatureQualityInput {
  if (!value || typeof value !== 'object') throw invalidSnapshot('quality', 'must be an object');
  return Object.freeze({
    missingFeatureKeys: stringSet(value.missingFeatureKeys, 'quality.missingFeatureKeys'),
    staleFeatureKeys: stringSet(value.staleFeatureKeys, 'quality.staleFeatureKeys'),
    validationErrors: stringSet(value.validationErrors, 'quality.validationErrors'),
  });
}

function stringSet(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw invalidSnapshot(field, 'must be an array');
  const normalized = value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw invalidSnapshot(`${field}[${index}]`, 'must be a non-blank string');
    }
    return item.trim();
  });
  return Object.freeze([...new Set(normalized)].sort());
}

function validInstant(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalidSnapshot('asOf', 'must be a valid Date');
  }
  return value.toISOString();
}

function validSessionDate(value: unknown): string {
  const normalized = matching(value, MARKET_SESSION_DATE, 'marketSessionDate', 'YYYYMMDD');
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrip = [
    parsed.getUTCFullYear().toString().padStart(4, '0'),
    (parsed.getUTCMonth() + 1).toString().padStart(2, '0'),
    parsed.getUTCDate().toString().padStart(2, '0'),
  ].join('');
  if (roundTrip !== normalized) throw invalidSnapshot('marketSessionDate', 'must be a real date');
  return normalized;
}

function matching(value: unknown, pattern: RegExp, field: string, expected: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw invalidSnapshot(field, `must match ${expected}`);
  }
  return value;
}

function invalidSnapshot(field: string, reason: string): FeatureSnapshotDomainError {
  return new FeatureSnapshotDomainError(
    'INVALID_FEATURE_SNAPSHOT',
    `Invalid feature snapshot at ${field}: ${reason}.`,
  );
}

function invalidJson(path: string, reason: string): FeatureSnapshotDomainError {
  return new FeatureSnapshotDomainError(
    'INVALID_FEATURE_JSON',
    `Invalid feature JSON at ${path}: ${reason}.`,
  );
}
