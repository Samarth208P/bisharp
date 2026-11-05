import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOrderInsight,
  summarizeOrders,
  type OrderStatusRow,
} from "../src/lib/order-status.ts";

const owner = "0x00000000000000000000000000000000000000aA";
const solver = "0x00000000000000000000000000000000000000bB";
const recipient = "0x00000000000000000000000000000000000000cC";
const now = 1_000_000;
const terms = {
  owner,
  solver,
  recipient,
  principal: 5_000_000n,
  amountIn: 4_900_000n,
  minOutput: 1_500_000_000_000_000n,
  maxPrice: 2500n * 10n ** 18n,
  deadline: 2000n,
} as const;

function row(
  sourceState = 1,
  destinationState: number | null = 1,
  claimed = false,
): OrderStatusRow {
  return {
    id: 1n,
    source: { terms, state: sourceState, claimed },
    destination:
      destinationState === null
        ? null
        : { terms, state: destinationState, claimed: false },
  };
}

test("only terminal source state makes principal claimable, including during destination outage", () => {
  const payment = getOrderInsight(row(3, null), now, solver);
  assert.equal(payment.category, "claim");
  assert.equal(payment.needsAction, true);
  assert.equal(payment.beneficiary, solver);
  const refund = getOrderInsight(row(4, null), now, owner);
  assert.equal(refund.category, "claim");
  assert.equal(refund.beneficiary, owner);
  assert.equal(getOrderInsight(row(1, 3), now).category, "receipt");
  assert.equal(getOrderInsight(row(2, 4), now).category, "receipt");
});

test("a completed claim takes precedence over obsolete destination observations", () => {
  const insight = getOrderInsight(row(3, 1, true), now);
  assert.equal(insight.category, "complete");
  assert.equal(insight.needsAction, false);
  assert.equal(insight.beneficiary, solver);
  assert.equal(getOrderInsight(row(4, null, true), now).beneficiary, owner);
});

test("a destination fill can win cancellation and still needs a filled receipt", () => {
  const insight = getOrderInsight(row(2, 3), now);
  assert.equal(insight.category, "receipt");
  assert.match(insight.title, /settlement/);
  assert.match(insight.detail, /solver payment/);
  assert.doesNotMatch(insight.detail, /refund/);
});

test("expiry boundary closes the destination before a refund is possible", () => {
  assert.equal(getOrderInsight(row(), 1_999_999).category, "waiting");
  const expired = getOrderInsight(row(), 2_000_000);
  assert.equal(expired.category, "expiry");
  assert.equal(expired.needsAction, true);
  assert.match(expired.title, /Close expired destination/);
  assert.equal(getOrderInsight(row(2), 2_000_000).category, "expiry");
  assert.equal(getOrderInsight(row(1, 0), 2_000_000).category, "expiry");
  assert.equal(getOrderInsight(row(1, null), 2_000_000).category, "waiting");
  assert.equal(getOrderInsight(row(1, 4), 2_000_000).category, "receipt");
});

test("unavailable destination and not-yet-registered destination have distinct explanations", () => {
  assert.match(getOrderInsight(row(1, null), now).title, /unavailable/);
  assert.match(getOrderInsight(row(1, 0), now).title, /Registration/);
  assert.match(getOrderInsight(row(2, 0), now).title, /Cancellation/);
  assert.match(
    getOrderInsight(row(2, null), now).detail,
    /closure is unverified/,
  );
});

test("solver hints describe a required check without asserting fill eligibility", () => {
  const own = getOrderInsight(row(), now, solver);
  assert.match(own.title, /Your solver action/);
  assert.equal(own.needsAction, false);
  assert.match(own.detail, /does not guarantee/);
  assert.match(
    getOrderInsight(row(), now, owner).title,
    /Waiting for assigned/,
  );
  for (const clock of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(getOrderInsight(row(), clock).category, "waiting");
});

test("page summary preserves exact bigint liabilities and counts only the connected beneficiary's credit", () => {
  const largePrincipal = (1n << 128n) - 1n;
  const large = row(1, 3);
  large.source = {
    ...large.source,
    terms: { ...terms, principal: largePrincipal },
  };
  const rows = [large, row(2), row(3), row(4), row(3, 3, true)];
  const summary = summarizeOrders(
    rows,
    now,
    owner.toLowerCase() as `0x${string}`,
  );
  assert.equal(summary.total, 5);
  assert.equal(summary.lockedPrincipal, largePrincipal + terms.principal);
  assert.equal(summary.myClaimablePrincipal, terms.principal);
  assert.equal(summary.needsAction, 3);
  assert.deepEqual(summary.counts, {
    claim: 2,
    receipt: 1,
    expiry: 0,
    waiting: 1,
    complete: 1,
  });
  assert.equal(
    summarizeOrders(rows, now, solver).myClaimablePrincipal,
    terms.principal,
  );
  assert.equal(summarizeOrders(rows, now, recipient).myClaimablePrincipal, 0n);
  assert.equal(summarizeOrders(rows, now).myClaimablePrincipal, 0n);
});

test("no rows or unknown source records never manufacture actionable balances", () => {
  const summary = summarizeOrders([], now, owner);
  assert.equal(summary.total, 0);
  assert.equal(summary.lockedPrincipal, 0n);
  assert.equal(summary.myClaimablePrincipal, 0n);
  const unknown = row(0, 3);
  assert.equal(getOrderInsight(unknown, now).needsAction, false);
  assert.equal(summarizeOrders([unknown], now, owner).lockedPrincipal, 0n);
});
