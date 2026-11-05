import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hash } from "viem";
import {
  mergeTransactionHistory,
  parseTransactionHistory,
  receiptTransaction,
  type TrackedTransaction,
} from "../src/lib/transaction-history.ts";

const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const tx = (id = 1): TrackedTransaction => ({
  hash: hash(id),
  chainId: 31337,
  label: "Create order",
  state: "pending",
  messages: [],
});
const chains = [31337, 31338];

test("history restoration accepts JSON round trips and rejects non-array roots", () => {
  const history = [{ ...tx(), messages: [hash(100)] }];
  assert.deepEqual(
    parseTransactionHistory(JSON.parse(JSON.stringify(history)), chains),
    history,
  );
  for (const value of [undefined, null, true, 1, "[]", {}, { length: 1 }]) {
    assert.deepEqual(parseTransactionHistory(value, chains), []);
  }
});

test("corrupt entries and other routes' chains cannot enter restored history", () => {
  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...tx(), hash: "0x123" },
    { ...tx(), hash: `0x${"g".repeat(64)}` },
    { ...tx(), chainId: 1 },
    { ...tx(), chainId: "31337" },
    { ...tx(), chainId: 31337.5 },
    { ...tx(), chainId: -1 },
    { ...tx(), chainId: NaN },
    { ...tx(), chainId: Number.MAX_SAFE_INTEGER + 1 },
    { ...tx(), label: "   " },
    { ...tx(), label: "x".repeat(161) },
    { ...tx(), label: 1 },
    { ...tx(), state: "complete" },
    { ...tx(), messages: undefined },
    { ...tx(), messages: null },
    { ...tx(), messages: "0x123" },
    { ...tx(), messages: [hash(100), null] },
    { ...tx(), messages: [hash(100), "0x123"] },
  ];
  const good = { ...tx(2), chainId: 31338 };
  assert.deepEqual(parseTransactionHistory([...invalid, good], chains), [good]);
});

test("restoration bounds history and messages and removes case-insensitive duplicates", () => {
  const mixedCase: Hash = `0x${"aB".repeat(32)}`;
  const messages = [mixedCase, mixedCase.toLowerCase() as Hash];
  for (let i = 100; i < 120; i++) messages.push(hash(i));
  const history = [
    { ...tx(), hash: mixedCase, label: " Create order ", messages },
    { ...tx(), hash: mixedCase.toLowerCase() as Hash },
    { ...tx(), hash: mixedCase, chainId: 31338 },
    ...Array.from({ length: 20 }, (_, i) => tx(i + 2)),
  ];
  const restored = parseTransactionHistory(history, chains);
  assert.equal(restored.length, 12);
  assert.equal(restored[0].messages.length, 12);
  assert.equal(restored[0].messages[0], mixedCase);
  assert.equal(restored[0].label, "Create order");
  assert.equal(restored[1].chainId, 31338);
  assert.equal(messages.length, 22);
});

test("a receipt updates its existing entry and retains known cross-chain message IDs", () => {
  const previous: TrackedTransaction[] = [
    tx(2),
    { ...tx(1), messages: [hash(100)] },
  ];
  const original = JSON.stringify(previous);
  const update: TrackedTransaction = {
    ...tx(1),
    state: "confirmed",
    messages: [hash(101), hash(100)],
  };
  const merged = mergeTransactionHistory(previous, update);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], {
    ...update,
    messages: [hash(101), hash(100)],
  });
  assert.equal(merged[1].hash, hash(2));
  assert.equal(JSON.stringify(previous), original);
  merged[0].messages.push(hash(102));
  assert.equal(update.messages.length, 2);
});

test("merge uses chain and hash identity and caps long or duplicated prior history", () => {
  const mixedCase: Hash = `0x${"aB".repeat(32)}`;
  const previous: TrackedTransaction[] = [
    { ...tx(), hash: mixedCase.toLowerCase() as Hash },
    { ...tx(), hash: mixedCase, chainId: 31338 },
    tx(2),
    tx(2),
    ...Array.from({ length: 20 }, (_, i) => tx(i + 3)),
  ];
  const result = mergeTransactionHistory(previous, {
    ...tx(),
    hash: mixedCase,
    state: "failed",
  });
  assert.equal(result.length, 12);
  assert.equal(result[0].state, "failed");
  assert.equal(result[1].chainId, 31338);
  assert.equal(result.filter((item) => item.hash === hash(2)).length, 1);
  assert.deepEqual(mergeTransactionHistory([], tx()), [tx()]);
});

test("an ordinary successful receipt confirms the action and preserves message IDs", () => {
  const original = { ...tx(), messages: [hash(100)] };
  const result = receiptTransaction(original, {
    transactionHash: original.hash,
    status: "success",
  });
  assert.equal(result.actionSucceeded, true);
  assert.deepEqual(result.transaction, { ...original, state: "confirmed" });
  result.transaction.messages.push(hash(101));
  assert.deepEqual(original.messages, [hash(100)]);
  assert.equal(original.state, "pending");
});

test("repricing confirms the same action under the replacement receipt's identity", () => {
  const original = tx();
  const result = receiptTransaction(
    original,
    { transactionHash: hash(2), status: "success" },
    "repriced",
  );
  assert.equal(result.actionSucceeded, true);
  assert.deepEqual(result.transaction, {
    ...original,
    hash: hash(2),
    state: "confirmed",
  });
});

test("a mined wallet cancellation is recorded without reporting the action successful", () => {
  const result = receiptTransaction(
    tx(),
    { transactionHash: hash(2), status: "success" },
    "cancelled",
  );
  assert.equal(result.actionSucceeded, false);
  assert.equal(result.transaction.hash, hash(2));
  assert.equal(result.transaction.state, "confirmed");
  assert.equal(result.transaction.label, "Wallet cancellation");
});

test("a replacement with changed calldata cannot confirm the original action", () => {
  const result = receiptTransaction(
    tx(),
    { transactionHash: hash(3), status: "success" },
    "replaced",
  );
  assert.equal(result.actionSucceeded, false);
  assert.equal(result.transaction.hash, hash(3));
  assert.equal(result.transaction.state, "confirmed");
  assert.equal(
    result.transaction.label,
    "Replacement transaction · inspect details",
  );
});

test("reverted receipts always fail the action and use the actual mined hash", () => {
  for (const reason of [
    undefined,
    "repriced",
    "cancelled",
    "replaced",
  ] as const) {
    const result = receiptTransaction(
      tx(),
      { transactionHash: hash(4), status: "reverted" },
      reason,
    );
    assert.equal(result.actionSucceeded, false);
    assert.equal(result.transaction.state, "failed");
    assert.equal(result.transaction.hash, hash(4));
    assert.equal(result.transaction.chainId, 31337);
  }
});
