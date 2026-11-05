/** Hypothetical dollar-equivalent costs, not token prices or a live solver quote. */
export function solverEconomics(
  payment: string,
  funding: string,
  fees: string,
) {
  const cents = (value: string, label: string, allowZero = false) => {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value))
      throw new Error(
        `${label}: enter a dollar amount with up to two decimal places.`,
      );
    const [whole, decimal = ""] = value.split(".");
    const amount = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
    if (!allowZero && amount === 0n)
      throw new Error(`${label} must be greater than zero.`);
    return amount;
  };
  const paymentCents = cents(payment, "Source payment");
  const fundingCents = cents(funding, "Destination funding");
  const feeCents = cents(fees, "Execution and message costs", true);
  return {
    payment: paymentCents,
    funding: fundingCents,
    fees: feeCents,
    totalCost: fundingCents + feeCents,
    net: paymentCents - fundingCents - feeCents,
    grossSpread: paymentCents - fundingCents,
  };
}

export function formatScenarioDollars(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "−" : ""}$${(absolute / 100n).toLocaleString("en-US")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
