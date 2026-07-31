import {
  RuleEvaluationError,
  type JsonValue,
  type RuleEvaluationErrorCode,
} from "./types";

function invalidJson(message: string): never {
  throw new RuleEvaluationError("INVALID_JSON_VALUE", message);
}

function quoteString(value: string): string {
  const quoted = JSON.stringify(value);
  return quoted.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function serialize(
  value: unknown,
  ancestors: ReadonlySet<object>,
  path: string,
): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return quoteString(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalidJson(`${path}: 유한하지 않은 숫자는 허용되지 않습니다.`);
    }
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (typeof value !== "object") {
    return invalidJson(`${path}: JSON 값이 아닌 타입입니다.`);
  }

  if (ancestors.has(value)) {
    return invalidJson(`${path}: 순환 참조는 허용되지 않습니다.`);
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        return invalidJson(
          `${path}[${index}]: sparse array는 허용되지 않습니다.`,
        );
      }
      items.push(serialize(value[index], nextAncestors, `${path}[${index}]`));
    }
    return `[${items.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidJson(`${path}: plain object만 허용됩니다.`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return invalidJson(`${path}: symbol key는 허용되지 않습니다.`);
  }

  const ownPropertyNames = Object.getOwnPropertyNames(value);
  const enumerableKeys = Object.keys(value);
  if (ownPropertyNames.length !== enumerableKeys.length) {
    return invalidJson(`${path}: non-enumerable key는 허용되지 않습니다.`);
  }

  const entries: string[] = [];
  for (const key of enumerableKeys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return invalidJson(`${path}.${key}: accessor는 허용되지 않습니다.`);
    }
    entries.push(
      `${quoteString(key)}:${serialize(descriptor.value, nextAncestors, `${path}.${key}`)}`,
    );
  }
  return `{${entries.join(",")}}`;
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value, new Set<object>(), "$");
}

export function assertJsonValue(
  value: unknown,
  errorCode: RuleEvaluationErrorCode = "INVALID_JSON_VALUE",
  label = "value",
): asserts value is JsonValue {
  try {
    serialize(value, new Set<object>(), label);
  } catch (error) {
    if (
      error instanceof RuleEvaluationError &&
      error.code === "INVALID_JSON_VALUE" &&
      errorCode !== "INVALID_JSON_VALUE"
    ) {
      throw new RuleEvaluationError(errorCode, error.message);
    }
    throw error;
  }
}
