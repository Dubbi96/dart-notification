"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RuleEvaluationError,
  canonicalizeJson,
  evaluateRules,
} = require("../dist");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function createRule(overrides = {}) {
  return {
    ruleKey: "entry.momentum",
    implementationKey: "entry.momentum.v1",
    category: "ENTRY",
    priority: 20,
    enabled: true,
    weight: 2,
    parameterHash: HASH_C,
    parameters: { minimum: 1, nested: { beta: 2, alpha: 1 } },
    requiredFeatures: ["price.close", "volume.ratio"],
    missingFeaturePolicy: "ABSTAIN",
    ...overrides,
  };
}

function createRequest(overrides = {}) {
  return {
    receiptSchemaVersion: "1",
    evaluatorVersion: "0.1.0",
    evaluationKey: "005930:2026-07-31",
    version: {
      strategyVersionId: "strategy-version-1",
      strategyContentHash: HASH_A,
      riskPolicyVersionId: "risk-version-1",
      riskPolicyContentHash: HASH_B,
    },
    snapshot: {
      schemaVersion: "feature-v1",
      contentHash: HASH_D,
      asOf: "2026-07-31T06:00:00.000Z",
      subject: {
        market: "KR_STOCK",
        assetKey: "005930",
      },
      values: {
        "price.close": 71000,
        "volume.ratio": 1.8,
        "portfolio.dailyLossPct": -0.4,
      },
    },
    rules: [createRule()],
    ...overrides,
  };
}

test("입력 object와 rule 배열 순서가 달라도 canonical receipt가 byte-stable하다", () => {
  const calls = [];
  const registry = {
    "entry.momentum.v1": ({ rule }) => {
      calls.push(rule.ruleKey);
      return {
        status: "PASS",
        scoreDelta: 1.25,
        reasonCodes: ["MOMENTUM_OK", "PRICE_OK"],
        facts: {
          zeta: 2,
          alpha: { second: true, first: false },
        },
      };
    },
    "risk.daily-loss.v1": ({ rule }) => {
      calls.push(rule.ruleKey);
      return {
        status: "PASS",
        scoreDelta: 0,
        reasonCodes: ["RISK_OK"],
        facts: { observed: -0.4, limit: -2 },
      };
    },
  };

  const entryRule = createRule({
    requiredFeatures: ["volume.ratio", "price.close"],
  });
  const riskRule = createRule({
    ruleKey: "risk.daily-loss",
    implementationKey: "risk.daily-loss.v1",
    category: "RISK",
    priority: 10,
    weight: 0,
    parameterHash: HASH_B,
    parameters: { limit: -2 },
    requiredFeatures: ["portfolio.dailyLossPct"],
    missingFeaturePolicy: "ABSTAIN",
  });
  const first = evaluateRules(
    createRequest({
      rules: [entryRule, riskRule],
    }),
    registry,
  );
  const second = evaluateRules(
    createRequest({
      snapshot: {
        schemaVersion: "feature-v1",
        contentHash: HASH_D,
        asOf: "2026-07-31T06:00:00.000Z",
        subject: {
          market: "KR_STOCK",
          assetKey: "005930",
        },
        values: {
          "portfolio.dailyLossPct": -0.4,
          "volume.ratio": 1.8,
          "price.close": 71000,
        },
      },
      rules: [
        {
          ...riskRule,
          parameters: { limit: -2 },
        },
        {
          ...entryRule,
          parameters: {
            nested: { alpha: 1, beta: 2 },
            minimum: 1,
          },
          requiredFeatures: ["price.close", "volume.ratio"],
        },
      ],
    }),
    registry,
  );

  assert.equal(first.canonicalReceipt, second.canonicalReceipt);
  assert.deepEqual(
    first.receipt.traces.map((trace) => trace.ruleKey),
    ["risk.daily-loss", "entry.momentum"],
  );
  assert.deepEqual(calls, [
    "risk.daily-loss",
    "entry.momentum",
    "risk.daily-loss",
    "entry.momentum",
  ]);
  assert.equal(first.receipt.score, 2.5);
  assert.equal(first.receipt.status, "COMPLETED");
});

test("같은 priority에서는 ruleKey 영문 오름차순으로 실행한다", () => {
  const calls = [];
  const registry = {
    implementation: ({ rule }) => {
      calls.push(rule.ruleKey);
      return {
        status: "PASS",
        scoreDelta: 0,
        reasonCodes: [],
      };
    },
  };

  evaluateRules(
    createRequest({
      rules: [
        createRule({
          ruleKey: "rule.z",
          implementationKey: "implementation",
          priority: 10,
        }),
        createRule({
          ruleKey: "rule.a",
          implementationKey: "implementation",
          priority: 10,
        }),
      ],
    }),
    registry,
  );

  assert.deepEqual(calls, ["rule.a", "rule.z"]);
});

test("Hard Risk 필수 feature가 없으면 ABSTAIN 설정이어도 실행하지 않고 차단한다", () => {
  let called = false;
  const result = evaluateRules(
    createRequest({
      snapshot: {
        ...createRequest().snapshot,
        values: {
          "price.close": 71000,
        },
      },
      rules: [
        createRule({
          ruleKey: "risk.daily-loss",
          implementationKey: "risk.daily-loss.v1",
          category: "RISK",
          priority: 1,
          requiredFeatures: ["portfolio.dailyLossPct"],
          missingFeaturePolicy: "ABSTAIN",
        }),
      ],
    }),
    {
      "risk.daily-loss.v1": () => {
        called = true;
        return {
          status: "PASS",
          scoreDelta: 0,
          reasonCodes: [],
        };
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.receipt.status, "BLOCKED");
  assert.deepEqual(result.receipt.blockReasonCodes, [
    "HARD_RISK_MISSING_FEATURE:risk.daily-loss",
  ]);
  assert.equal(result.receipt.traces[0].status, "MISSING_FEATURE");
});

test("null feature도 누락으로 취급한다", () => {
  const result = evaluateRules(
    createRequest({
      snapshot: {
        ...createRequest().snapshot,
        values: {
          "portfolio.dailyLossPct": null,
        },
      },
      rules: [
        createRule({
          ruleKey: "risk.daily-loss",
          category: "RISK",
          requiredFeatures: ["portfolio.dailyLossPct"],
        }),
      ],
    }),
    {},
  );

  assert.equal(result.receipt.status, "BLOCKED");
  assert.match(
    result.canonicalReceipt,
    /HARD_RISK_MISSING_FEATURE:risk\.daily-loss/,
  );
});

test("Hard Risk FAIL과 ABSTAIN은 각각 fail-safe 차단한다", () => {
  for (const status of ["FAIL", "ABSTAIN"]) {
    const result = evaluateRules(
      createRequest({
        rules: [
          createRule({
            ruleKey: `risk.${status.toLowerCase()}`,
            implementationKey: `risk.${status.toLowerCase()}.v1`,
            category: "RISK",
            requiredFeatures: ["portfolio.dailyLossPct"],
          }),
        ],
      }),
      {
        [`risk.${status.toLowerCase()}.v1`]: () => ({
          status,
          scoreDelta: 0,
          reasonCodes: [`RISK_${status}`],
        }),
      },
    );

    assert.equal(result.receipt.status, "BLOCKED");
    assert.deepEqual(result.receipt.blockReasonCodes, [
      `HARD_RISK_${status}:risk.${status.toLowerCase()}`,
    ]);
  }
});

test("일반 룰의 feature 누락은 설정된 ABSTAIN 또는 BLOCK 정책을 따른다", () => {
  const abstained = evaluateRules(
    createRequest({
      snapshot: {
        ...createRequest().snapshot,
        values: {},
      },
      rules: [
        createRule({
          requiredFeatures: ["price.close"],
          missingFeaturePolicy: "ABSTAIN",
        }),
      ],
    }),
    {},
  );
  assert.equal(abstained.receipt.status, "COMPLETED");
  assert.equal(abstained.receipt.traces[0].status, "MISSING_FEATURE");

  const blocked = evaluateRules(
    createRequest({
      snapshot: {
        ...createRequest().snapshot,
        values: {},
      },
      rules: [
        createRule({
          requiredFeatures: ["price.close"],
          missingFeaturePolicy: "BLOCK",
        }),
      ],
    }),
    {},
  );
  assert.equal(blocked.receipt.status, "BLOCKED");
  assert.deepEqual(blocked.receipt.blockReasonCodes, [
    "RULE_MISSING_FEATURE_BLOCK:entry.momentum",
  ]);
});

test("disabled 룰은 구현체를 실행하지 않고 trace에 남긴다", () => {
  let called = false;
  const result = evaluateRules(
    createRequest({
      rules: [createRule({ enabled: false })],
    }),
    {
      "entry.momentum.v1": () => {
        called = true;
        return {
          status: "PASS",
          scoreDelta: 100,
          reasonCodes: [],
        };
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.receipt.status, "COMPLETED");
  assert.equal(result.receipt.score, 0);
  assert.equal(result.receipt.traces[0].status, "SKIPPED_DISABLED");
});

test("disabled Hard Risk 룰은 우회로 취급해 차단한다", () => {
  const result = evaluateRules(
    createRequest({
      rules: [
        createRule({
          ruleKey: "risk.disabled",
          category: "RISK",
          enabled: false,
        }),
      ],
    }),
    {},
  );

  assert.equal(result.receipt.status, "BLOCKED");
  assert.deepEqual(result.receipt.blockReasonCodes, [
    "HARD_RISK_DISABLED:risk.disabled",
  ]);
  assert.deepEqual(result.receipt.traces[0].reasonCodes, [
    "HARD_RISK_DISABLED",
  ]);
});

test("구현체 누락은 category와 관계없이 차단한다", () => {
  const result = evaluateRules(createRequest(), {});

  assert.equal(result.receipt.status, "BLOCKED");
  assert.deepEqual(result.receipt.blockReasonCodes, [
    "RULE_IMPLEMENTATION_MISSING:entry.momentum",
  ]);
  assert.equal(result.receipt.traces[0].status, "MISSING_IMPLEMENTATION");
});

test("구현체 예외와 잘못된 결과는 외부 메시지를 노출하지 않고 차단한다", () => {
  const thrown = evaluateRules(createRequest(), {
    "entry.momentum.v1": () => {
      throw new Error("민감한 내부 메시지");
    },
  });
  assert.equal(thrown.receipt.status, "BLOCKED");
  assert.equal(thrown.receipt.traces[0].status, "IMPLEMENTATION_ERROR");
  assert.doesNotMatch(thrown.canonicalReceipt, /민감한 내부 메시지/);

  const invalid = evaluateRules(createRequest(), {
    "entry.momentum.v1": () => ({
      status: "PASS",
      scoreDelta: Number.NaN,
      reasonCodes: [],
    }),
  });
  assert.equal(invalid.receipt.status, "BLOCKED");
  assert.equal(invalid.receipt.traces[0].status, "INVALID_RESULT");
});

test("평가 시작 시 구현체 registry를 snapshot해 실행 중 교체 영향을 차단한다", () => {
  const registry = {
    "entry.mutator.v1": () => {
      registry["risk.stable.v1"] = () => ({
        status: "FAIL",
        scoreDelta: 0,
        reasonCodes: ["MUTATED"],
      });
      return {
        status: "PASS",
        scoreDelta: 0,
        reasonCodes: ["ENTRY_OK"],
      };
    },
    "risk.stable.v1": () => ({
      status: "PASS",
      scoreDelta: 0,
      reasonCodes: ["RISK_OK"],
    }),
  };

  const result = evaluateRules(
    createRequest({
      rules: [
        createRule({
          ruleKey: "entry.mutator",
          implementationKey: "entry.mutator.v1",
          priority: 1,
        }),
        createRule({
          ruleKey: "risk.stable",
          implementationKey: "risk.stable.v1",
          category: "RISK",
          priority: 2,
        }),
      ],
    }),
    registry,
  );

  assert.equal(result.receipt.status, "COMPLETED");
  assert.deepEqual(result.receipt.traces[1].reasonCodes, ["RISK_OK"]);
});

test("score 범위 초과는 Infinity가 되기 전에 fail-safe 차단한다", () => {
  const result = evaluateRules(
    createRequest({
      rules: [
        createRule({
          weight: 1_000_000_000,
        }),
      ],
    }),
    {
      "entry.momentum.v1": () => ({
        status: "PASS",
        scoreDelta: 2,
        reasonCodes: [],
      }),
    },
  );

  assert.equal(result.receipt.status, "BLOCKED");
  assert.equal(result.receipt.traces[0].status, "INVALID_RESULT");
  assert.deepEqual(result.receipt.blockReasonCodes, [
    "SCORE_RANGE_EXCEEDED:entry.momentum",
  ]);
});

test("중복 ruleKey와 잘못된 hash는 평가 전에 명시적 오류로 거부한다", () => {
  assert.throws(
    () =>
      evaluateRules(
        createRequest({
          rules: [createRule(), createRule()],
        }),
        {},
      ),
    (error) =>
      error instanceof RuleEvaluationError &&
      error.code === "DUPLICATE_RULE_KEY",
  );

  assert.throws(
    () =>
      evaluateRules(
        createRequest({
          version: {
            ...createRequest().version,
            strategyContentHash: "ABC",
          },
        }),
        {},
      ),
    (error) =>
      error instanceof RuleEvaluationError && error.code === "INVALID_HASH",
  );
});

test("잘못된 JSON·룰 설정을 평가 전에 거부한다", () => {
  assert.throws(
    () =>
      evaluateRules(
        createRequest({
          snapshot: {
            ...createRequest().snapshot,
            values: {
              invalid: Number.POSITIVE_INFINITY,
            },
          },
        }),
        {},
      ),
    (error) =>
      error instanceof RuleEvaluationError && error.code === "INVALID_REQUEST",
  );

  assert.throws(
    () =>
      evaluateRules(
        createRequest({
          rules: [
            createRule({
              requiredFeatures: ["price.close", "price.close"],
            }),
          ],
        }),
        {},
      ),
    (error) =>
      error instanceof RuleEvaluationError &&
      error.code === "INVALID_RULE_CONFIG",
  );

  assert.throws(
    () =>
      evaluateRules(
        createRequest({
          snapshot: {
            ...createRequest().snapshot,
            asOf: "2026-07-31 15:00:00 KST",
          },
        }),
        {},
      ),
    (error) =>
      error instanceof RuleEvaluationError && error.code === "INVALID_REQUEST",
  );
});

test("canonical JSON은 object key를 정렬하고 비표준 값을 거부한다", () => {
  assert.equal(
    canonicalizeJson({
      z: 1,
      a: { d: 4, c: 3 },
      list: [3, 2, 1],
    }),
    '{"a":{"c":3,"d":4},"list":[3,2,1],"z":1}',
  );
  assert.equal(canonicalizeJson(-0), "0");
  assert.throws(
    () => canonicalizeJson(new Date("2026-07-31T00:00:00.000Z")),
    (error) =>
      error instanceof RuleEvaluationError &&
      error.code === "INVALID_JSON_VALUE",
  );

  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => canonicalizeJson(sparse),
    (error) =>
      error instanceof RuleEvaluationError &&
      error.code === "INVALID_JSON_VALUE",
  );

  const hidden = {};
  Object.defineProperty(hidden, "secret", {
    enumerable: false,
    value: 1,
  });
  assert.throws(
    () => canonicalizeJson(hidden),
    (error) =>
      error instanceof RuleEvaluationError &&
      error.code === "INVALID_JSON_VALUE",
  );
});

test("검증·실행 중 원본 입력을 수정하지 않고 receipt는 deep-frozen snapshot을 사용한다", () => {
  const request = createRequest();
  const result = evaluateRules(request, {
    "entry.momentum.v1": ({ snapshot }) => {
      assert.throws(() => {
        snapshot.values["price.close"] = 1;
      }, TypeError);
      return {
        status: "PASS",
        scoreDelta: 1,
        reasonCodes: [],
      };
    },
  });

  request.snapshot.values["price.close"] = 80000;
  assert.equal(result.receipt.snapshot.values["price.close"], 71000);
  assert.equal(result.receipt.score, 2);
});

test("__proto__ feature key를 prototype 오염 없이 보존한다", () => {
  const values = JSON.parse(
    '{"__proto__":{"polluted":true},"price.close":71000,"volume.ratio":1.8}',
  );
  const result = evaluateRules(
    createRequest({
      snapshot: {
        ...createRequest().snapshot,
        values,
      },
    }),
    {
      "entry.momentum.v1": ({ snapshot }) => {
        assert.equal(snapshot.values.__proto__.polluted, true);
        assert.equal({}.polluted, undefined);
        return {
          status: "PASS",
          scoreDelta: 0,
          reasonCodes: [],
        };
      },
    },
  );

  assert.equal(result.receipt.status, "COMPLETED");
  assert.equal({}.polluted, undefined);
});
