import {
  arbitrumSepolia,
  baseSepolia,
  optimismSepolia,
  sepolia,
} from "viem/chains";
import {
  defineChain,
  getAddress,
  isAddress,
  type Address,
  type Chain,
} from "viem";

// All networks are testnets. A network preset alone is not a deployed route.
export const networks = {
  [sepolia.id]: {
    chain: sepolia,
    selector: 16015286601757825753n,
    rpc:
      process.env.NEXT_PUBLIC_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
  },
  [optimismSepolia.id]: {
    chain: optimismSepolia,
    selector: 5224473277236331295n,
    rpc: process.env.NEXT_PUBLIC_OP_RPC_URL || "https://sepolia.optimism.io",
  },
  [arbitrumSepolia.id]: {
    chain: arbitrumSepolia,
    selector: 3478487238524512106n,
    rpc:
      process.env.NEXT_PUBLIC_ARB_RPC_URL ||
      "https://sepolia-rollup.arbitrum.io/rpc",
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    selector: 10344971235874465080n,
    rpc: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org",
  },
  31337: {
    chain: defineChain({
      id: 31337,
      name: "Local source",
      nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
      blockExplorers: {
        default: {
          name: "Local RPC (no explorer)",
          url: "http://127.0.0.1:8545",
        },
      },
    }),
    selector: 1n,
    rpc: "http://127.0.0.1:8545",
  },
  31338: {
    chain: defineChain({
      id: 31338,
      name: "Local destination",
      nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:9545"] } },
      blockExplorers: {
        default: {
          name: "Local RPC (no explorer)",
          url: "http://127.0.0.1:9545",
        },
      },
    }),
    selector: 2n,
    rpc: "http://127.0.0.1:9545",
  },
} as const;
export type Network = { chain: Chain; selector: bigint; rpc: string };
export type Route = {
  id: string;
  label: string;
  source: Network;
  destination: Network;
  escrow?: Address;
  executor?: Address;
  solver?: Address;
  configured: boolean;
};
type RawRoute = {
  id: string;
  sourceChainId: number;
  destinationChainId: number;
  escrow: string;
  executor: string;
  solver?: string;
};
const address = (value: unknown): Address | undefined =>
  typeof value === "string" && isAddress(value) && !/^0x0{40}$/i.test(value)
    ? getAddress(value)
    : undefined;

export function parseRoutes(json?: string): Route[] {
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : [];
  } catch {
    throw new Error("NEXT_PUBLIC_ROUTES_JSON must be valid JSON.");
  }
  if (!Array.isArray(raw) || raw.length > 12)
    throw new Error("Configure an array of at most 12 routes.");
  const ids = new Set<string>();
  return raw.map((entry: RawRoute) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9-]{1,48}$/.test(entry.id) ||
      ids.has(entry.id)
    )
      throw new Error("Route IDs must be unique lowercase names.");
    ids.add(entry.id);
    if (
      !Number.isSafeInteger(entry.sourceChainId) ||
      !Number.isSafeInteger(entry.destinationChainId)
    )
      throw new Error("Route chain IDs must be integers.");
    const source = networks[entry.sourceChainId as keyof typeof networks];
    const destination =
      networks[entry.destinationChainId as keyof typeof networks];
    const escrow = address(entry.escrow),
      executor = address(entry.executor),
      solver = address(entry.solver);
    const localSource =
      entry.sourceChainId === 31337 || entry.sourceChainId === 31338;
    const localDestination =
      entry.destinationChainId === 31337 || entry.destinationChainId === 31338;
    if (localSource !== localDestination)
      throw new Error("Local fixtures cannot be paired with public networks.");
    if (
      (entry.sourceChainId === 31337 ||
        entry.sourceChainId === 31338 ||
        entry.destinationChainId === 31337 ||
        entry.destinationChainId === 31338) &&
      process.env.NEXT_PUBLIC_ENABLE_LOCAL !== "true"
    )
      throw new Error("Local routes require NEXT_PUBLIC_ENABLE_LOCAL=true.");
    if (
      !source ||
      !destination ||
      entry.sourceChainId === entry.destinationChainId ||
      !escrow ||
      !executor ||
      (entry.solver && !solver)
    )
      throw new Error(
        `Invalid route configuration: ${entry.id}. Use supported, distinct testnets and deployed addresses.`,
      );
    return {
      id: entry.id,
      label: `${source.chain.name} → ${destination.chain.name}`,
      source,
      destination,
      escrow,
      executor,
      solver,
      configured: true,
    };
  });
}
export function configuredRoutes(): { routes: Route[]; error?: string } {
  try {
    const routes = parseRoutes(process.env.NEXT_PUBLIC_ROUTES_JSON);
    if (routes.length) return { routes };
    const escrow = address(process.env.NEXT_PUBLIC_SOURCE_ADDRESS),
      executor = address(process.env.NEXT_PUBLIC_DESTINATION_ADDRESS);
    return {
      routes: [
        {
          id: "sepolia-op",
          label: "Ethereum Sepolia → OP Sepolia",
          source: networks[sepolia.id],
          destination: networks[optimismSepolia.id],
          escrow,
          executor,
          solver: address(process.env.NEXT_PUBLIC_SOLVER_ADDRESS),
          configured: Boolean(escrow && executor),
        },
      ],
    };
  } catch (e) {
    return {
      routes: [],
      error: e instanceof Error ? e.message : "Invalid route configuration",
    };
  }
}
