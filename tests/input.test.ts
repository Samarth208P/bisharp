import { test } from "node:test";
import assert from "node:assert/strict";
import { orderInput } from "../src/lib/order-input.ts";
import { parseRoutes } from "../src/lib/routes.ts";
const wallet = "0x0000000000000000000000000000000000000001";
const input = { owner: wallet as `0x${string}`, recipient: "", solver: "", principal: "5", amountIn: "4.9", minOutput: "0.0015", maxPrice: "2500", hours: 24, now: 1_000_000_000 };
test("order amounts preserve 6/18 decimal units and exact recipients", () => {
  const terms = orderInput(input);
  assert.equal(terms.principal, 5_000_000n); assert.equal(terms.amountIn, 4_900_000n);
  assert.equal(terms.minOutput, 1_500_000_000_000_000n); assert.equal(terms.maxPrice, 2500n * 10n ** 18n);
  assert.equal(terms.owner, terms.recipient); assert.equal(terms.owner, terms.solver);
});
test("reject rounding, negatives, scientific notation, zero and overflow", () => {
  for (const principal of ["1.0000001", "-1", "1e6", "0", "NaN", " ", (1n << 128n).toString()]) assert.throws(() => orderInput({ ...input, principal }));
  assert.throws(() => orderInput({ ...input, minOutput: "0.0000000000000000001" }));
  assert.throws(() => orderInput({ ...input, solver: "0x0000000000000000000000000000000000000000" }));
  assert.throws(() => orderInput({ ...input, hours: 0 }));
});
const route = { id: "eth-op", sourceChainId: 11155111, destinationChainId: 11155420, escrow: wallet, executor: "0x0000000000000000000000000000000000000002" };
test("multi-chain routes bind EVM chain IDs to independent CCIP selectors", () => {
  const list = parseRoutes(JSON.stringify([route, { ...route, id: "base-arb", sourceChainId: 84532, destinationChainId: 421614 }]));
  assert.equal(list.length, 2); assert.equal(list[0].source.selector, 16015286601757825753n);
  assert.equal(list[0].destination.selector, 5224473277236331295n);
  assert.equal(list[1].source.chain.id, 84532); assert.equal(list[1].destination.chain.id, 421614);
});
test("reject duplicate routes, same-chain routes, mainnets and invalid addresses", () => {
  for (const value of [[route, route], [{ ...route, destinationChainId: 11155111 }], [{ ...route, sourceChainId: 1 }], [{ ...route, escrow: "0x0" }], [{ ...route, solver: "wrong" }]]) assert.throws(() => parseRoutes(JSON.stringify(value)));
  assert.throws(() => parseRoutes("bad json")); assert.throws(() => parseRoutes("{}"));
});
