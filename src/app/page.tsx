"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
  http,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { sourceAbi, destinationAbi } from "@/lib/cross-abi";
import { configuredRoutes, networks, type Route } from "@/lib/routes";
import {
  canUseRouteSide,
  inspectPairing,
  isFreshSnapshot,
  type PairingState,
} from "@/lib/route-health";
import { orderInput, type Terms } from "@/lib/order-input";
import { tokenAbi, shortAddress } from "@/lib/web3";
import { BrandMark } from "./visuals";
import { SelectField } from "./select-field";
import { TradeCheck } from "./trade-check";
import {
  calculateTradePlan,
  formatDecimal,
  type TradePlan,
} from "@/lib/trade-plan";
import { parseOrderDraft, ordersCsv, type OrderDraft } from "@/lib/order-draft";
import { getOrderInsight, summarizeOrders } from "@/lib/order-status";
import {
  parseTransactionHistory,
  mergeTransactionHistory,
  receiptTransaction,
  type TrackedTransaction,
} from "@/lib/transaction-history";

type Record = {
  terms: Terms;
  termsHash: Hash;
  state: number;
  claimed: boolean;
};
type Row = { id: bigint; source: Record; destination: Record | null };
type Data = {
  pairing: PairingState;
  rows: Row[];
  count: bigint;
  token: Address;
  allowance: bigint;
  balance: bigint;
  credits: bigint;
  block: bigint;
  nativeCredit: bigint;
  maxPrincipal: bigint;
  remainingCapacity: bigint;
  at: number;
};
type Destination = {
  pairing: PairingState;
  token: Address;
  output: Address;
  feed: Address;
  pool: Address;
  balance: bigint;
  allowance: bigint;
  price: bigint | null;
  nativeCredit: bigint;
  block: bigint;
  at: number;
};
type Tx = TrackedTransaction;
type Action = {
  label: string;
  side: "source" | "destination";
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};
type Review = {
  action: Action;
  terms?: Terms;
  fee: bigint;
  budget: bigint;
  protection?: TradePlan;
  selfSolving?: boolean;
};
const routesConfig = configuredRoutes();
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const GAS = 400_000;
const RECEIPT_GAS = 300_000;
const amount = (value: bigint, decimals = 6, digits = 6) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
const equal = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const label = (state: number) =>
  ["Message pending", "Open", "Cancellation requested", "Filled", "Cancelled"][
    state
  ] || "Unknown";
const localRoute = (route: Route) =>
  route.source.chain.id === 31337 || route.source.chain.id === 31338;
const explorer = (route: Route, side: Action["side"]) =>
  localRoute(route)
    ? `/local-explorer/${route[side].chain.id}`
    : route[side].chain.blockExplorers!.default.url;
const rpc = (route: Route, side: Action["side"]) =>
  createPublicClient({
    chain: route[side].chain,
    transport: http(route[side].rpc, { timeout: 15000, retryCount: 1 }),
  });
async function read(
  route: Route,
  side: Action["side"],
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<unknown> {
  return rpc(route, side).readContract({
    address,
    abi,
    functionName,
    args,
    blockNumber,
  });
}
const errorText = (error: unknown) =>
  error instanceof BaseError
    ? error.shortMessage
    : error instanceof Error
      ? error.message
      : "The request failed. Retry after checking your wallet and RPC connection.";

export default function Home() {
  const [routeIndex, setRouteIndex] = useState(0);
  const route = routesConfig.routes[routeIndex];
  const [account, setAccount] = useState<Address>();
  const accountRef = useRef<Address | undefined>(undefined);
  accountRef.current = account;
  const [chainId, setChainId] = useState<number>();
  const [walletVersion, setWalletVersion] = useState(0);
  const [data, setData] = useState<Data>();
  const [dest, setDest] = useState<Destination>();
  const [sourceError, setSourceError] = useState("");
  const [destError, setDestError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"mine" | "all">("mine");
  const [activityFilter, setActivityFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [principal, setPrincipal] = useState("5");
  const [solverInput, setSolverInput] = useState("5");
  const [minimum, setMinimum] = useState("0.0015");
  const [trigger, setTrigger] = useState("2500");
  const [hours, setHours] = useState(24);
  const [recipient, setRecipient] = useState("");
  const [solver, setSolver] = useState("");
  const [feeBudgetUsd, setFeeBudgetUsd] = useState("");
  const [savedDraft, setSavedDraft] = useState<OrderDraft | null>(null);
  const reviewOpener = useRef<HTMLElement | null>(null);
  const [review, setReview] = useState<Review>();
  const [accepted, setAccepted] = useState(false);
  const [acceptedProtection, setAcceptedProtection] = useState(false);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const reviewOpen = Boolean(review);
  useEffect(() => {
    if (!reviewOpen) return;
    const opener = reviewOpener.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [reviewOpen]);
  const lock = useRef(false);
  const generation = useRef(0);
  const refreshLocks = useRef(new Set<string>());
  const identity = useRef("");
  identity.current = `${route?.id}:${account}:${page}:${view}`;
  const storageKey = `bisharp:cross:${route?.source.chain.id}:${route?.escrow}:${route?.destination.chain.id}:${route?.executor}`;
  const draftKey = `${storageKey}:draft`;
  const sourceFresh = Boolean(
    route?.configured && isFreshSnapshot(data, sourceError, now),
  );
  const destFresh = Boolean(
    route?.configured && isFreshSnapshot(dest, destError, now),
  );
  const sourceReady = Boolean(
    route?.configured && canUseRouteSide(data, sourceError, now),
  );
  const destReady = Boolean(
    route?.configured && canUseRouteSide(dest, destError, now),
  );
  const routeReady = sourceReady && destReady;
  const awaitingPairing =
    (sourceFresh && data?.pairing === "pending") ||
    (destFresh && dest?.pairing === "pending");

  const refresh = useCallback(async () => {
    const key = `${route?.id}:${account}:${page}:${view}`;
    const walletGeneration = generation.current;
    const requestKey = `${key}:${walletGeneration}`;
    const isCurrent = () =>
      key === identity.current && walletGeneration === generation.current;
    if (
      !route?.configured ||
      !route.escrow ||
      !route.executor ||
      refreshLocks.current.has(requestKey)
    )
      return;
    refreshLocks.current.add(requestKey);
    setRefreshing(true);
    const source = rpc(route, "source"),
      destination = rpc(route, "destination");
    try {
      const sourceTask = async () => {
        if ((await source.getChainId()) !== route.source.chain.id)
          throw new Error("Source RPC returned the wrong chain ID.");
        const block = await source.getBlockNumber({ cacheTime: 0 });
        const get = (name: string, args: readonly unknown[] = []) =>
          read(route, "source", route.escrow!, sourceAbi, name, args, block);
        const [
          token,
          peer,
          authority,
          local,
          remote,
          count,
          nativeCredit,
          credits,
          maxPrincipal,
          cap,
          liability,
        ] = await Promise.all([
          get("inputToken"),
          get("peer"),
          get("pairingAuthority"),
          get("localSelector"),
          get("remoteSelector"),
          get(
            view === "mine" ? "ownerOrderCount" : "orderCount",
            view === "mine" ? [account || ZERO] : [],
          ),
          get("nativeCredits", [account || ZERO]),
          get("credits", [account || ZERO]),
          get("maxPrincipal"),
          get("liabilityCap"),
          get("totalLiability"),
        ]);
        const pairing = inspectPairing({
          peer: peer as Address,
          expectedPeer: route.executor!,
          authority: authority as Address,
          local: local as bigint,
          remote: remote as bigint,
          expectedLocal: route.source.selector,
          expectedRemote: route.destination.selector,
        });
        const total = count as bigint;
        const offset = BigInt(page * 10);
        const ids =
          view === "mine"
            ? ((await get("ownerOrders", [
                account || ZERO,
                offset,
                10n,
              ])) as bigint[])
            : Array.from(
                {
                  length: Number(
                    total > offset
                      ? total - offset < 10n
                        ? total - offset
                        : 10n
                      : 0n,
                  ),
                },
                (_, i) => total - offset - BigInt(i),
              );
        const [rows, balance, allowance, decimals] = await Promise.all([
          Promise.all(
            ids.map(async (id) => ({
              id,
              source: (await get("getOrder", [id])) as Record,
              destination: null as Record | null,
            })),
          ),
          read(
            route,
            "source",
            token as Address,
            tokenAbi,
            "balanceOf",
            [account || ZERO],
            block,
          ),
          read(
            route,
            "source",
            token as Address,
            tokenAbi,
            "allowance",
            [account || ZERO, route.escrow],
            block,
          ),
          read(
            route,
            "source",
            token as Address,
            tokenAbi,
            "decimals",
            [],
            block,
          ),
        ]);
        if (decimals !== 6)
          throw new Error(
            "Source token must have 6 decimals for this interface.",
          );
        return {
          pairing,
          rows,
          count: total,
          token: token as Address,
          balance: balance as bigint,
          allowance: allowance as bigint,
          credits: credits as bigint,
          block,
          nativeCredit: nativeCredit as bigint,
          maxPrincipal: maxPrincipal as bigint,
          remainingCapacity: (cap as bigint) - (liability as bigint),
          at: Date.now(),
        };
      };
      const destTask = async () => {
        if ((await destination.getChainId()) !== route.destination.chain.id)
          throw new Error("Destination RPC returned the wrong chain ID.");
        const block = await destination.getBlockNumber({ cacheTime: 0 });
        const get = (name: string, args: readonly unknown[] = []) =>
          read(
            route,
            "destination",
            route.executor!,
            destinationAbi,
            name,
            args,
            block,
          );
        const [
          token,
          output,
          peer,
          authority,
          local,
          remote,
          feed,
          pool,
          nativeCredit,
          price,
        ] = await Promise.all([
          get("inputToken"),
          get("outputToken"),
          get("peer"),
          get("pairingAuthority"),
          get("localSelector"),
          get("remoteSelector"),
          get("priceFeed"),
          get("pool"),
          get("nativeCredits", [account || ZERO]),
          get("currentPrice").catch(() => null),
        ]);
        const pairing = inspectPairing({
          peer: peer as Address,
          expectedPeer: route.escrow!,
          authority: authority as Address,
          local: local as bigint,
          remote: remote as bigint,
          expectedLocal: route.destination.selector,
          expectedRemote: route.source.selector,
        });
        const [balance, allowance, inputDecimals, outputDecimals] =
          await Promise.all([
            read(
              route,
              "destination",
              token as Address,
              tokenAbi,
              "balanceOf",
              [account || ZERO],
              block,
            ),
            read(
              route,
              "destination",
              token as Address,
              tokenAbi,
              "allowance",
              [account || ZERO, route.executor],
              block,
            ),
            read(
              route,
              "destination",
              token as Address,
              tokenAbi,
              "decimals",
              [],
              block,
            ),
            read(
              route,
              "destination",
              output as Address,
              tokenAbi,
              "decimals",
              [],
              block,
            ),
          ]);
        if (inputDecimals !== 6 || outputDecimals !== 18)
          throw new Error(
            "Destination token decimals do not match this interface.",
          );
        return {
          pairing,
          token: token as Address,
          output: output as Address,
          feed: feed as Address,
          pool: pool as Address,
          balance: balance as bigint,
          allowance: allowance as bigint,
          nativeCredit: nativeCredit as bigint,
          price: price as bigint | null,
          block,
          at: Date.now(),
        };
      };
      // Publish each chain as soon as it resolves. Destination latency must not
      // hold a healthy source claim behind remote reads.
      const [s, d] = await Promise.allSettled([
        sourceTask()
          .then((snapshot) => {
            if (isCurrent()) {
              setData(snapshot);
              setSourceError("");
              setNow(Date.now());
            }
            return snapshot;
          })
          .catch((e: unknown) => {
            if (isCurrent()) setSourceError(errorText(e));
            throw e;
          }),
        destTask()
          .then((snapshot) => {
            if (isCurrent()) {
              setDest(snapshot);
              setDestError("");
              setNow(Date.now());
            }
            return snapshot;
          })
          .catch((e: unknown) => {
            if (isCurrent()) setDestError(errorText(e));
            throw e;
          }),
      ]);
      if (!isCurrent()) return;
      if (s.status === "fulfilled" && d.status === "fulfilled") {
        const results = await Promise.allSettled(
          s.value.rows.map((row) =>
            read(
              route,
              "destination",
              route.executor!,
              destinationAbi,
              "getOrder",
              [row.id],
              d.value.block,
            ),
          ),
        );
        if (!isCurrent()) return;
        const rows = s.value.rows.map((row, i) => {
          const result = results[i];
          return {
            ...row,
            destination:
              result.status === "fulfilled" ? (result.value as Record) : null,
          };
        });
        // Keep the source timestamp: attaching destination state does not
        // make an old source observation fresh again.
        setData({ ...s.value, rows });
      }
    } finally {
      refreshLocks.current.delete(requestKey);
      if (isCurrent()) setRefreshing(false);
    }
  }, [route, account, page, view, walletVersion]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const provider = window.ethereum;
    const sync = async () => {
      const version = ++generation.current;
      setData(undefined);
      setDest(undefined);
      setReview(undefined);
      setAccepted(false);
      setAcceptedProtection(false);
      setWalletVersion(version);
      if (!provider) return;
      try {
        const [accounts, id] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (generation.current === version) {
          if (
            (accounts as Address[])[0]?.toLowerCase() !==
            accountRef.current?.toLowerCase()
          )
            setPage(0);
          setAccount((accounts as Address[])[0]);
          setChainId(Number(id));
        }
      } catch {
        if (generation.current === version) setAccount(undefined);
      }
    };
    const listener = () => void sync();
    void sync();
    provider?.on?.("accountsChanged", listener);
    provider?.on?.("chainChanged", listener);
    return () => {
      clearInterval(timer);
      provider?.removeListener?.("accountsChanged", listener);
      provider?.removeListener?.("chainChanged", listener);
    };
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 12000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );
      setTransactions(
        parseTransactionHistory(
          value,
          route ? [route.source.chain.id, route.destination.chain.id] : [],
        ),
      );
    } catch {
      setTransactions([]);
    }
  }, [storageKey, route]);
  useEffect(() => {
    try {
      setSavedDraft(
        parseOrderDraft(JSON.parse(localStorage.getItem(draftKey) || "null")),
      );
    } catch {
      setSavedDraft(null);
    }
  }, [draftKey]);
  const saveTx = useCallback(
    (tx: Tx) =>
      setTransactions((previous) => {
        const next = mergeTransactionHistory(previous, tx);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
        return next;
      }),
    [storageKey],
  );

  useEffect(() => {
    if (!route || !transactions.some((t) => t.state === "pending")) return;
    let stopped = false;
    const check = async () => {
      for (const tx of transactions.filter((t) => t.state === "pending")) {
        try {
          const side =
            tx.chainId === route.source.chain.id ? "source" : "destination";
          const receipt = await rpc(route, side).getTransactionReceipt({
            hash: tx.hash,
          });
          if (!stopped) {
            saveTx({
              ...tx,
              state: receipt.status === "success" ? "confirmed" : "failed",
              messages: messageIds(receipt.logs, side),
            });
            void refresh();
          }
        } catch {
          /* Pending receipt remains recoverable after reload. */
        }
      }
    };
    void check();
    const timer = setInterval(() => void check(), 12000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [transactions, route, saveTx, refresh]);

  function messageIds(
    logs: readonly { address: Address; data: Hash; topics: readonly Hash[] }[],
    side: Action["side"],
  ): Hash[] {
    return logs.flatMap((log) => {
      if (
        !equal(log.address, side === "source" ? route?.escrow : route?.executor)
      )
        return [];
      try {
        const event = decodeEventLog({
          abi: sourceAbi,
          data: log.data,
          topics: [...log.topics] as [Hash, ...Hash[]],
        });
        return event.eventName === "MessageSent" ? [event.args.messageId] : [];
      } catch {
        return [];
      }
    });
  }
  async function connect() {
    const version = ++generation.current;
    try {
      if (!window.ethereum)
        throw new Error(
          "Install an injected Ethereum wallet such as MetaMask, then reload.",
        );
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      const id = Number(
        await window.ethereum.request({ method: "eth_chainId" }),
      );
      if (version !== generation.current) return;
      setAccount(accounts[0]);
      setChainId(id);
      setPage(0);
      setWalletVersion(version);
    } catch (e) {
      if (version === generation.current) setError(errorText(e));
    }
  }
  async function localGas() {
    if (!account || !localRoute(route) || busy) return;
    setError("");
    try {
      for (const chainId of [31337, 31338]) {
        const response = await fetch("/api/local/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: account, chainId }),
        });
        if (!response.ok)
          throw new Error(
            "Local gas faucet unavailable. Check that both Anvil nodes are running.",
          );
      }
      setNotice(
        "Set your wallet's balance to 10 simulated ETH on each local chain. No public funds were used.",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function send(action: Action, value = action.value || 0n) {
    if (lock.current || !route) return;
    const context = identity.current;
    lock.current = true;
    setBusy(action.label);
    setError("");
    setNotice("");
    let hash: Hash | undefined;
    try {
      if (!account || !window.ethereum)
        throw new Error("Connect your wallet first.");
      if (!(action.side === "source" ? sourceReady : destReady))
        throw new Error(
          "This side of the route is not ready. Check its status before sending a transaction.",
        );
      if (action.functionName === "createOrder" && !routeReady)
        throw new Error(
          "Both sides of the route must be active before creating an order.",
        );
      const chain = route[action.side].chain;
      let wallet = createWalletClient({
        chain,
        transport: custom(window.ethereum as EIP1193Provider),
      });
      if ((await wallet.getChainId()) !== chain.id) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${chain.id.toString(16)}` }],
          });
        } catch (e) {
          if ((e as { code?: number }).code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: `0x${chain.id.toString(16)}`,
                  chainName: chain.name,
                  nativeCurrency: chain.nativeCurrency,
                  rpcUrls: [route[action.side].rpc],
                  blockExplorerUrls: [chain.blockExplorers!.default.url],
                },
              ],
            });
          } else throw e;
        }
        wallet = createWalletClient({
          chain,
          transport: custom(window.ethereum as EIP1193Provider),
        });
      }
      if ((await wallet.getChainId()) !== chain.id)
        throw new Error("Wallet network does not match the action.");
      const active = await wallet.getAddresses();
      if (!equal(active[0], account))
        throw new Error("Wallet account changed. Review again.");
      const client = rpc(route, action.side);
      if ((await client.getChainId()) !== chain.id)
        throw new Error("RPC network does not match the action.");
      const { request } = await client.simulateContract({
        address: action.address,
        abi: action.abi,
        functionName: action.functionName,
        args: action.args,
        account,
        value,
      });
      if (
        context !== identity.current ||
        !equal((await wallet.getAddresses())[0], account) ||
        (await wallet.getChainId()) !== chain.id
      )
        throw new Error("Wallet or route changed. Review again.");
      if (
        !canUseRouteSide(
          action.side === "source" ? data : dest,
          action.side === "source" ? sourceError : destError,
          Date.now(),
        )
      )
        throw new Error(
          "Route data became stale while preparing this transaction. Refresh and review again.",
        );
      hash = await wallet.writeContract(request);
      const transaction: Tx = {
        hash,
        chainId: chain.id,
        label: action.label,
        state: "pending",
        messages: [],
      };
      saveTx(transaction);
      setNotice(
        "Transaction submitted. Waiting for a receipt; CCIP delivery is a separate step.",
      );
      let replacementReason: "repriced" | "replaced" | "cancelled" | undefined;
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
        onReplaced: ({ reason }) => {
          replacementReason = reason;
          saveTx({
            ...transaction,
            state: "failed",
            label: `${transaction.label} (replaced)`,
          });
        },
      });
      const settled = receiptTransaction(
        transaction,
        receipt,
        replacementReason,
      );
      saveTx({
        ...settled.transaction,
        messages: messageIds(receipt.logs, action.side),
      });
      if (receipt.status !== "success")
        throw new Error(
          "Transaction reverted. Check the explorer before retrying.",
        );
      if (!settled.actionSucceeded)
        throw new Error(
          "The wallet replaced this action with a different transaction. Inspect its receipt and refresh the order before retrying.",
        );
      setReview(undefined);
      setNotice(`${action.label} confirmed on ${chain.name}.`);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      if (hash)
        setNotice(
          "A transaction was submitted. Inspect its explorer link before retrying; it may still confirm.",
        );
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function reviewAction(
    action: Action,
    quoteName: string,
    quoteArgs: readonly unknown[],
  ) {
    if (!route || busy) return;
    const context = identity.current;
    const walletGeneration = generation.current;
    try {
      const fee = (await read(
        route,
        action.side,
        action.address,
        action.abi,
        quoteName,
        quoteArgs,
      )) as bigint;
      if (
        context !== identity.current ||
        walletGeneration !== generation.current
      )
        return;
      setAccepted(false);
      setError("");
      reviewOpener.current = document.activeElement as HTMLElement;
      setReview({ action, fee, budget: fee + fee / 5n + 1n });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const context = identity.current;
    const walletGeneration = generation.current;
    try {
      if (!route?.escrow || !route.executor || !account || !data || !routeReady)
        throw new Error(
          "Connect a wallet and wait for both sides of the route to be active before creating an order.",
        );
      const terms = orderInput({
        owner: account,
        recipient,
        solver: solver || route.solver || "",
        principal,
        amountIn: solverInput,
        minOutput: minimum,
        maxPrice: trigger,
        hours,
        now: Date.now(),
      });
      if (equal(terms.recipient, route.executor))
        throw new Error("The destination executor cannot be the recipient.");
      if (
        equal(terms.solver, route.escrow) ||
        equal(terms.solver, route.executor)
      )
        throw new Error(
          "An escrow or executor contract cannot be the solver. Choose a wallet that can fund and execute the fill.",
        );
      if (terms.principal > data.balance)
        throw new Error("Insufficient source bUSD. Mint test tokens first.");
      if (terms.principal > data.maxPrincipal)
        throw new Error(
          `This route limits each order to ${amount(data.maxPrincipal)} bUSD.`,
        );
      if (terms.principal > data.remainingCapacity)
        throw new Error(
          "The route's escrow exposure cap is reached. Wait for existing claims to clear.",
        );
      const fee = (await read(
        route,
        "source",
        route.escrow,
        sourceAbi,
        "quoteCreate",
        [terms, GAS],
      )) as bigint;
      if (
        context !== identity.current ||
        walletGeneration !== generation.current
      )
        return;
      setAccepted(false);
      setError("");
      const selfSolving = equal(terms.owner, terms.solver);
      const protection = calculateTradePlan({
        principal: formatUnits(
          selfSolving ? terms.amountIn : terms.principal,
          6,
        ),
        amountIn: formatUnits(terms.amountIn, 6),
        minOutput: formatUnits(terms.minOutput, 18),
        oraclePrice: terms.maxPrice,
        feeBudgetUsd,
      });
      reviewOpener.current = document.activeElement as HTMLElement;
      setAcceptedProtection(false);
      setReview({
        terms,
        protection,
        selfSolving,
        fee,
        budget: fee + fee / 5n + 1n,
        action: {
          label: "Create order",
          side: "source",
          address: route.escrow,
          abi: sourceAbi,
          functionName: "createOrder",
          args: [terms, GAS],
        },
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  function saveDraft() {
    setNotice("");
    const draft = parseOrderDraft({
      principal,
      amountIn: solverInput,
      minOutput: minimum,
      maxPrice: trigger,
      hours,
      recipient,
      solver,
    });
    if (!draft) {
      setError(
        "Enter valid amounts, expiry and wallet addresses before saving a draft.",
      );
      return;
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
      setSavedDraft(draft);
      setError("");
      setNotice(
        "Draft saved in this browser for this route. No transaction was submitted.",
      );
    } catch {
      setError(
        "This browser could not save the draft. Check local storage permissions.",
      );
    }
  }

  function restoreDraft() {
    if (!savedDraft) return;
    setError("");
    setPrincipal(savedDraft.principal);
    setSolverInput(savedDraft.amountIn);
    setMinimum(savedDraft.minOutput);
    setTrigger(savedDraft.maxPrice);
    setHours(savedDraft.hours);
    setRecipient(savedDraft.recipient);
    setSolver(savedDraft.solver);
    setReview(undefined);
    setAccepted(false);
    setNotice(
      "Saved draft restored. Balances, fees and expiry will be checked again before signing.",
    );
  }

  function exportOrders() {
    if (!route || !data) return;
    const url = URL.createObjectURL(
      new Blob([ordersCsv(data.rows, route.id)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bisharp-${route.id}-page-${page + 1}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!route)
    return (
      <main className="config-error">
        <h1>Check route configuration</h1>
        <p role="alert">{routesConfig.error || "No routes configured."}</p>
      </main>
    );
  const disabled = Boolean(busy || !account);
  const summary = summarizeOrders(data?.rows || [], now, account);
  const protectionDelta =
    review?.protection?.minimumValueDeltaAfterFeesUsd ??
    review?.protection?.minimumValueDeltaUsd;
  const protectionShortfall =
    protectionDelta !== undefined &&
    protectionDelta !== null &&
    protectionDelta < 0n;
  const visibleRows = (data?.rows || []).filter((row) => {
    const insight = getOrderInsight(row, now, account);
    const matchesFilter =
      activityFilter === "all" ||
      (activityFilter === "action"
        ? insight.needsAction
        : activityFilter === "active"
          ? insight.category !== "complete" && insight.category !== "claim"
          : insight.category === "complete");
    const query = orderSearch.trim().toLowerCase().replace(/^#/, "");
    return (
      matchesFilter &&
      (!query ||
        [
          String(row.id),
          row.source.terms.owner,
          row.source.terms.recipient,
          row.source.terms.solver,
        ].some((value) => value.toLowerCase().includes(query)))
    );
  });
  const sourceLink = (address: Address) =>
    `${explorer(route, "source")}/address/${address}`;
  const destinationLink = (address: Address) =>
    `${explorer(route, "destination")}/address/${address}`;
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to trading workspace
      </a>
      <header className="topbar app-topbar">
        <a className="brand" href="/" aria-label="Bisharp home">
          <BrandMark />
          bisharp<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main">
          <a className="nav-active" href="#workspace">
            Trade
          </a>
          <a href="#activity">Activity</a>
          <Link
            href="/how-it-works"
            target="_blank"
            rel="noopener"
            aria-label="How it works (opens in a new tab)"
          >
            How it works <span aria-hidden="true">↗</span>
          </Link>
        </nav>
        <div className="header-actions">
          <span className="network">
            <span />
            Testnets only
          </span>
          <button
            className="wallet-button"
            disabled={Boolean(busy)}
            onClick={connect}
          >
            {account ? shortAddress(account) : "Connect wallet"}
          </button>
        </div>
      </header>
      <main className="trading-app" id="workspace">
        <section className="app-page-heading">
          <div>
            <h1>Cross-chain orders</h1>
            <p>Create an order, check your costs, and follow its settlement.</p>
          </div>
          <span className={`app-route-state${routeReady ? " is-ready" : ""}`}>
            <span aria-hidden="true" />
            {routeReady
              ? "Route ready"
              : awaitingPairing
                ? "Awaiting activation"
                : refreshing
                  ? "Checking route…"
                  : "Route unavailable"}
          </span>
        </section>
        <details className="test-banner app-test-notice">
          <summary>
            <span className="small-tag">Testnet only</span>
            <span>bUSD is an unbacked test token.</span>
            <span className="app-notice-detail">
              Network & settlement notes
            </span>
          </summary>
          <p>
            This is an unaudited release candidate. There are no guaranteed
            fills or refund timing during messaging outages. OP Sepolia has no
            sequencer-uptime signal configured.
          </p>
        </details>
        {localRoute(route) && (
          <div className="alert" role="status">
            <strong>Local fixture mode.</strong> Both chains run in Anvil.
            Transport is an unauthenticated mock and the oracle is fixed at
            $2,000. CCIP fee/message labels below refer to this simulated
            transport. This is not live Chainlink execution evidence. Use Anvil
            development accounts only.
          </div>
        )}
        {localRoute(route) && (
          <div className="setup-note">
            Local gas is free.{" "}
            <button
              className="text-button"
              disabled={!account || Boolean(busy)}
              onClick={localGas}
            >
              Set 10 local ETH on both chains
            </button>{" "}
            Then mint source and destination bUSD under “Funding & recovery”.
          </div>
        )}
        <div className="route-selector">
          <label id="route-label" htmlFor="route">
            Settlement route
          </label>
          <SelectField
            id="route"
            labelId="route-label"
            disabled={Boolean(busy)}
            value={String(routeIndex)}
            options={routesConfig.routes.map((r, i) => ({
              value: String(i),
              label: r.label,
              description: !r.configured
                ? "Not deployed"
                : i === routeIndex && awaitingPairing
                  ? "Awaiting activation"
                  : i === routeIndex && routeReady
                    ? "Ready to trade"
                    : "Testnet route",
            }))}
            hint={
              routesConfig.routes.length === 1
                ? "This is the only route currently listed."
                : "Choose where your order starts and settles."
            }
            onChange={(value) => {
              setRouteIndex(Number(value));
              setData(undefined);
              setDest(undefined);
              setSourceError("");
              setDestError("");
              setReview(undefined);
              setPage(0);
              setError("");
              setNotice("");
            }}
          />
          <span className="wallet-network">
            Wallet:{" "}
            {chainId
              ? networks[chainId as keyof typeof networks]?.chain.name ||
                `Unsupported network (${chainId})`
              : "not connected"}
          </span>
        </div>
        {!route.configured && (
          <div className="setup-note">
            <strong>This route is not available yet.</strong> Choose a deployed
            settlement route to load balances and create orders.
          </div>
        )}
        {awaitingPairing && (
          <section
            className="route-status"
            aria-labelledby="route-status-title"
          >
            <div className="route-status-icon" aria-hidden="true">
              ↔
            </div>
            <div className="route-status-copy">
              <p
                id="route-status-title"
                className="route-status-title"
                role="status"
              >
                Route awaiting activation
              </p>
              <p>
                The contracts are deployed, but their cross-chain connection is
                not complete. Trading will unlock once the route operator
                finishes setup. No wallet action is needed.
              </p>
              <details className="route-status-details">
                <summary>View route details</summary>
                <ul>
                  <li>
                    <span>{route.source.chain.name}</span>
                    <span>
                      {sourceFresh
                        ? data?.pairing === "pending"
                          ? "Awaiting pairing"
                          : "Paired"
                        : "Not verified"}
                    </span>
                    {route.escrow && (
                      <a
                        href={sourceLink(route.escrow)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View source contract ↗
                      </a>
                    )}
                  </li>
                  <li>
                    <span>{route.destination.chain.name}</span>
                    <span>
                      {destFresh
                        ? dest?.pairing === "pending"
                          ? "Awaiting pairing"
                          : "Paired"
                        : "Not verified"}
                    </span>
                    {route.executor && (
                      <a
                        href={destinationLink(route.executor)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View destination contract ↗
                      </a>
                    )}
                  </li>
                </ul>
              </details>
            </div>
            <button
              type="button"
              className="refresh-button"
              disabled={refreshing || Boolean(busy)}
              onClick={() => void refresh()}
            >
              {refreshing ? "Checking…" : "Check again"}
            </button>
          </section>
        )}
        {sourceError && (
          <div role="alert" className="alert">
            <strong>Source unavailable.</strong> {sourceError}
            <button
              type="button"
              disabled={refreshing || Boolean(busy)}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        )}
        {destError && (
          <div role="alert" className="alert">
            <strong>Destination unavailable.</strong> {destError} Source
            recovery remains available when the source is healthy.
            <button
              type="button"
              disabled={refreshing || Boolean(busy)}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {((data && !sourceFresh) || (dest && !destFresh)) &&
          !sourceError &&
          !destError && (
            <div className="alert" role="status">
              Data is stale. Refresh before sending transactions.
            </div>
          )}
        <div className="workspace-grid">
          <section className="order-panel" aria-label="Create an order">
            <div className="panel-heading">
              <div>
                <h2>Create an order</h2>
                <p>
                  {route.source.chain.name} to {route.destination.chain.name}
                </p>
              </div>
              <span className="small-tag">Buy WETH</span>
            </div>
            <form onSubmit={create}>
              <div className="amount-box">
                <div className="field-top">
                  <label htmlFor="principal">You escrow on source</label>
                  <span>
                    {data && account
                      ? `${amount(data.balance)} bUSD available`
                      : "Connect to load balance"}
                  </span>
                </div>
                <div className="amount-row">
                  <input
                    id="principal"
                    inputMode="decimal"
                    value={principal}
                    onChange={(e) => setPrincipal(e.target.value)}
                    required
                  />
                  <span className="token-pill">
                    <span aria-hidden="true">$</span>bUSD
                  </span>
                </div>
                <span className="field-foot">
                  Exact principal. Separate native message fees and gas.
                </span>
              </div>
              <div className="flow-divider">
                <span aria-hidden="true">↓</span> Solver-funded delivery through
                Uniswap v3
              </div>
              <div className="split-fields">
                <div>
                  <label htmlFor="solver-input">
                    Solver spends (destination bUSD)
                  </label>
                  <input
                    className="recipient-input"
                    id="solver-input"
                    inputMode="decimal"
                    value={solverInput}
                    onChange={(e) => setSolverInput(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="min-output">Minimum received (WETH)</label>
                  <input
                    className="recipient-input"
                    id="min-output"
                    inputMode="decimal"
                    value={minimum}
                    onChange={(e) => setMinimum(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="split-fields">
                <div>
                  <label htmlFor="trigger">ETH/USD at or below ($)</label>
                  <input
                    className="recipient-input"
                    id="trigger"
                    inputMode="decimal"
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label id="expiry-label" htmlFor="expiry">
                    Expires in
                  </label>
                  <SelectField
                    id="expiry"
                    labelId="expiry-label"
                    value={String(hours)}
                    options={[
                      { value: "1", label: "1 hour" },
                      { value: "24", label: "24 hours" },
                      { value: "72", label: "3 days" },
                      { value: "168", label: "7 days" },
                    ]}
                    onChange={(value) => setHours(Number(value))}
                    disabled={Boolean(busy)}
                  />
                </div>
              </div>
              <label className="recipient-label" htmlFor="recipient">
                Destination recipient <span>Defaults to your wallet</span>
              </label>
              <input
                className="recipient-input"
                id="recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
              />
              <label className="recipient-label spaced" htmlFor="solver">
                Designated solver{" "}
                <span>Fixed funding and source payout identity</span>
              </label>
              <input
                className="recipient-input"
                id="solver"
                value={solver}
                onChange={(e) => setSolver(e.target.value)}
                placeholder={route.solver || account || "0x…"}
                spellCheck={false}
              />
              <div className="order-facts">
                <span>
                  Quote model
                  <strong>
                    Manually agreed terms · no signed solver quote
                  </strong>
                </span>
                <span>
                  Protocol fee<strong>0 bUSD</strong>
                </span>
                <span>
                  Source gas and CCIP fee
                  <strong>Native test ETH, quoted before signing</strong>
                </span>
              </div>
              <div className="draft-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(busy)}
                  onClick={saveDraft}
                >
                  Save draft
                </button>
                {savedDraft && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={restoreDraft}
                  >
                    Restore saved draft
                  </button>
                )}
                <span>Saved only in this browser, for this route.</span>
              </div>
              {account ? (
                <button
                  type="submit"
                  className="primary full"
                  disabled={disabled || !routeReady}
                >
                  {awaitingPairing
                    ? "Awaiting route activation"
                    : !routeReady
                      ? "Route unavailable"
                      : "Review exact terms"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary full"
                  onClick={connect}
                >
                  Connect wallet
                </button>
              )}
              <p className="form-caption">
                Approval and creation are separate transactions.
              </p>
            </form>
          </section>
          <div className="right-column">
            <section className="market-panel">
              <div className="market-top">
                <div>
                  <h2>Destination ETH / USD</h2>
                  <p>On-chain eligibility reference</p>
                </div>
                <span
                  className={`live-label ${destFresh && dest?.price ? "is-live" : ""}`}
                >
                  {destFresh && dest?.price ? "Fresh" : "Unavailable"}
                </span>
              </div>
              <div className="market-price">
                {dest?.price ? `$${amount(dest.price, 18, 2)}` : "—"}
              </div>
              <p className="price-explainer">
                {dest && dest.price === null
                  ? "Oracle checks failed. Fills are blocked; expiry, receipt retries and claims remain available."
                  : "A trigger does not guarantee an executable pool price. The contract also enforces your minimum output."}
              </p>
              {dest && (
                <div className="market-footer">
                  <a
                    href={destinationLink(dest.feed)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Feed ↗
                  </a>
                  <a
                    href={destinationLink(dest.pool)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Uniswap pool ↗
                  </a>
                </div>
              )}
            </section>
            <TradeCheck
              principal={principal}
              amountIn={solverInput}
              minOutput={minimum}
              livePrice={destFresh ? (dest?.price ?? null) : null}
              onMinimum={setMinimum}
              disabled={Boolean(busy)}
              feeBudget={feeBudgetUsd}
              onFeeBudget={setFeeBudgetUsd}
              selfSolving={Boolean(
                account && equal(solver || route.solver || account, account),
              )}
            />
            <section className="balances-panel">
              <h2>Funding & recovery</h2>
              <div className="balance-line">
                <span>Source bUSD</span>
                <strong>{data && account ? amount(data.balance) : "—"}</strong>
              </div>
              <div className="balance-line">
                <span>Destination solver bUSD</span>
                <strong>{dest && account ? amount(dest.balance) : "—"}</strong>
              </div>
              <div className="balance-line">
                <span>Earned source credits</span>
                <strong>{data && account ? amount(data.credits) : "—"}</strong>
              </div>
              <p className="solver-help">
                Claim each eligible order below. Destination liquidity belongs
                to the solver; no user principal is bridged.
              </p>
              <details className="faucet">
                <summary>Test-token faucets and fee refunds</summary>
                <p>
                  Mint test bUSD on each chain. Gas requires native test ETH on
                  that same chain.
                </p>
                <div>
                  <button
                    className="text-button"
                    disabled={disabled || !sourceReady}
                    onClick={() =>
                      data &&
                      send({
                        label: "Mint source bUSD",
                        side: "source",
                        address: data.token,
                        abi: tokenAbi,
                        functionName: "faucet",
                        args: [],
                      })
                    }
                  >
                    Mint source
                  </button>
                  <button
                    className="text-button"
                    disabled={disabled || !destReady}
                    onClick={() =>
                      dest &&
                      send({
                        label: "Mint destination bUSD",
                        side: "destination",
                        address: dest.token,
                        abi: tokenAbi,
                        functionName: "faucet",
                        args: [],
                      })
                    }
                  >
                    Mint destination
                  </button>
                </div>
                {data && data.nativeCredit > 0n && (
                  <button
                    className="text-button"
                    disabled={disabled || !sourceReady}
                    onClick={() =>
                      route.escrow &&
                      send({
                        label: "Claim source fee change",
                        side: "source",
                        address: route.escrow,
                        abi: sourceAbi,
                        functionName: "claimNative",
                        args: [account],
                      })
                    }
                  >
                    Source fee change: {formatUnits(data.nativeCredit, 18)} ETH
                  </button>
                )}
                {dest && dest.nativeCredit > 0n && (
                  <button
                    className="text-button"
                    disabled={disabled || !destReady}
                    onClick={() =>
                      route.executor &&
                      send({
                        label: "Claim destination fee change",
                        side: "destination",
                        address: route.executor,
                        abi: destinationAbi,
                        functionName: "claimNative",
                        args: [account],
                      })
                    }
                  >
                    Destination fee change: {formatUnits(dest.nativeCredit, 18)}{" "}
                    ETH
                  </button>
                )}
              </details>
            </section>
          </div>
        </div>

        <section className="orders-panel" id="activity" data-reveal>
          <div className="orders-heading">
            <div>
              <h2>Cross-chain order activity</h2>
              <p>
                Each chain is read independently. Local receipt confirmation is
                not cross-chain settlement.
              </p>
            </div>
            <button
              className="refresh-button"
              disabled={Boolean(busy) || refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh ↻"}
            </button>
          </div>
          <div className="tabs">
            <button
              className={view === "mine" ? "selected" : ""}
              aria-pressed={view === "mine"}
              onClick={() => {
                setView("mine");
                setPage(0);
                setData(undefined);
              }}
            >
              Your orders
            </button>
            <button
              className={view === "all" ? "selected" : ""}
              aria-pressed={view === "all"}
              onClick={() => {
                setView("all");
                setPage(0);
                setData(undefined);
              }}
            >
              All orders / solver
            </button>
          </div>
          <div className="activity-tools">
            <div className="activity-summary" aria-label="Summary of this page">
              <span>
                <strong>
                  {data ? `${amount(summary.lockedPrincipal)} bUSD` : "—"}
                </strong>{" "}
                still locked
              </span>
              <span>
                <strong>
                  {account
                    ? data
                      ? `${amount(summary.myClaimablePrincipal)} bUSD`
                      : "—"
                    : "Connect wallet"}
                </strong>{" "}
                {account ? "claimable to you" : "to see your claims"}
              </span>
              <span>
                <strong>{data ? summary.needsAction : "—"}</strong> need a next
                step
              </span>
            </div>
            <p className="activity-scope">
              Summary, filters and export cover this page of up to 10 orders.
              Use Older to inspect earlier orders.
            </p>
            <div className="activity-controls">
              <div>
                <label htmlFor="order-search">Search this page</label>
                <input
                  id="order-search"
                  className="recipient-input"
                  type="search"
                  maxLength={100}
                  placeholder="Order ID or wallet address"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>
              <div>
                <label id="activity-filter-label" htmlFor="activity-filter">
                  Show orders
                </label>
                <SelectField
                  id="activity-filter"
                  labelId="activity-filter-label"
                  value={activityFilter}
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "action", label: "Next step available" },
                    { value: "active", label: "In progress" },
                    { value: "complete", label: "Claim transferred" },
                  ]}
                  onChange={setActivityFilter}
                />
              </div>
              <button
                type="button"
                className="secondary compact"
                disabled={!data?.rows.length}
                onClick={exportOrders}
              >
                Export page CSV
              </button>
            </div>
          </div>
          {!data?.rows.length ? (
            <div className="empty-state">
              <div className="empty-icon">⇄</div>
              <h3>
                {refreshing && !data
                  ? "Loading orders…"
                  : sourceError
                    ? "Orders could not load"
                    : !route.configured
                      ? "Route not available yet"
                      : account
                        ? "No orders on this page"
                        : "Connect to see your orders"}
              </h3>
              <p>
                {sourceError
                  ? "Retry the source connection above. Your on-chain orders are unchanged."
                  : "Create an order or switch to all orders to inspect solver opportunities."}
              </p>
            </div>
          ) : !visibleRows.length ? (
            <div className="empty-state">
              <h3>No matching orders on this page</h3>
              <p>
                Try another status, clear your search, or use the page controls
                below.
              </p>
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  setOrderSearch("");
                  setActivityFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="cross-order-list">
              {visibleRows.map((row) => {
                const s = row.source,
                  d = row.destination,
                  expired = now >= Number(s.terms.deadline) * 1000;
                const final = s.state === 3 || s.state === 4;
                const beneficiary =
                  s.state === 3 ? s.terms.solver : s.terms.owner;
                const canCancel = equal(account, s.terms.owner) || expired;
                const assigned = equal(account, s.terms.solver);
                const insight = getOrderInsight(row, now, account);
                const sourceAction = (
                  functionName: string,
                  text: string,
                  args: readonly unknown[] = [row.id],
                ): Action => ({
                  label: text,
                  side: "source",
                  address: route.escrow!,
                  abi: sourceAbi,
                  functionName,
                  args,
                });
                return (
                  <article key={String(row.id)} className="cross-order">
                    <div className="cross-order-header">
                      <h3>
                        Order #{String(row.id)}{" "}
                        <span>
                          {amount(s.terms.principal)} bUSD → ≥{" "}
                          {amount(s.terms.minOutput, 18, 10)} WETH
                        </span>
                      </h3>
                      <span
                        className={`status ${s.state === 3 ? "status-2" : s.state === 4 ? "status-3" : ""}`}
                      >
                        {s.claimed ? "Claim transferred" : label(s.state)}
                      </span>
                    </div>
                    <div className="cross-stages">
                      <div>
                        <span>{route.source.chain.name}</span>
                        <strong>
                          {s.claimed
                            ? `Paid to ${shortAddress(beneficiary)}`
                            : final
                              ? "Credit ready to claim"
                              : s.state === 2
                                ? "Cancel request sent · funds locked"
                                : "Principal locked"}
                        </strong>
                      </div>
                      <span aria-hidden="true">⇄</span>
                      <div>
                        <span>{route.destination.chain.name}</span>
                        <strong>
                          {d
                            ? d.state === 0
                              ? "Awaiting CREATE message"
                              : d.state === 3
                                ? "Swap delivered · receipt can be sent"
                                : d.state === 4
                                  ? "Permanently cancelled"
                                  : expired
                                    ? "Expired · close before refund"
                                    : "Registered · awaiting solver"
                            : "Destination state unavailable"}
                        </strong>
                      </div>
                    </div>
                    <div
                      className={`order-next-step ${insight.needsAction ? "has-next-step" : ""}`}
                    >
                      <strong>{insight.title}</strong>
                      <p>{insight.detail}</p>
                    </div>
                    <p className="order-meta">
                      Trigger ≤ ${amount(s.terms.maxPrice, 18, 2)} · Solver
                      spends {amount(s.terms.amountIn)} bUSD · Expires{" "}
                      {new Date(
                        Number(s.terms.deadline) * 1000,
                      ).toLocaleString()}
                      <br />
                      Recipient{" "}
                      <a
                        href={destinationLink(s.terms.recipient)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.terms.recipient}
                      </a>
                      <br />
                      Solver / source payout{" "}
                      <a
                        href={sourceLink(s.terms.solver)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.terms.solver}
                      </a>
                    </p>
                    <div className="row-actions wrap-actions">
                      {!final && canCancel && (
                        <button
                          className="secondary compact"
                          disabled={disabled || !sourceReady}
                          onClick={() =>
                            reviewAction(
                              sourceAction(
                                "requestCancel",
                                "Request cancellation",
                                [row.id, GAS],
                              ),
                              "quoteAction",
                              [row.id, true, GAS],
                            )
                          }
                        >
                          {s.state === 2
                            ? "Resend cancellation"
                            : "Request cancellation"}
                        </button>
                      )}
                      {!final && (
                        <button
                          className="secondary compact"
                          disabled={disabled || !sourceReady}
                          onClick={() =>
                            reviewAction(
                              sourceAction(
                                "resendCreate",
                                "Resend registration",
                                [row.id, GAS],
                              ),
                              "quoteAction",
                              [row.id, false, GAS],
                            )
                          }
                        >
                          Resend CREATE
                        </button>
                      )}
                      {d?.state === 1 && expired && (
                        <button
                          className="secondary compact"
                          disabled={disabled || !destReady}
                          onClick={() =>
                            route.executor &&
                            send({
                              label: "Close expired destination order",
                              side: "destination",
                              address: route.executor,
                              abi: destinationAbi,
                              functionName: "expireOrder",
                              args: [row.id],
                            })
                          }
                        >
                          Close on destination
                        </button>
                      )}
                      {d?.state === 1 && !expired && assigned && (
                        <button
                          className="primary compact"
                          disabled={
                            disabled ||
                            !destReady ||
                            !dest?.price ||
                            dest.price > s.terms.maxPrice ||
                            dest.balance < s.terms.amountIn
                          }
                          onClick={() =>
                            dest &&
                            route.executor &&
                            send(
                              dest.allowance < s.terms.amountIn
                                ? {
                                    label: "Approve solver input",
                                    side: "destination",
                                    address: dest.token,
                                    abi: tokenAbi,
                                    functionName: "approve",
                                    args: [route.executor, s.terms.amountIn],
                                  }
                                : {
                                    label: "Execute Uniswap fill",
                                    side: "destination",
                                    address: route.executor,
                                    abi: destinationAbi,
                                    functionName: "fillOrder",
                                    args: [row.id],
                                  },
                            )
                          }
                        >
                          {dest && dest.allowance < s.terms.amountIn
                            ? "Approve solver bUSD"
                            : "Execute Uniswap fill"}
                        </button>
                      )}
                      {d && (d.state === 3 || d.state === 4) && !final && (
                        <button
                          className="primary compact"
                          disabled={disabled || !destReady}
                          onClick={() =>
                            route.executor &&
                            reviewAction(
                              {
                                label: "Dispatch terminal receipt",
                                side: "destination",
                                address: route.executor,
                                abi: destinationAbi,
                                functionName: "dispatchReceipt",
                                args: [row.id, RECEIPT_GAS],
                              },
                              "quoteReceipt",
                              [row.id, RECEIPT_GAS],
                            )
                          }
                        >
                          Send / retry receipt
                        </button>
                      )}
                      {final && !s.claimed && (
                        <button
                          className="primary compact"
                          disabled={disabled || !sourceReady}
                          onClick={() =>
                            send(
                              sourceAction(
                                "claim",
                                s.state === 3
                                  ? "Claim solver payment"
                                  : "Claim refund",
                              ),
                            )
                          }
                        >
                          Claim {s.state === 3 ? "solver payment" : "refund"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <div className="pagination">
            <button
              className="secondary compact"
              disabled={page === 0 || Boolean(busy)}
              onClick={() => {
                setPage((p) => p - 1);
                setData(undefined);
              }}
            >
              Newer
            </button>
            <span>
              Page {page + 1} · {data ? String(data.count) : "—"}{" "}
              {view === "mine" ? "owner" : "total"} orders
            </span>
            <button
              className="secondary compact"
              disabled={
                !data || BigInt((page + 1) * 10) >= data.count || Boolean(busy)
              }
              onClick={() => {
                setPage((p) => p + 1);
                setData(undefined);
              }}
            >
              Older
            </button>
          </div>
          <div className="orders-footer">
            <span>
              Source block {data ? String(data.block) : "—"} ·{" "}
              {data
                ? `${Math.max(0, Math.floor((now - data.at) / 1000))}s ago`
                : "not read"}
            </span>
            <span>
              Destination block {dest ? String(dest.block) : "—"} ·{" "}
              {dest
                ? `${Math.max(0, Math.floor((now - dest.at) / 1000))}s ago`
                : "not read"}
            </span>
          </div>
        </section>
        {transactions.length > 0 && (
          <section className="transactions">
            <h2>Transactions & CCIP messages</h2>
            <div>
              {transactions.map((tx) => (
                <div className="transaction-row" key={tx.hash}>
                  <a
                    href={`${explorer(route, tx.chainId === route.source.chain.id ? "source" : "destination")}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>
                      {tx.label}
                      <small>
                        {shortAddress(tx.hash)} · chain {tx.chainId}
                      </small>
                    </span>
                    <span>{tx.state} ↗</span>
                  </a>
                  {tx.messages.map((id) => (
                    <a
                      key={id}
                      href={
                        localRoute(route)
                          ? `${explorer(route, tx.chainId === route.source.chain.id ? "source" : "destination")}/tx/${tx.hash}`
                          : `https://ccip.chain.link/msg/${id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {localRoute(route)
                        ? "Local transport message"
                        : "CCIP delivery"}
                      : {shortAddress(id)} ↗
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}
        <footer className="app-footer">
          <a className="footer-brand" href="/" aria-label="Bisharp home">
            <BrandMark />
            bisharp.
          </a>
          <span>
            Unaudited testnet release candidate · no production guarantees
          </span>
          <div>
            <Link
              href="/how-it-works"
              target="_blank"
              rel="noopener"
              aria-label="How it works (opens in a new tab)"
            >
              How it works ↗
            </Link>
            {route.escrow && (
              <a
                href={sourceLink(route.escrow)}
                target="_blank"
                rel="noreferrer"
              >
                Source escrow ↗
              </a>
            )}
            {route.executor && (
              <a
                href={destinationLink(route.executor)}
                target="_blank"
                rel="noreferrer"
              >
                Destination executor ↗
              </a>
            )}
          </div>
        </footer>
      </main>
      {review && (
        <div className="modal-backdrop">
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setReview(undefined);
              if (e.key === "Tab") {
                const elements = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), input:not(:disabled), a[href]",
                  ),
                );
                const first = elements[0],
                  last = elements[elements.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="panel-heading">
              <div>
                <h2 id="review-title">{review.action.label}</h2>
                <p>{route[review.action.side].chain.name}</p>
              </div>
              <button
                className="icon-button"
                autoFocus
                disabled={Boolean(busy)}
                onClick={() => setReview(undefined)}
                aria-label="Close review"
              >
                ×
              </button>
            </div>
            <dl className="review-details">
              {review.terms && (
                <>
                  <div>
                    <dt>Source principal</dt>
                    <dd>{formatUnits(review.terms.principal, 6)} bUSD</dd>
                  </div>
                  <div>
                    <dt>Solver spends</dt>
                    <dd>
                      {formatUnits(review.terms.amountIn, 6)} destination bUSD
                    </dd>
                  </div>
                  <div>
                    <dt>Minimum output</dt>
                    <dd>{formatUnits(review.terms.minOutput, 18)} WETH</dd>
                  </div>
                  <div>
                    <dt>Trigger price</dt>
                    <dd>≤ ${formatUnits(review.terms.maxPrice, 18)}</dd>
                  </div>
                  <div>
                    <dt>Recipient</dt>
                    <dd className="wrap-address">{review.terms.recipient}</dd>
                  </div>
                  <div>
                    <dt>Solver and payout</dt>
                    <dd className="wrap-address">{review.terms.solver}</dd>
                  </div>
                  <div>
                    <dt>Expiry (local time)</dt>
                    <dd>
                      {new Date(
                        Number(review.terms.deadline) * 1000,
                      ).toLocaleString()}
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt>CCIP fee quote</dt>
                <dd>{formatUnits(review.fee, 18)} native ETH</dd>
              </div>
              <div>
                <dt>Maximum fee funding</dt>
                <dd>{formatUnits(review.budget, 18)} native ETH</dd>
              </div>
              <div>
                <dt>Network gas</dt>
                <dd>Separate · wallet estimate</dd>
              </div>
            </dl>
            {review.terms && review.protection && (
              <div className="review-protection">
                <h3>Minimum protection check</h3>
                <p>
                  At your ${formatUnits(review.terms.maxPrice, 18)} trigger
                  reference, the accepted minimum is worth{" "}
                  <strong>
                    ${formatDecimal(review.protection.minimumValueUsd ?? 0n, 6)}
                  </strong>{" "}
                  against{" "}
                  {formatDecimal(
                    review.protection.totalCostUsd ??
                      review.protection.principal,
                    6,
                  )}{" "}
                  {review.protection.totalCostUsd === null
                    ? "bUSD of input cost, before fees"
                    : "USD of input cost and your fee estimate"}
                  .
                </p>
                {review.selfSolving && (
                  <p>
                    You supply destination inventory as the solver. Source
                    principal stays locked until settlement, then returns to you
                    as solver payment.
                  </p>
                )}
                <p>
                  A fill may deliver only the accepted minimum. Lower prices
                  reduce its reference value. USD math assumes bUSD = $1; this
                  is not a promise of returns or a fill.
                </p>
                {review.protection.feeBudgetUsd !== null && (
                  <p>
                    Your fee scenario: $
                    {formatDecimal(review.protection.feeBudgetUsd, 6)} total.
                    This estimate does not cap transaction fees.
                  </p>
                )}
                {protectionShortfall && (
                  <label className="accept-terms">
                    <input
                      type="checkbox"
                      checked={acceptedProtection}
                      onChange={(e) => setAcceptedProtection(e.target.checked)}
                    />
                    I understand the minimum permits a value $
                    {formatDecimal(-protectionDelta!, 6)} below this cost at the
                    trigger reference.
                  </label>
                )}
              </div>
            )}
            <p className="modal-warning">
              Unspent fee funding becomes a claimable native credit. Message
              fees already spent are nonrefundable. A cancellation request is
              not a refund; a confirmed destination fill can win. There is no
              guaranteed fill or recovery time during an outage.
            </p>
            <label className="accept-terms">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I accept these exact terms and understand the asynchronous
              settlement risk.
            </label>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="modal-status" role="status">
                {notice}
              </p>
            )}
            <button
              className="primary full"
              disabled={
                disabled ||
                !accepted ||
                (protectionShortfall && !acceptedProtection) ||
                (review.action.side === "source" ? !sourceReady : !destReady) ||
                Boolean(review.terms && !routeReady) ||
                Boolean(
                  review.terms &&
                    Number(review.terms.deadline) * 1000 <= now + 300000,
                )
              }
              onClick={() =>
                review.terms &&
                data &&
                route.escrow &&
                data.allowance < review.terms.principal
                  ? send({
                      label: "Approve exact source bUSD",
                      side: "source",
                      address: data.token,
                      abi: tokenAbi,
                      functionName: "approve",
                      args: [route.escrow, review.terms.principal],
                    })
                  : send(review.action, review.budget)
              }
            >
              {busy ||
                (review.terms && data && data.allowance < review.terms.principal
                  ? "Approve exact bUSD (then review again)"
                  : `Confirm on ${route[review.action.side].chain.name}`)}
            </button>
            <p className="token-identities">
              Source token: {data?.token || "unavailable"}
              <br />
              Destination input: {dest?.token || "unavailable"}
              <br />
              Destination output: {dest?.output || "unavailable"}
              <br />
              Source contract: {route.escrow}
              <br />
              Destination contract: {route.executor}
            </p>
          </section>
        </div>
      )}
    </>
  );
}
