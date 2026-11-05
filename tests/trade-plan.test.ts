import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTradePlan,
  estimateMinimumOutput,
  formatDecimal,
} from "../src/lib/trade-plan.ts";

const price = 2_000n * 10n ** 18n;
const input = {
  principal: "100",
  amountIn: "98",
  minOutput: "0.048",
  oraclePrice: price,
  feeBudgetUsd: "1.25",
  slippageBps: 100,
};

test("costs and minimum-value scenarios preserve token decimals without floating point", () => {
  const plan = calculateTradePlan(input);
  assert.equal(plan.principal, 100_000_000n);
  assert.equal(plan.amountIn, 98_000_000n);
  assert.equal(plan.minOutput, 48_000_000_000_000_000n);
  assert.equal(plan.feeBudgetUsd, 1_250_000n);
  assert.equal(plan.totalCostUsd, 101_250_000n);
  assert.equal(plan.solverSpreadUsd, 2_000_000n);
  assert.equal(plan.solverSpreadBps, 200n);
  assert.equal(plan.referenceOutput, 49_000_000_000_000_000n);
  assert.equal(plan.suggestedMinimumOutput, 48_510_000_000_000_000n);
  assert.equal(plan.minimumValueUsd, 96_000_000n);
  assert.equal(plan.minimumValueDeltaUsd, -4_000_000n);
  assert.equal(plan.minimumValueDeltaAfterFeesUsd, -5_250_000n);
  assert.equal(plan.feeShareBps, 125n);
  assert.equal(plan.effectiveMaxPrice, 2_083_333_333_333_333_333_334n);
  assert.equal(plan.solverMaxPrice, 2_041_666_666_666_666_666_667n);
  assert.equal(plan.breakevenPrice, 2_109_375_000_000_000_000_000n);
  assert.deepEqual(
    plan.warnings.map((warning) => warning.code),
    ["minimum-below-principal"],
  );
});

test("an unknown fee budget never becomes a zero-cost or breakeven claim", () => {
  for (const feeBudgetUsd of [undefined, ""]) {
    const plan = calculateTradePlan({ ...input, feeBudgetUsd });
    assert.equal(plan.feeBudgetUsd, null);
    assert.equal(plan.totalCostUsd, null);
    assert.equal(plan.breakevenPrice, null);
    assert.equal(plan.minimumValueDeltaAfterFeesUsd, null);
    assert.equal(plan.feeShareBps, null);
    assert.ok(plan.warnings.some((warning) => warning.code === "fees-missing"));
  }
  const explicitZero = calculateTradePlan({ ...input, feeBudgetUsd: "0" });
  assert.equal(explicitZero.feeBudgetUsd, 0n);
  assert.equal(explicitZero.totalCostUsd, explicitZero.principal);
  assert.equal(explicitZero.breakevenPrice, explicitZero.effectiveMaxPrice);
});

test("an unavailable oracle keeps exact costs but never invents a valuation", () => {
  const plan = calculateTradePlan({ ...input, oraclePrice: null });
  assert.equal(plan.totalCostUsd, 101_250_000n);
  assert.equal(plan.referenceOutput, null);
  assert.equal(plan.suggestedMinimumOutput, null);
  assert.equal(plan.minimumValueUsd, null);
  assert.equal(plan.minimumValueDeltaUsd, null);
  assert.equal(plan.minimumValueDeltaAfterFeesUsd, null);
  assert.ok(
    plan.warnings.some((warning) => warning.code === "reference-unavailable"),
  );
});

test("solver subsidy and fee-dominated trades are exposed as signed costs", () => {
  const plan = calculateTradePlan({
    ...input,
    amountIn: "110",
    feeBudgetUsd: "100",
  });
  assert.equal(plan.solverSpreadUsd, -10_000_000n);
  assert.equal(plan.solverSpreadBps, -1_000n);
  assert.equal(plan.totalCostUsd, 200_000_000n);
  assert.ok(plan.warnings.some((warning) => warning.code === "solver-subsidy"));
  assert.ok(
    plan.warnings.some((warning) => warning.code === "fees-exceed-principal"),
  );
});

test("a higher minimum is an execution constraint, not an invented saving", () => {
  const plan = calculateTradePlan({ ...input, minOutput: "0.06" });
  assert.equal(plan.minimumValueUsd, 120_000_000n);
  assert.equal(plan.minimumValueDeltaUsd, 20_000_000n);
  assert.ok(
    plan.warnings.some((warning) => warning.code === "minimum-above-reference"),
  );
  assert.ok(
    !plan.warnings.some(
      (warning) => warning.code === "minimum-below-principal",
    ),
  );
});

test("fees can turn a principal-covering floor into a total-cost shortfall", () => {
  const plan = calculateTradePlan({
    ...input,
    minOutput: "0.051",
    feeBudgetUsd: "3",
  });
  assert.equal(plan.minimumValueDeltaUsd, 2_000_000n);
  assert.equal(plan.minimumValueDeltaAfterFeesUsd, -1_000_000n);
  assert.ok(
    plan.warnings.some(
      (warning) => warning.code === "minimum-below-total-cost",
    ),
  );
});

test("reference output suggestions apply an explicit haircut and remain exact strings", () => {
  assert.equal(estimateMinimumOutput("98", price, 100), "0.04851");
  assert.equal(estimateMinimumOutput("98", price, 0), "0.049");
  assert.equal(estimateMinimumOutput("98", price, 9_999), "0.0000049");
  const exact = estimateMinimumOutput("0.000001", 3n * 10n ** 18n, 100);
  assert.equal(exact, "0.000000329999999999");
  assert.throws(
    () => estimateMinimumOutput("0.000001", (1n << 256n) - 1n, 100),
    /outside the supported output range/,
  );
});

test("derived valuations round down while cost-covering prices round up", () => {
  const plan = calculateTradePlan({
    principal: "0.000001",
    amountIn: "0.000001",
    minOutput: "0.000000000000000003",
    oraclePrice: 1n,
    feeBudgetUsd: "0.000001",
    slippageBps: 0,
  });
  assert.equal(
    plan.effectiveMaxPrice,
    333_333_333_333_333_333_333_333_333_334n,
  );
  assert.equal(plan.breakevenPrice, 666_666_666_666_666_666_666_666_666_667n);
  assert.equal(plan.minimumValueUsd, 0n);
  const breakEven = plan.breakevenPrice!;
  assert.ok((3n * breakEven) / 10n ** 30n >= 2n);
  assert.ok((3n * (breakEven - 1n)) / 10n ** 30n < 2n);
});

test("reject malformed, negative, rounded and out-of-contract amounts", () => {
  for (const field of ["principal", "amountIn", "minOutput"] as const) {
    for (const value of [
      "0",
      "-1",
      "+1",
      " 1",
      "1 ",
      "1e6",
      "NaN",
      "Infinity",
      ".1",
      "1.",
      "1,000",
      "",
      (1n << 128n).toString(),
      "0".repeat(81),
    ]) {
      assert.throws(() => calculateTradePlan({ ...input, [field]: value }));
    }
  }
  assert.throws(() => calculateTradePlan({ ...input, principal: "1.0000001" }));
  assert.throws(() => calculateTradePlan({ ...input, amountIn: "1.0000001" }));
  assert.throws(() =>
    calculateTradePlan({ ...input, minOutput: "0.0000000000000000001" }),
  );
  for (const feeBudgetUsd of ["-1", " ", "1e2", "1.0000001"]) {
    assert.throws(() => calculateTradePlan({ ...input, feeBudgetUsd }));
  }
});

test("uint128 boundaries remain exact and out-of-range suggestions cannot be applied", () => {
  const max = (1n << 128n) - 1n;
  const plan = calculateTradePlan({
    principal: formatDecimal(max, 6),
    amountIn: formatDecimal(max, 6),
    minOutput: formatDecimal(max, 18),
    oraclePrice: 1n,
    feeBudgetUsd: formatDecimal(max, 6),
    slippageBps: 0,
  });
  assert.equal(plan.principal, max);
  assert.equal(plan.amountIn, max);
  assert.equal(plan.minOutput, max);
  assert.equal(plan.totalCostUsd, max * 2n);
  assert.equal(plan.suggestedMinimumOutput, null);
  assert.throws(
    () => estimateMinimumOutput(formatDecimal(max, 6), 1n, 0),
    /outside the supported output range/,
  );
});

test("invalid oracle values and haircut settings fail instead of producing a plan", () => {
  for (const oraclePrice of [0n, -1n, 1n << 256n]) {
    assert.throws(() => calculateTradePlan({ ...input, oraclePrice }));
    assert.throws(() => estimateMinimumOutput("1", oraclePrice, 100));
  }
  for (const slippageBps of [-1, 0.5, 10_000, NaN, Infinity]) {
    assert.throws(() => calculateTradePlan({ ...input, slippageBps }));
    assert.throws(() => estimateMinimumOutput("1", price, slippageBps));
  }
});

test("format exact signed values without losing large numbers or tiny units", () => {
  assert.equal(formatDecimal(0n, 18), "0");
  assert.equal(formatDecimal(1n, 18), "0.000000000000000001");
  assert.equal(formatDecimal(-1n, 6), "-0.000001");
  assert.equal(formatDecimal(-1_200_000n, 6), "-1.2");
  assert.equal(formatDecimal(42n, 0), "42");
  assert.equal(
    formatDecimal(340_282_366_920_938_463_463_374_607_431_768_211_455n, 6),
    "340282366920938463463374607431768.211455",
  );
  for (const decimals of [-1, 0.5, 37, NaN, Infinity]) {
    assert.throws(() => formatDecimal(1n, decimals));
  }
});
