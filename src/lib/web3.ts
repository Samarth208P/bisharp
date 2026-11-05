import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { sepolia } from "viem/chains";

export { sepolia };
const configured = process.env.NEXT_PUBLIC_ESCROW_ADDRESS?.trim();
export const escrowAddress =
  configured && isAddress(configured) && !/^0x0{40}$/i.test(configured)
    ? configured
    : undefined;
export const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
});
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function faucet()",
]);
export const shortAddress = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-4)}`;
