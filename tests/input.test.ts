import { test } from "node:test";
import assert from "node:assert/strict";
import { orderInput } from "../src/lib/order-input.ts";
import { parseRoutes } from "../src/lib/routes.ts";
import { POST } from "../src/app/api/local/fund/route.ts";
import {
  inspectPairing,
  isFreshSnapshot,
  canUseRouteSide,
} from "../src/lib/route-health.ts";
const wallet = "0x0000000000000000000000000000000000000001";
const zero = "0x0000000000000000000000000000000000000000";
const pairing = {
  peer: wallet as `0x${string}`,
  expectedPeer: wallet as `0x${string}`,
  authority: zero as `0x${string}`,
  local: 1n,
  remote: 2n,
  expectedLocal: 1n,
  expectedRemote: 2n,
};

test("unpaired deployments are pending only when selectors and activation authority are valid", () => {
  assert.equal(
    inspectPairing({ ...pairing, peer: zero, authority: wallet }),
    "pending",
  );
  assert.throws(
    () => inspectPairing({ ...pairing, peer: zero }),
    /no paired counterpart/,
  );
  assert.throws(
    () =>
      inspectPairing({ ...pairing, peer: zero, authority: wallet, remote: 9n }),
    /network configuration/,
  );
});

test("wrong counterpart, reversed selectors, and unfinished pairing never become ready", () => {
  assert.throws(
    () =>
      inspectPairing({
        ...pairing,
        peer: "0x0000000000000000000000000000000000000002",
      }),
    /different counterpart/,
  );
  assert.throws(
    () => inspectPairing({ ...pairing, local: 2n, remote: 1n }),
    /network configuration/,
  );
  assert.throws(
    () => inspectPairing({ ...pairing, authority: wallet }),
    /not been finalized/,
  );
  assert.equal(inspectPairing(pairing), "ready");
});

test("readable pending routes cannot authorize transactions", () => {
  const pending = { pairing: "pending" as const, at: 1000 };
  assert.equal(isFreshSnapshot(pending, "", 2000), true);
  assert.equal(canUseRouteSide(pending, "", 2000), false);
});

test("stale, missing, future, and failed route snapshots cannot authorize transactions", () => {
  const ready = { pairing: "ready" as const, at: 1000 };
  assert.equal(canUseRouteSide(ready, "", 45_999), true);
  assert.equal(canUseRouteSide(ready, "", 46_000), false);
  assert.equal(canUseRouteSide(ready, "", 999), false);
  assert.equal(canUseRouteSide(ready, "RPC unavailable", 2000), false);
  assert.equal(canUseRouteSide(undefined, "", 2000), false);
});

test("a destination outage does not disable a verified source recovery", () => {
  const ready = { pairing: "ready" as const, at: 1000 };
  const sourceReady = canUseRouteSide(ready, "", 2000);
  const destinationReady = canUseRouteSide(ready, "RPC unavailable", 2000);
  assert.equal(sourceReady, true);
  assert.equal(destinationReady, false);
  assert.equal(sourceReady && destinationReady, false);
});
const input = {
  owner: wallet as `0x${string}`,
  recipient: "",
  solver: "",
  principal: "5",
  amountIn: "4.9",
  minOutput: "0.0015",
  maxPrice: "2500",
  hours: 24,
  now: 1_000_000_000,
};
test("order amounts preserve 6/18 decimal units and exact recipients", () => {
  const terms = orderInput(input);
  assert.equal(terms.principal, 5_000_000n);
  assert.equal(terms.amountIn, 4_900_000n);
  assert.equal(terms.minOutput, 1_500_000_000_000_000n);
  assert.equal(terms.maxPrice, 2500n * 10n ** 18n);
  assert.equal(terms.owner, terms.recipient);
  assert.equal(terms.owner, terms.solver);
});
test("reject rounding, negatives, scientific notation, zero and overflow", () => {
  for (const principal of [
    "1.0000001",
    "-1",
    "1e6",
    "0",
    "NaN",
    " ",
    (1n << 128n).toString(),
  ])
    assert.throws(() => orderInput({ ...input, principal }));
  assert.throws(() =>
    orderInput({ ...input, minOutput: "0.0000000000000000001" }),
  );
  assert.throws(() =>
    orderInput({
      ...input,
      solver: "0x0000000000000000000000000000000000000000",
    }),
  );
  assert.throws(() => orderInput({ ...input, hours: 0 }));
});
test("reject invalid order clocks and a zero owner", () => {
  for (const now of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => orderInput({ ...input, now }));
  assert.throws(() =>
    orderInput({
      ...input,
      owner: "0x0000000000000000000000000000000000000000",
    }),
  );
});
const route = {
  id: "eth-op",
  sourceChainId: 11155111,
  destinationChainId: 11155420,
  escrow: wallet,
  executor: "0x0000000000000000000000000000000000000002",
};
test("multi-chain routes bind EVM chain IDs to independent CCIP selectors", () => {
  const list = parseRoutes(
    JSON.stringify([
      route,
      {
        ...route,
        id: "base-arb",
        sourceChainId: 84532,
        destinationChainId: 421614,
      },
    ]),
  );
  assert.equal(list.length, 2);
  assert.equal(list[0].source.selector, 16015286601757825753n);
  assert.equal(list[0].destination.selector, 5224473277236331295n);
  assert.equal(list[1].source.chain.id, 84532);
  assert.equal(list[1].destination.chain.id, 421614);
});
test("reject duplicate routes, same-chain routes, mainnets and invalid addresses", () => {
  for (const value of [
    [route, route],
    [{ ...route, destinationChainId: 11155111 }],
    [{ ...route, sourceChainId: 1 }],
    [{ ...route, escrow: "0x0" }],
    [{ ...route, solver: "wrong" }],
  ])
    assert.throws(() => parseRoutes(JSON.stringify(value)));
  assert.throws(() => parseRoutes("bad json"));
  assert.throws(() => parseRoutes("{}"));
  assert.throws(() =>
    parseRoutes(JSON.stringify([{ ...route, sourceChainId: "11155111" }])),
  );
  process.env.NEXT_PUBLIC_ENABLE_LOCAL = "true";
  assert.throws(() =>
    parseRoutes(JSON.stringify([{ ...route, sourceChainId: 31337 }])),
  );
  assert.equal(
    parseRoutes(
      JSON.stringify([
        { ...route, sourceChainId: 31337, destinationChainId: 31338 },
      ]),
    )[0].source.selector,
    1n,
  );
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
});

test("local gas faucet is disabled without explicit fixture mode", async () => {
  const previous = process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  try {
    const response = await POST(
      new Request("http://localhost/api/local/fund", {
        method: "POST",
        body: JSON.stringify({ address: wallet, chainId: 31337 }),
      }),
    );
    assert.equal(response.status, 404);
  } finally {
    if (previous !== undefined) process.env.NEXT_PUBLIC_ENABLE_LOCAL = previous;
  }
});

test("local gas faucet cannot target a public network", async () => {
  const previous = process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  process.env.NEXT_PUBLIC_ENABLE_LOCAL = "true";
  try {
    for (const chainId of [1, 11155111, 11155420, 421614, 84532]) {
      const response = await POST(
        new Request("http://localhost/api/local/fund", {
          method: "POST",
          body: JSON.stringify({ address: wallet, chainId }),
        }),
      );
      assert.equal(response.status, 400);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
    else process.env.NEXT_PUBLIC_ENABLE_LOCAL = previous;
  }
});

test("Netlify refuses the local faucet even if fixture mode is enabled", async () => {
  const previousLocal = process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  const previousNetlify = process.env.NETLIFY;
  process.env.NEXT_PUBLIC_ENABLE_LOCAL = "true";
  process.env.NETLIFY = "true";
  try {
    const response = await POST(
      new Request("http://localhost/api/local/fund", {
        method: "POST",
        body: JSON.stringify({ address: wallet, chainId: 31337 }),
      }),
    );
    assert.equal(response.status, 404);
  } finally {
    if (previousLocal === undefined)
      delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
    else process.env.NEXT_PUBLIC_ENABLE_LOCAL = previousLocal;
    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
  }
});

test("local gas faucet rejects malformed payloads before contacting RPC", async () => {
  const previous = process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  process.env.NEXT_PUBLIC_ENABLE_LOCAL = "true";
  try {
    for (const body of [
      "{",
      "null",
      "{}",
      JSON.stringify({ address: "wrong", chainId: 31337 }),
      JSON.stringify({ address: wallet, chainId: "31337" }),
    ]) {
      const response = await POST(
        new Request("http://localhost/api/local/fund", {
          method: "POST",
          body,
        }),
      );
      assert.equal(response.status, 400);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
    else process.env.NEXT_PUBLIC_ENABLE_LOCAL = previous;
  }
});
