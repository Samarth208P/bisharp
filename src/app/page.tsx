"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { configuredRoutes, type Route } from "@/lib/routes";
import { orderInput, type Terms } from "@/lib/order-input";
import { tokenAbi, shortAddress } from "@/lib/web3";

type Record = {
  terms: Terms;
  termsHash: Hash;
  state: number;
  claimed: boolean;
};
type Row = { id: bigint; source: Record; destination: Record | null };
type Data = {
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
type Tx = {
  hash: Hash;
  chainId: number;
  label: string;
  state: "pending" | "confirmed" | "failed";
  messages: Hash[];
};
type Action = {
  label: string;
  side: "source" | "destination";
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};
type Review = { action: Action; terms?: Terms; fee: bigint; budget: bigint };
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
  const [chainId, setChainId] = useState<number>();
  const [data, setData] = useState<Data>();
  const [dest, setDest] = useState<Destination>();
  const [sourceError, setSourceError] = useState("");
  const [destError, setDestError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"mine" | "all">("mine");
  const [principal, setPrincipal] = useState("5");
  const [solverInput, setSolverInput] = useState("5");
  const [minimum, setMinimum] = useState("0.0015");
  const [trigger, setTrigger] = useState("2500");
  const [hours, setHours] = useState(24);
  const [recipient, setRecipient] = useState("");
  const [solver, setSolver] = useState("");
  const [review, setReview] = useState<Review>();
  const [accepted, setAccepted] = useState(false);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const lock = useRef(false);
  const generation = useRef(0);
  const refreshLock = useRef(false);
  const identity = useRef("");
  identity.current = `${route?.id}:${account}:${page}:${view}`;
  const storageKey = `bisharp:cross:${route?.source.chain.id}:${route?.escrow}:${route?.destination.chain.id}:${route?.executor}`;
  const sourceReady = Boolean(
    route?.configured && data && !sourceError && now - data.at < 45000,
  );
  const destReady = Boolean(
    route?.configured && dest && !destError && now - dest.at < 45000,
  );

  const refresh = useCallback(async () => {
    if (
      !route?.configured ||
      !route.escrow ||
      !route.executor ||
      refreshLock.current
    )
      return;
    refreshLock.current = true;
    const key = `${route.id}:${account}:${page}:${view}`;
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
        if (
          !equal(peer as Address, route.executor) ||
          local !== route.source.selector ||
          remote !== route.destination.selector
        )
          throw new Error(
            "Source pairing/selectors do not match the selected route. Writes are disabled.",
          );
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
          get("localSelector"),
          get("remoteSelector"),
          get("priceFeed"),
          get("pool"),
          get("nativeCredits", [account || ZERO]),
          get("currentPrice").catch(() => null),
        ]);
        if (
          !equal(peer as Address, route.escrow) ||
          local !== route.destination.selector ||
          remote !== route.source.selector
        )
          throw new Error(
            "Destination pairing/selectors do not match the selected route.",
          );
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
      const [s, d] = await Promise.allSettled([sourceTask(), destTask()]);
      if (key !== identity.current) return;
      if (s.status === "fulfilled") {
        if (d.status === "fulfilled") {
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
          if (key !== identity.current) return;
          s.value.rows.forEach((row, i) => {
            const result = results[i];
            row.destination =
              result.status === "fulfilled" ? (result.value as Record) : null;
          });
        }
        setData(s.value);
        setSourceError("");
      } else setSourceError(errorText(s.reason));
      if (d.status === "fulfilled") {
        setDest(d.value);
        setDestError("");
      } else setDestError(errorText(d.reason));
    } finally {
      refreshLock.current = false;
    }
  }, [route, account, page, view]);

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
      if (!provider) return;
      try {
        const [accounts, id] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (generation.current === version) {
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
        Array.isArray(value)
          ? value
              .filter(
                (t) =>
                  t &&
                  /^0x[0-9a-fA-F]{64}$/.test(t.hash) &&
                  typeof t.label === "string" &&
                  [
                    route?.source.chain.id,
                    route?.destination.chain.id,
                  ].includes(t.chainId) &&
                  ["pending", "confirmed", "failed"].includes(t.state) &&
                  Array.isArray(t.messages),
              )
              .slice(0, 12)
          : [],
      );
    } catch {
      setTransactions([]);
    }
  }, [storageKey, route]);
  const saveTx = useCallback(
    (tx: Tx) =>
      setTransactions((previous) => {
        const next = [tx, ...previous.filter((t) => t.hash !== tx.hash)].slice(
          0,
          12,
        );
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
    try {
      if (!window.ethereum)
        throw new Error(
          "Install an injected Ethereum wallet such as MetaMask, then reload.",
        );
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      setAccount(accounts[0]);
      setChainId(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
    } catch (e) {
      setError(errorText(e));
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
    lock.current = true;
    setBusy(action.label);
    setError("");
    setNotice("");
    let hash: Hash | undefined;
    try {
      if (!account || !window.ethereum)
        throw new Error("Connect your wallet first.");
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
      const { request } = await client.simulateContract({
        address: action.address,
        abi: action.abi,
        functionName: action.functionName,
        args: action.args,
        account,
        value,
      });
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
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
      });
      saveTx({
        ...transaction,
        state: receipt.status === "success" ? "confirmed" : "failed",
        messages: messageIds(receipt.logs, action.side),
      });
      if (receipt.status !== "success")
        throw new Error(
          "Transaction reverted. Check the explorer before retrying.",
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
    try {
      const fee = (await read(
        route,
        action.side,
        action.address,
        action.abi,
        quoteName,
        quoteArgs,
      )) as bigint;
      setAccepted(false);
      setError("");
      setReview({ action, fee, budget: fee + fee / 5n + 1n });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (
        !route?.escrow ||
        !route.executor ||
        !account ||
        !data ||
        !sourceReady
      )
        throw new Error(
          "Connect a wallet and a fresh configured source route first.",
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
      setAccepted(false);
      setError("");
      setReview({
        terms,
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

  if (!route)
    return (
      <main className="config-error">
        <h1>Check route configuration</h1>
        <p role="alert">{routesConfig.error || "No routes configured."}</p>
      </main>
    );
  const disabled = Boolean(busy || !account);
  const sourceLink = (address: Address) =>
    `${explorer(route, "source")}/address/${address}`;
  const destinationLink = (address: Address) =>
    `${explorer(route, "destination")}/address/${address}`;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          bisharp<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main">
          <a className="nav-active" href="#workspace">
            Cross-chain orders
          </a>
          <a href="#how-it-works">How it works</a>
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
      <main id="workspace">
        <section className="page-intro">
          <div>
            <div className="intro-kicker">
              Conditional cross-chain settlement
            </div>
            <h1>
              Your price.
              <br />
              Across chains.
            </h1>
            <p>
              Escrow on the source. Solver-funded Uniswap delivery on the
              destination.
              <br />
              Payment follows an authenticated CCIP receipt.
            </p>
          </div>
          <div className="route-illustration" aria-hidden="true">
            <div className="route-circle">$</div>
            <div className="route-track">··· → ···</div>
            <div className="route-circle eth-shape">♦</div>
            <span className="route-caption">CCIP 2.0 · Finality required</span>
          </div>
        </section>
        <div className="test-banner">
          <p>
            <strong>Testnet release candidate.</strong> bUSD is an unbacked
            faucet token. No guaranteed fills or refund timing during messaging
            outages. OP Sepolia has no sequencer-uptime signal configured.
          </p>
        </div>
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
          <label htmlFor="route">Settlement route</label>
          <select
            id="route"
            disabled={Boolean(busy)}
            value={routeIndex}
            onChange={(e) => {
              setRouteIndex(Number(e.target.value));
              setData(undefined);
              setDest(undefined);
              setSourceError("");
              setDestError("");
              setReview(undefined);
              setPage(0);
              setError("");
              setNotice("");
            }}
          >
            {routesConfig.routes.map((r, i) => (
              <option key={r.id} value={i}>
                {r.label}
                {r.configured ? "" : " · not deployed"}
              </option>
            ))}
          </select>
          <span>Wallet: {chainId ? chainId : "not connected"}</span>
        </div>
        {!route.configured && (
          <div className="setup-note">
            <strong>Configure a deployed route.</strong> Set
            NEXT_PUBLIC_SOURCE_ADDRESS and NEXT_PUBLIC_DESTINATION_ADDRESS, or
            provide NEXT_PUBLIC_ROUTES_JSON for multiple testnet routes. See
            README. No balances or confirmations are simulated in this UI.
          </div>
        )}
        {sourceError && (
          <div role="alert" className="alert">
            Source: {sourceError}
          </div>
        )}
        {destError && (
          <div role="alert" className="alert">
            Destination: {destError}. Source recovery remains available if its
            RPC is healthy.
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
        {((data && !sourceReady) || (dest && !destReady)) &&
          !sourceError &&
          !destError && (
            <div className="alert" role="status">
              Data is stale. Refresh before sending transactions.
            </div>
          )}
        <div className="workspace-grid">
          <section className="order-panel">
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
                  <span className="token-pill">bUSD</span>
                </div>
                <span className="field-foot">
                  Exact principal. Separate native message fees and gas.
                </span>
              </div>
              <div className="flow-divider">
                ↓ Solver swaps its own destination bUSD through Uniswap v3
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
                  <label htmlFor="expiry">Expires in</label>
                  <select
                    id="expiry"
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                  >
                    <option value={1}>1 hour</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                    <option value={168}>7 days</option>
                  </select>
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
              {account ? (
                <button
                  type="submit"
                  className="primary full"
                  disabled={disabled || !sourceReady}
                >
                  Review exact terms
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
                  className={`live-label ${destReady && dest?.price ? "is-live" : ""}`}
                >
                  {destReady && dest?.price ? "Fresh" : "Unavailable"}
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

        <section className="orders-panel">
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
              disabled={Boolean(busy)}
              onClick={() => void refresh()}
            >
              Refresh ↻
            </button>
          </div>
          <div className="tabs">
            <button
              className={view === "mine" ? "selected" : ""}
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
              onClick={() => {
                setView("all");
                setPage(0);
                setData(undefined);
              }}
            >
              All orders / solver
            </button>
          </div>
          {!data?.rows.length ? (
            <div className="empty-state">
              <div className="empty-icon">⇄</div>
              <h3>
                {account
                  ? "No orders on this page"
                  : "Connect to see your orders"}
              </h3>
              <p>
                Create an order or switch to all orders to inspect solver
                opportunities.
              </p>
            </div>
          ) : (
            <div className="cross-order-list">
              {data.rows.map((row) => {
                const s = row.source,
                  d = row.destination,
                  expired = now >= Number(s.terms.deadline) * 1000;
                const final = s.state === 3 || s.state === 4;
                const beneficiary =
                  s.state === 3 ? s.terms.solver : s.terms.owner;
                const canCancel = equal(account, s.terms.owner) || expired;
                const assigned = equal(account, s.terms.solver);
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
        <section className="how-section" id="how-it-works">
          <div>
            <h2>
              Execution and payment
              <br />
              have separate confirmations.
            </h2>
            <p>Message fees are separate from escrow principal.</p>
          </div>
          <ol>
            <li>
              <span className="step-number">1</span>
              <div>
                <h3>Lock and register</h3>
                <p>
                  The source stores your terms and sends CREATE through CCIP.
                  Until the destination receives it, your order cannot fill
                  there.
                </p>
              </div>
            </li>
            <li>
              <span className="step-number">2</span>
              <div>
                <h3>Fill or cancel on the destination</h3>
                <p>
                  The first confirmed terminal outcome wins. A fill can beat a
                  source cancellation request. Swaps must satisfy both the fresh
                  trigger and minimum output.
                </p>
              </div>
            </li>
            <li>
              <span className="step-number">3</span>
              <div>
                <h3>Send the receipt, then claim</h3>
                <p>
                  Anyone can pay to dispatch or retry a stored terminal receipt.
                  Only its authenticated arrival unlocks a source payment or
                  refund. An outage can delay recovery indefinitely.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <footer>
          <span className="footer-brand">bisharp.</span>
          <span>
            Unaudited testnet release candidate · no production guarantees
          </span>
          <div>
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
                (review.action.side === "source" ? !sourceReady : !destReady) ||
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
