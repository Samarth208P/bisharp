/**
 * Deterministic order economics, not a swap quote or a prediction of returns.
 *
 * Input token amounts use 6 decimals, WETH amounts use 18, and oracle prices
 * use the 18-decimal value returned by DestinationExecutor.currentPrice().
 * USD scenarios assume the input token is worth $1. Test bUSD is unbacked.
 * Monetary outputs are integer USD millionths; prices are USD with 18 decimals.
 * Valuations/output estimates round down; acquisition/breakeven prices round up.
 */
const PRICE_TO_USD = 10n ** 30n;
const BPS = 10_000n;
const UINT128 = (1n << 128n) - 1n;
const UINT256 = (1n << 256n) - 1n;

export type TradeWarningCode =
  | "fees-missing"
  | "fees-exceed-principal"
  | "solver-subsidy"
  | "minimum-below-principal"
  | "minimum-below-total-cost"
  | "minimum-above-reference"
  | "reference-unavailable"
  | "reference-below-precision";

export type TradeWarning = {
  code: TradeWarningCode;
  message: string;
};

export type TradePlanInput = {
  principal: string;
  amountIn: string;
  minOutput: string;
  /** Normalized USD18 oracle price, never the feed's raw 8-decimal answer. */
  oraclePrice: bigint | null;
  /** Blank/omitted means unknown. Explicit "0" means a zero-cost scenario. */
  feeBudgetUsd?: string;
  /** A scenario haircut from the oracle reference, not a DEX slippage quote. */
  slippageBps?: number;
};

export type TradePlan = {
  principal: bigint;
  amountIn: bigint;
  minOutput: bigint;
  feeBudgetUsd: bigint | null;
  totalCostUsd: bigint | null;
  /** Source principal minus solver funding. A negative value is a subsidy. */
  solverSpreadUsd: bigint;
  solverSpreadBps: bigint;
  effectiveMaxPrice: bigint;
  solverMaxPrice: bigint;
  breakevenPrice: bigint | null;
  referenceOutput: bigint | null;
  suggestedMinimumOutput: bigint | null;
  minimumValueUsd: bigint | null;
  minimumValueDeltaUsd: bigint | null;
  minimumValueDeltaAfterFeesUsd: bigint | null;
  /** Fee budget as a fraction of principal, expressed in basis points. */
  feeShareBps: bigint | null;
  slippageBps: number;
  warnings: TradeWarning[];
};

function parseAmount(
  value: string,
  decimals: number,
  label: string,
  allowZero = false,
): bigint {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value)
  ) {
    throw new Error(
      `${label}: enter a decimal with at most ${decimals} decimal places.`,
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const parsed =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (parsed > UINT128 || (allowZero ? parsed < 0n : parsed <= 0n)) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return parsed;
}

function validatePrice(price: bigint): void {
  if (typeof price !== "bigint" || price <= 0n || price > UINT256) {
    throw new Error(
      "A positive, normalized 18-decimal oracle price is required.",
    );
  }
}

function validateSlippage(slippageBps: number): void {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  ) {
    throw new Error(
      "Reference haircut must be an integer from 0 to 9,999 bps.",
    );
  }
}

const ceilDiv = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;

/** Exact decimal formatting without Number conversion or silent rounding. */
export function formatDecimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Decimal precision must be an integer from 0 to 36.");
  }
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  if (decimals === 0) return `${sign}${magnitude}`;
  const scale = 10n ** BigInt(decimals);
  const fraction = (magnitude % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${sign}${magnitude / scale}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Builds a positive, contract-compatible minimum from a reference-price scenario.
 * It excludes pool fees, price impact and liquidity, so it is not executable output.
 */
export function estimateMinimumOutput(
  amountIn: string,
  oraclePrice: bigint,
  slippageBps: number,
): string {
  validatePrice(oraclePrice);
  validateSlippage(slippageBps);
  const input = parseAmount(amountIn, 6, "Solver input");
  const reference = (input * PRICE_TO_USD) / oraclePrice;
  const minimum = (reference * (BPS - BigInt(slippageBps))) / BPS;
  if (minimum <= 0n || minimum > UINT128) {
    throw new Error("Reference minimum is outside the supported output range.");
  }
  return formatDecimal(minimum, 18);
}

export function calculateTradePlan(input: TradePlanInput): TradePlan {
  const principal = parseAmount(input.principal, 6, "Principal");
  const amountIn = parseAmount(input.amountIn, 6, "Solver input");
  const minOutput = parseAmount(input.minOutput, 18, "Minimum output");
  const slippageBps = input.slippageBps ?? 100;
  validateSlippage(slippageBps);
  const feeBudgetUsd =
    input.feeBudgetUsd === undefined || input.feeBudgetUsd === ""
      ? null
      : parseAmount(input.feeBudgetUsd, 6, "Fee budget", true);
  const totalCostUsd = feeBudgetUsd === null ? null : principal + feeBudgetUsd;
  const solverSpreadUsd = principal - amountIn;
  const effectiveMaxPrice = ceilDiv(principal * PRICE_TO_USD, minOutput);
  const solverMaxPrice = ceilDiv(amountIn * PRICE_TO_USD, minOutput);
  const warnings: TradeWarning[] = [];

  if (feeBudgetUsd === null) {
    warnings.push({
      code: "fees-missing",
      message: "Add a fee budget to include transaction gas and message costs.",
    });
  } else if (feeBudgetUsd >= principal) {
    warnings.push({
      code: "fees-exceed-principal",
      message: "Your fee budget is at least as large as the source principal.",
    });
  }
  if (solverSpreadUsd < 0n) {
    warnings.push({
      code: "solver-subsidy",
      message:
        "The solver must supply more input tokens than its source payment. Confirm that it accepts these terms.",
    });
  }

  let referenceOutput: bigint | null = null;
  let suggestedMinimumOutput: bigint | null = null;
  let minimumValueUsd: bigint | null = null;
  if (input.oraclePrice === null) {
    warnings.push({
      code: "reference-unavailable",
      message:
        "A fresh oracle reference is unavailable. Output valuation cannot be calculated.",
    });
  } else {
    validatePrice(input.oraclePrice);
    referenceOutput = (amountIn * PRICE_TO_USD) / input.oraclePrice;
    const suggestion = (referenceOutput * (BPS - BigInt(slippageBps))) / BPS;
    if (suggestion > 0n && suggestion <= UINT128) {
      suggestedMinimumOutput = suggestion;
    } else {
      warnings.push({
        code: "reference-below-precision",
        message:
          "The reference scenario cannot produce a positive, contract-compatible minimum output.",
      });
    }
    minimumValueUsd = (minOutput * input.oraclePrice) / PRICE_TO_USD;
    if (minimumValueUsd < principal) {
      warnings.push({
        code: "minimum-below-principal",
        message:
          "Your minimum output is worth less than the source principal at this reference price, before fees.",
      });
    } else if (totalCostUsd !== null && minimumValueUsd < totalCostUsd) {
      warnings.push({
        code: "minimum-below-total-cost",
        message:
          "Your minimum output covers the principal at this reference price but does not cover the added fee budget.",
      });
    }
    if (minOutput > referenceOutput) {
      warnings.push({
        code: "minimum-above-reference",
        message:
          "Your minimum output exceeds the oracle-only output estimate. A fill may need a lower market price or a better pool rate.",
      });
    }
  }

  return {
    principal,
    amountIn,
    minOutput,
    feeBudgetUsd,
    totalCostUsd,
    solverSpreadUsd,
    solverSpreadBps: (solverSpreadUsd * BPS) / principal,
    effectiveMaxPrice,
    solverMaxPrice,
    breakevenPrice:
      totalCostUsd === null
        ? null
        : ceilDiv(totalCostUsd * PRICE_TO_USD, minOutput),
    referenceOutput,
    suggestedMinimumOutput,
    minimumValueUsd,
    minimumValueDeltaUsd:
      minimumValueUsd === null ? null : minimumValueUsd - principal,
    minimumValueDeltaAfterFeesUsd:
      minimumValueUsd === null || totalCostUsd === null
        ? null
        : minimumValueUsd - totalCostUsd,
    feeShareBps:
      feeBudgetUsd === null ? null : (feeBudgetUsd * BPS) / principal,
    slippageBps,
    warnings,
  };
}
