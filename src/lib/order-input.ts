import { getAddress, isAddress, parseUnits, type Address } from "viem";
export type Terms = {
  owner: Address;
  recipient: Address;
  solver: Address;
  deadline: bigint;
  principal: bigint;
  amountIn: bigint;
  minOutput: bigint;
  maxPrice: bigint;
};
const UINT128 = (1n << 128n) - 1n;
function amount(value: string, decimals: number, label: string) {
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value))
    throw new Error(
      `${label}: enter a positive decimal with at most ${decimals} decimal places.`,
    );
  const result = parseUnits(value, decimals);
  if (result <= 0n || result > UINT128)
    throw new Error(`${label} is outside the supported range.`);
  return result;
}
function wallet(value: string, label: string): Address {
  if (!isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`${label}: enter a valid wallet address.`);
  return getAddress(value);
}
export function orderInput(input: {
  owner: Address;
  recipient: string;
  solver: string;
  principal: string;
  amountIn: string;
  minOutput: string;
  maxPrice: string;
  hours: number;
  now: number;
}): Terms {
  if (![1, 24, 72, 168].includes(input.hours))
    throw new Error("Choose a supported expiry.");
  return {
    owner: getAddress(input.owner),
    recipient: wallet(input.recipient || input.owner, "Recipient"),
    solver: wallet(input.solver || input.owner, "Solver"),
    deadline: BigInt(Math.floor(input.now / 1000) + input.hours * 3600),
    principal: amount(input.principal, 6, "Principal"),
    amountIn: amount(input.amountIn, 6, "Solver input"),
    minOutput: amount(input.minOutput, 18, "Minimum output"),
    maxPrice: amount(input.maxPrice, 18, "Trigger price"),
  };
}
