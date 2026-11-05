import type { Address } from "viem";
import type { Terms } from "./order-input.ts";

export type OrderStatusRecord = {
  terms: Terms;
  state: number;
  claimed: boolean;
};

export type OrderStatusRow = {
  id: bigint;
  source: OrderStatusRecord;
  destination: OrderStatusRecord | null;
};

export type OrderCategory =
  | "claim"
  | "receipt"
  | "expiry"
  | "waiting"
  | "complete";

export type OrderInsight = {
  title: string;
  detail: string;
  needsAction: boolean;
  category: OrderCategory;
  beneficiary?: Address;
};

const equal = (a: Address | undefined, b: Address) =>
  a?.toLowerCase() === b.toLowerCase();

/** Describe the next safe lifecycle step, without inferring delivery or fill eligibility. */
export function getOrderInsight(
  row: OrderStatusRow,
  now: number,
  account?: Address,
): OrderInsight {
  const source = row.source;
  const destination = row.destination;
  const terminal = source.state === 3 || source.state === 4;
  const beneficiary =
    source.state === 3 ? source.terms.solver : source.terms.owner;
  const expired =
    Number.isSafeInteger(now) &&
    now >= 0 &&
    BigInt(Math.floor(now / 1000)) >= source.terms.deadline;

  if (terminal && source.claimed)
    return {
      title:
        source.state === 3
          ? "Solver payment transferred"
          : "Refund transferred",
      detail:
        "The source claim is complete. The fixed beneficiary received the principal.",
      needsAction: false,
      category: "complete",
      beneficiary,
    };

  if (terminal)
    return {
      title: source.state === 3 ? "Claim solver payment" : "Claim refund",
      detail: equal(account, beneficiary)
        ? "Your source principal is ready. Trigger the claim to transfer it to your wallet."
        : "Anyone can trigger this claim. The principal goes only to the fixed beneficiary.",
      needsAction: true,
      category: "claim",
      beneficiary,
    };

  if (source.state !== 1 && source.state !== 2)
    return {
      title: "Source order unavailable",
      detail:
        "No recognized source order was returned. Refresh the source before taking action.",
      needsAction: false,
      category: "waiting",
    };

  if (destination?.state === 3 || destination?.state === 4)
    return {
      title:
        destination.state === 3
          ? "Send settlement receipt"
          : "Send cancellation receipt",
      detail:
        destination.state === 3
          ? "The destination fill is recorded. Send or retry its receipt, then wait for source credit before claiming solver payment."
          : "The destination is closed. Send or retry its receipt, then wait for source credit before claiming a refund.",
      needsAction: true,
      category: "receipt",
    };

  if (!destination)
    return {
      title: "Destination state unavailable",
      detail:
        source.state === 2
          ? "A cancellation was requested, but destination closure is unverified. Refresh its connection; the source principal remains locked."
          : "Refresh the destination connection to verify registration or execution. Source expiry alone cannot release the principal.",
      needsAction: false,
      category: "waiting",
    };

  if (expired && destination.state === 1)
    return {
      title: "Close expired destination order",
      detail:
        "Anyone can close this expired order on the destination. Send its cancellation receipt afterward to unlock the source refund.",
      needsAction: true,
      category: "expiry",
    };

  if (source.state === 2)
    return {
      title: "Cancellation in transit",
      detail:
        "A request has been sent. Wait for destination closure; a fill can win the cancellation race. A resend spends another message fee.",
      needsAction: false,
      category: "waiting",
    };

  if (expired && destination.state === 0)
    return {
      title: "Cancel expired order",
      detail:
        "Request cancellation on the source so the destination can close even if registration is delayed. A refund needs the destination receipt.",
      needsAction: true,
      category: "expiry",
    };

  if (destination.state === 0)
    return {
      title: "Registration in transit",
      detail:
        "The destination has not registered this order. Wait for delivery before solver execution; resending CREATE spends another message fee.",
      needsAction: false,
      category: "waiting",
    };

  return {
    title: equal(account, source.terms.solver)
      ? "Your solver action is pending"
      : "Waiting for assigned solver",
    detail:
      "The designated solver must check the price trigger, destination inventory and minimum output, then submit a fill. A registered order does not guarantee execution.",
    needsAction: false,
    category: "waiting",
  };
}

/** Totals cover these loaded rows only, never an inferred wallet-wide portfolio. */
export function summarizeOrders(
  rows: readonly OrderStatusRow[],
  now: number,
  account?: Address,
) {
  const counts: Record<OrderCategory, number> = {
    claim: 0,
    receipt: 0,
    expiry: 0,
    waiting: 0,
    complete: 0,
  };
  let lockedPrincipal = 0n;
  let myClaimablePrincipal = 0n;
  let needsAction = 0;
  for (const row of rows) {
    const insight = getOrderInsight(row, now, account);
    counts[insight.category]++;
    if (insight.needsAction) needsAction++;
    if (row.source.state === 1 || row.source.state === 2)
      lockedPrincipal += row.source.terms.principal;
    if (
      insight.category === "claim" &&
      insight.beneficiary &&
      equal(account, insight.beneficiary)
    )
      myClaimablePrincipal += row.source.terms.principal;
  }
  return {
    total: rows.length,
    needsAction,
    lockedPrincipal,
    myClaimablePrincipal,
    counts,
  };
}
