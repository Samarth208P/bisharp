import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrderDraft, ordersCsv } from "../src/lib/order-draft.ts";

const draft = {
  principal: "5",
  amountIn: "4.9",
  minOutput: "0.002",
  maxPrice: "2000",
  hours: 24,
  recipient: "",
  solver: "",
};
test("draft restore preserves exact decimals and rejects corrupt browser data", () => {
  assert.deepEqual(parseOrderDraft(draft), draft);
  for (const bad of [
    null,
    [],
    {},
    { ...draft, hours: 0 },
    { ...draft, principal: "1e5" },
    { ...draft, principal: (1n << 128n).toString() },
    { ...draft, amountIn: "0" },
    { ...draft, minOutput: "0.0000000000000000001" },
    { ...draft, recipient: "javascript:x" },
    { ...draft, solver: "0x0000000000000000000000000000000000000000" },
    { ...draft, solver: 42 },
  ])
    assert.equal(parseOrderDraft(bad), null);
});
test("CSV exports exact monetary units and distinguishes missing remote state", () => {
  const csv = ordersCsv(
    [
      {
        id: 1n,
        source: {
          terms: {
            owner: "0x1",
            recipient: "0x2",
            solver: "0x3",
            principal: 5000000n,
            amountIn: 4900000n,
            minOutput: 1n,
            maxPrice: 2000n * 10n ** 18n,
            deadline: 100n,
          },
          state: 3,
          claimed: false,
        },
        destination: null,
      },
    ],
    "=unsafe",
  );
  assert.match(csv, /"'=unsafe"/);
  assert.match(csv, /"5.000000","4.900000","0.000000000000000001"/);
  assert.match(csv, /"Filled","Unavailable","No"/);
});
