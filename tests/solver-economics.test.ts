import { test } from "node:test";
import assert from "node:assert/strict";
import {
  solverEconomics,
  formatScenarioDollars,
} from "../src/lib/solver-economics.ts";

test("solver illustration distinguishes positive, zero, and negative margins", () => {
  assert.equal(solverEconomics("100", "98", "1").net, 100n);
  assert.equal(solverEconomics("100", "98", "2").net, 0n);
  assert.equal(solverEconomics("100", "98", "3").net, -100n);
});

test("scenario arithmetic uses exact cents and accepts explicit zero fees", () => {
  const result = solverEconomics("100.10", "99.99", "0.01");
  assert.equal(result.totalCost, 10000n);
  assert.equal(result.net, 10n);
  assert.equal(solverEconomics("100", "98", "0").net, 200n);
  assert.equal(formatScenarioDollars(-10n), "−$0.10");
});

test("invalid illustrative amounts never produce a misleading margin", () => {
  for (const invalid of [
    "",
    "-1",
    "1e3",
    "Infinity",
    "0.001",
    "1,000",
    "10000000",
    " ",
  ]) {
    assert.throws(() => solverEconomics(invalid, "98", "1"));
    assert.throws(() => solverEconomics("100", invalid, "1"));
    assert.throws(() => solverEconomics("100", "98", invalid));
  }
  assert.throws(() => solverEconomics("0", "98", "1"));
  assert.throws(() => solverEconomics("100", "0", "1"));
});
