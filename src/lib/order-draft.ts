import { orderInput } from "./order-input.ts";

export type OrderDraft = {
  principal: string;
  amountIn: string;
  minOutput: string;
  maxPrice: string;
  hours: number;
  recipient: string;
  solver: string;
};

/** Drafts are untrusted browser data; validation still runs before signing. */
export function parseOrderDraft(value: unknown): OrderDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Partial<OrderDraft>;
  const decimal = (v: unknown, precision: number) =>
    typeof v === "string" &&
    v.length <= 80 &&
    new RegExp(`^\\d+(\\.\\d{1,${precision}})?$`).test(v) &&
    /[1-9]/.test(v);
  const address = (v: unknown) =>
    typeof v === "string" && (v === "" || /^0x[0-9a-fA-F]{40}$/.test(v));
  if (
    !decimal(draft.principal, 6) ||
    !decimal(draft.amountIn, 6) ||
    !decimal(draft.minOutput, 18) ||
    !decimal(draft.maxPrice, 18) ||
    ![1, 24, 72, 168].includes(draft.hours ?? 0) ||
    !address(draft.recipient) ||
    !address(draft.solver)
  )
    return null;
  const parsed = {
    principal: draft.principal!,
    amountIn: draft.amountIn!,
    minOutput: draft.minOutput!,
    maxPrice: draft.maxPrice!,
    hours: draft.hours!,
    recipient: draft.recipient!,
    solver: draft.solver!,
  };
  try {
    orderInput({
      ...parsed,
      owner: "0x0000000000000000000000000000000000000001",
      now: 0,
    });
    return parsed;
  } catch {
    return null;
  }
}

export function ordersCsv(
  rows: readonly {
    id: bigint;
    source: {
      terms: {
        owner: string;
        recipient: string;
        solver: string;
        principal: bigint;
        amountIn: bigint;
        minOutput: bigint;
        maxPrice: bigint;
        deadline: bigint;
      };
      state: number;
      claimed: boolean;
    };
    destination: { state: number } | null;
  }[],
  routeId: string,
): string {
  const states = [
    "Unknown",
    "Open",
    "Cancellation requested",
    "Filled",
    "Cancelled",
  ];
  // Encode arbitrary text as a safe spreadsheet cell, including formula prefixes.
  const cell = (v: unknown) => {
    const text = String(v);
    return `"${(/^(\s*[=+@-]|[\t\r\n])/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  };
  const decimal = (value: bigint, decimals: number) => {
    const raw = value.toString().padStart(decimals + 1, "0");
    return `${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`;
  };
  return [
    [
      "Route",
      "Order ID",
      "Owner",
      "Recipient",
      "Solver",
      "Principal (bUSD)",
      "Solver input (bUSD)",
      "Minimum (WETH)",
      "Trigger (USD)",
      "Expiry (Unix seconds)",
      "Source state",
      "Destination state",
      "Claim transferred",
    ],
    ...rows.map(({ id, source: s, destination: d }) => [
      routeId,
      String(id),
      s.terms.owner,
      s.terms.recipient,
      s.terms.solver,
      decimal(s.terms.principal, 6),
      decimal(s.terms.amountIn, 6),
      decimal(s.terms.minOutput, 18),
      decimal(s.terms.maxPrice, 18),
      String(s.terms.deadline),
      states[s.state] || "Unknown",
      d ? states[d.state] || "Unknown" : "Unavailable",
      s.claimed ? "Yes" : "No",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
