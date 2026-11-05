"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BaseError, createWalletClient, custom, formatUnits, getAddress, isAddress,
  parseUnits, type Abi, type Address, type EIP1193Provider, type Hash,
} from "viem";
import { escrowAbi } from "@/lib/abi";
import { escrowAddress, publicClient, sepolia, shortAddress, tokenAbi } from "@/lib/web3";

type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
type Order = {
  id: bigint; owner: Address; recipient: Address; principal: bigint;
  minOutput: bigint; maxPrice: bigint; deadline: bigint; status: number; solver: Address;
};
type Snapshot = {
  input: Address; output: Address; feed: Address; price: bigint | null; maxAge: bigint;
  count: bigint; orders: Order[]; credit: bigint; usd: bigint; eth: bigint;
  allowance: bigint; outputAllowance: bigint; block: bigint;
};
type TxRecord = { hash: Hash; label: string; state: "pending" | "confirmed" | "failed" };
const number = (value: bigint, decimals: number, digits = 4) => Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: digits });
const money = (value: bigint) => number(value, 18, 2);
const statuses = ["Unknown", "Open", "Filled", "Cancelled"];

function Icon({ name, size = 20 }: { name: "arrow" | "wallet" | "check" | "clock" | "layers" | "external" | "plus" | "close"; size?: number }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    wallet: <><path d="M20 8V5H5a2 2 0 0 1 0-4h13v4M3 3v16a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-2" /><path d="M20 12h-5v5h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" /></>,
    external: <><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<"mine" | "solver">("mine");
  const [amount, setAmount] = useState("100");
  const [trigger, setTrigger] = useState("2500");
  const [minimum, setMinimum] = useState("0.04");
  const [duration, setDuration] = useState("24");
  const [recipient, setRecipient] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastRead, setLastRead] = useState(0);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [now, setNow] = useState(0);
  const [review, setReview] = useState<{ principal: bigint; minOutput: bigint; maxPrice: bigint; deadline: bigint; recipient: Address }>();
  const inflight = useRef(false);
  const reading = useRef(false);
  const accountRef = useRef(account);
  accountRef.current = account;
  const wrongNetwork = Boolean(account && chain !== sepolia.id);
  const stale = Boolean(lastRead && now - lastRead > 45_000);

  const refresh = useCallback(async () => {
    if (!escrowAddress || reading.current) return;
    const address = escrowAddress;
    reading.current = true;
    const owner = account;
    try {
      if (await publicClient.getChainId() !== sepolia.id) throw new Error("The configured RPC is not Ethereum Sepolia.");
      const block = await publicClient.getBlockNumber({ cacheTime: 0 });
      const read = (functionName: "inputToken" | "outputToken" | "priceFeed" | "maxPriceAge" | "orderCount") =>
        publicClient.readContract({ address, abi: escrowAbi, functionName, blockNumber: block });
      const [input, output, feed, maxAge, count] = await Promise.all([
        read("inputToken"), read("outputToken"), read("priceFeed"), read("maxPriceAge"), read("orderCount"),
      ]);
      const inputAddress = input as Address, outputAddress = output as Address;
      const [usdDecimals, ethDecimals] = await Promise.all([
        publicClient.readContract({ address: inputAddress, abi: tokenAbi, functionName: "decimals", blockNumber: block }),
        publicClient.readContract({ address: outputAddress, abi: tokenAbi, functionName: "decimals", blockNumber: block }),
      ]);
      if (usdDecimals !== 6 || ethDecimals !== 18) throw new Error("Unsupported deployment: expected 6-decimal bUSD and 18-decimal bETH.");
      const total = count as bigint;
      const first = total > 49n ? total - 49n : 1n;
      const ids = Array.from({ length: Number(total < 50n ? total : 50n) }, (_, i) => total - BigInt(i)).filter(id => id >= first);
      const [price, orders, credit, usd, eth, allowance, outputAllowance] = await Promise.all([
        publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "currentPrice", blockNumber: block }).catch(() => null),
        Promise.all(ids.map(async id => ({ id, ...await publicClient.readContract({ address, abi: escrowAbi, functionName: "getOrder", args: [id], blockNumber: block }) }))),
        owner ? publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "credits", args: [owner], blockNumber: block }) : 0n,
        owner ? publicClient.readContract({ address: inputAddress, abi: tokenAbi, functionName: "balanceOf", args: [owner], blockNumber: block }) : 0n,
        owner ? publicClient.readContract({ address: outputAddress, abi: tokenAbi, functionName: "balanceOf", args: [owner], blockNumber: block }) : 0n,
        owner ? publicClient.readContract({ address: inputAddress, abi: tokenAbi, functionName: "allowance", args: [owner, escrowAddress], blockNumber: block }) : 0n,
        owner ? publicClient.readContract({ address: outputAddress, abi: tokenAbi, functionName: "allowance", args: [owner, escrowAddress], blockNumber: block }) : 0n,
      ]);
      if (accountRef.current !== owner) return;
      setSnapshot({ input: inputAddress, output: outputAddress, feed: feed as Address, maxAge: maxAge as bigint, price, count: total, orders, credit, usd, eth, allowance, outputAllowance, block });
      setReadError("");
      setLastRead(Date.now());
    } catch (e) {
      setReadError(e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "Unable to read Sepolia. Check your RPC URL.");
    } finally { reading.current = false; }
  }, [account]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    try {
      const saved = JSON.parse(localStorage.getItem(`bisharp:tx:${escrowAddress || "unconfigured"}`) || "[]") as TxRecord[];
      if (Array.isArray(saved)) setTransactions(saved.filter(t => /^0x[0-9a-fA-F]{64}$/.test(t.hash) && typeof t.label === "string" && ["pending", "confirmed", "failed"].includes(t.state)).slice(0, 8));
    } catch { /* An unavailable or old browser store must not block the app. */ }
    const provider = window.ethereum;
    const sync = async () => {
      if (!provider) return;
      const addresses = await provider.request({ method: "eth_accounts" }) as Address[];
      const id = await provider.request({ method: "eth_chainId" });
      setAccount(addresses[0]);
      setChain(Number(id));
    };
    const changed = () => { setSnapshot(undefined); setReview(undefined); setAccepted(false); void sync().catch(() => setAccount(undefined)); };
    void sync().catch(() => {});
    provider?.on?.("accountsChanged", changed);
    provider?.on?.("chainChanged", changed);
    return () => { clearInterval(timer); provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed); };
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Recover pending transaction receipts after a reload without asking for signatures.
  useEffect(() => {
    const pending = transactions.filter(t => t.state === "pending");
    if (!pending.length) return;
    let cancelled = false;
    const check = async () => {
      for (const tx of pending) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
          if (!cancelled) {
            setTransactions(previous => {
              const updated = previous.map(t => t.hash === tx.hash ? { ...t, state: receipt.status === "success" ? "confirmed" as const : "failed" as const } : t);
              try { localStorage.setItem(`bisharp:tx:${escrowAddress}`, JSON.stringify(updated)); } catch {}
              return updated;
            });
            void refresh();
          }
        } catch { /* A pending transaction does not yet have a receipt. */ }
      }
    };
    void check();
    const timer = setInterval(() => void check(), 12_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [transactions, refresh]);

  const saveTx = (record: TxRecord) => setTransactions(previous => {
    const updated = [record, ...previous.filter(t => t.hash !== record.hash)].slice(0, 8);
    try { localStorage.setItem(`bisharp:tx:${escrowAddress}`, JSON.stringify(updated)); } catch {}
    return updated;
  });

  async function connect() {
    if (inflight.current) return;
    setError("");
    try {
      if (!window.ethereum) throw new Error("Install an Ethereum wallet such as MetaMask, then reload this page.");
      const addresses = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount((addresses as Address[])[0]);
      setChain(Number(await window.ethereum.request({ method: "eth_chainId" })));
    } catch (e) { showError(e); }
  }

  async function switchNetwork() {
    try {
      if (!window.ethereum) return;
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      setChain(sepolia.id);
    } catch (e) { showError(e); }
  }

  function showError(e: unknown) {
    const message = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "The request failed. Check your wallet and try again.";
    setError(message);
  }

  async function transact(label: string, address: Address, functionName: string, args: readonly unknown[] = [], token = false) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(label); setError(""); setNotice("");
    let hash: Hash | undefined;
    try {
      if (!account || !window.ethereum) throw new Error("Connect your wallet first.");
      if (wrongNetwork) throw new Error("Switch your wallet to Ethereum Sepolia first.");
      const wallet = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
      const actual = await wallet.getAddresses();
      if (actual[0]?.toLowerCase() !== account.toLowerCase()) throw new Error("Wallet account changed. Reconnect and try again.");
      if (await wallet.getChainId() !== sepolia.id) throw new Error("Switch your wallet to Ethereum Sepolia first.");
      const { request } = await publicClient.simulateContract({ account, address, abi: (token ? tokenAbi : escrowAbi) as Abi, functionName, args });
      hash = await wallet.writeContract(request);
      saveTx({ hash, label, state: "pending" });
      setNotice(`${label}: waiting for Sepolia confirmation.`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
      saveTx({ hash, label, state: receipt.status === "success" ? "confirmed" : "failed" });
      if (receipt.status !== "success") throw new Error("The transaction reverted. Your order state has not changed. Gas may have been spent.");
      setNotice(`${label} confirmed.`);
      if (functionName === "createOrder") { setReview(undefined); setAccepted(false); }
      await refresh();
    } catch (e) {
      showError(e);
      if (hash) setNotice("A transaction was submitted. Check its explorer link before retrying; it may still confirm.");
    } finally { setBusy(""); inflight.current = false; }
  }

  let principal = 0n;
  try { principal = parseUnits(amount, 6); } catch {}
  const needsApproval = Boolean(snapshot && principal > snapshot.allowance);
  const ready = Boolean(escrowAddress && snapshot && !readError && !stale && account && !wrongNetwork && !busy);
  const ownerOrders = snapshot?.orders.filter(o => o.owner.toLowerCase() === account?.toLowerCase()) || [];
  const visibleOrders = tab === "mine" ? ownerOrders : snapshot?.orders.filter(o => o.status === 1) || [];
  const locked = ownerOrders.filter(o => o.status === 1).reduce((sum, o) => sum + o.principal, 0n);

  function openReview(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      if (!account || !snapshot || !escrowAddress) throw new Error("Connect a wallet and configure the deployed Sepolia contract first.");
      if (!ready) throw new Error("Wait for a fresh Sepolia connection before reviewing.");
      if (!/^\d+(\.\d{1,6})?$/.test(amount) || !/^\d+(\.\d{1,18})?$/.test(minimum) || !/^\d+(\.\d{1,18})?$/.test(trigger)) throw new Error("Enter positive decimal amounts: up to 6 decimals for bUSD and 18 for output and price.");
      const p = parseUnits(amount, 6), m = parseUnits(minimum, 18), t = parseUnits(trigger, 18);
      if (p <= 0n || m <= 0n || t <= 0n) throw new Error("All order amounts must be greater than zero.");
      if (p > snapshot.usd) throw new Error("Insufficient bUSD. Get test tokens from the faucet first.");
      const to = recipient.trim() || account;
      if (!isAddress(to) || /^0x0{40}$/i.test(to) || to.toLowerCase() === escrowAddress.toLowerCase()) throw new Error("Enter a valid recipient wallet address.");
      setAccepted(false);
      setReview({ principal: p, minOutput: m, maxPrice: t, deadline: BigInt(Math.floor(Date.now() / 1000) + Number(duration) * 3600), recipient: getAddress(to) });
    } catch (e) { showError(e); }
  }

  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Bisharp home"><span className="brand-mark">b<span /></span>bisharp<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation"><a className="nav-active" href="#workspace">Workspace</a><a href="#how-it-works">How it works</a><a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer">Explorer <Icon name="external" size={13} /></a></nav>
      <div className="header-actions"><span className="network"><span /> Sepolia <span className="testnet">Testnet</span></span><button className="wallet-button" onClick={account ? wrongNetwork ? switchNetwork : () => void refresh() : connect} disabled={Boolean(busy)}><Icon name="wallet" size={16} />{account ? wrongNetwork ? "Switch to Sepolia" : shortAddress(account) : "Connect wallet"}</button></div>
    </header>

    <main id="workspace">
      <section className="page-intro"><div><div className="intro-kicker"><span className="tiny-diamond" /> Your terms. On chain.</div><h1>A better way to wait<br />for your price.</h1><p>Set a price condition. Lock test funds. Let a solver<br className="desktop-break" /> deliver when your terms are met.</p></div><div className="route-illustration" aria-hidden="true"><div className="route-circle">$</div><div className="route-track"><span /><span /><span /><Icon name="arrow" size={24} /></div><div className="route-circle eth-shape">♦</div><span className="route-caption">One condition. One settlement.</span></div></section>

      <div className="test-banner"><span className="banner-icon"><Icon name="layers" size={17} /></span><p><strong>A testnet workspace.</strong> Single-chain Sepolia. bUSD and bETH are free, unbacked test tokens. No bridge or automatic solver.</p><a href="#how-it-works">Understand the flow <Icon name="arrow" size={15} /></a></div>

      {!escrowAddress && <div className="setup-note" role="status"><strong>Ready for your deployment.</strong> The interface is running. Deploy the Foundry contracts, set <code>NEXT_PUBLIC_ESCROW_ADDRESS</code> in <code>.env.local</code>, and restart Next.js to enable transactions. See the project README for commands.</div>}
      {wrongNetwork && <div className="alert" role="alert">Your wallet is on another network. <button onClick={switchNetwork}>Switch to Ethereum Sepolia</button></div>}
      {(readError || stale) && <div className="alert" role="alert">{readError || "The displayed data is over 45 seconds old. Refresh before sending transactions."} <button onClick={() => void refresh()}>Retry connection</button></div>}
      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
      {notice && <div className="notice" role="status">{busy && <span className="spinner" />}{notice}</div>}

      <div className="workspace-grid">
        <section className="order-panel" aria-labelledby="create-title">
          <div className="panel-heading"><div><h2 id="create-title">Create an order</h2><p>Buy test bETH on your terms.</p></div><span className="small-tag">Buy</span></div>
          <form onSubmit={openReview}>
            <div className="route-label"><span>Network</span><span className="chain-label"><span className="chain-symbol">♦</span> Ethereum Sepolia</span></div>
            <div className="amount-box"><div className="field-top"><label htmlFor="amount">You lock</label><span>Balance: {snapshot && account ? number(snapshot.usd, 6, 2) : "—"}</span></div><div className="amount-row"><input id="amount" inputMode="decimal" autoComplete="off" value={amount} onChange={e => { setAmount(e.target.value); setReview(undefined); }} required aria-describedby="amount-help" /><span className="token-pill"><span className="coin usd">$</span>bUSD</span></div><span className="field-foot" id="amount-help">Test USD · 6 decimals</span></div>
            <div className="flow-divider"><span>↓</span><span>Delivered by a solver</span></div>
            <div className="amount-box receive-box"><div className="field-top"><label htmlFor="minimum">Minimum you receive</label><span>Fixed at creation</span></div><div className="amount-row"><input id="minimum" inputMode="decimal" autoComplete="off" value={minimum} onChange={e => { setMinimum(e.target.value); setReview(undefined); }} required /><span className="token-pill"><span className="coin eth">♦</span>bETH</span></div><span className="field-foot">Test Ether · Unbacked ERC-20</span></div>
            <div className="split-fields"><div><label htmlFor="trigger">When ETH/USD is at or below</label><div className="input-wrap"><span>$</span><input id="trigger" inputMode="decimal" value={trigger} onChange={e => { setTrigger(e.target.value); setReview(undefined); }} required /></div></div><div><label htmlFor="duration">Expires in</label><select id="duration" value={duration} onChange={e => { setDuration(e.target.value); setReview(undefined); }}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div></div>
            <label className="recipient-label" htmlFor="recipient">Receive at <span>Optional · defaults to your wallet</span></label><input className="recipient-input" id="recipient" placeholder="0x… or your connected wallet" value={recipient} onChange={e => { setRecipient(e.target.value); setReview(undefined); }} autoComplete="off" spellCheck={false} />
            <div className="order-facts"><span>Protocol fee <strong>0 bUSD</strong></span><span>Settlement <strong>Ethereum Sepolia</strong></span><span>Network gas <strong>Paid separately in test ETH</strong></span></div>
            {!account ? <button className="primary full" type="button" onClick={connect}><Icon name="wallet" size={18} /> Connect wallet to begin</button> : <button className="primary full" disabled={!ready || principal <= 0n} type="submit">Review order <Icon name="arrow" size={18} /></button>}
            <p className="form-caption"><Icon name="check" size={13} /> Funds stay in escrow until fill or cancellation.</p>
          </form>
        </section>

        <div className="right-column">
          <section className="market-panel" aria-labelledby="market-title"><div className="market-top"><span className="coin eth">♦</span><div><h2 id="market-title">ETH / USD</h2><p>Chainlink reference price</p></div><span className={`live-label ${snapshot?.price && !readError && !stale ? "is-live" : ""}`}><span />{snapshot?.price && !readError && !stale ? "Live" : "Offline"}</span></div><div className="market-price">{snapshot?.price ? `$${money(snapshot.price)}` : "—"}<span>USD per ETH</span></div><div className="price-explainer"><Icon name="clock" size={16} /><p>{snapshot?.price ? `Freshness checked on chain. Maximum age: ${Number(snapshot.maxAge) / 60} minutes.` : escrowAddress && snapshot ? "The feed is stale or invalid. Fills are blocked; cancellation and claims remain available." : "The live price appears after a Sepolia contract is configured."}</p></div><div className="market-footer"><span>Reference price only. A fill is never guaranteed.</span>{snapshot && <a href={`https://sepolia.etherscan.io/address/${snapshot.feed}`} target="_blank" rel="noreferrer" aria-label="View price feed on Etherscan"><Icon name="external" size={13} /></a>}</div></section>

          <section className="balances-panel"><h2>Your test funds</h2><div className="balance-line"><span><span className="coin usd small">$</span>Available bUSD</span><strong>{account && snapshot ? number(snapshot.usd, 6, 2) : "—"}</strong></div><div className="balance-line"><span><span className="coin eth small">♦</span>Available bETH</span><strong>{account && snapshot ? number(snapshot.eth, 18, 4) : "—"}</strong></div><div className="balance-summary"><div><span>Locked in loaded orders</span><strong>{account && snapshot ? `${number(locked, 6, 2)} bUSD` : "—"}</strong></div><div><span>Ready to claim</span><strong>{account && snapshot ? `${number(snapshot.credit, 6, 2)} bUSD` : "—"}</strong></div></div><button className="secondary full" disabled={!ready || !snapshot?.credit} onClick={() => escrowAddress && transact("Claim funds", escrowAddress, "claim", [account])}>Claim available funds <Icon name="arrow" size={16} /></button><details className="faucet"><summary>Need test tokens?</summary><p>Mint free demo tokens. You still need Sepolia ETH for gas.</p><div><button className="text-button" disabled={!ready} onClick={() => snapshot && transact("Mint bUSD", snapshot.input, "faucet", [], true)}><Icon name="plus" size={14} />1,000 bUSD</button><button className="text-button" disabled={!ready} onClick={() => snapshot && transact("Mint bETH", snapshot.output, "faucet", [], true)}><Icon name="plus" size={14} />1,000 bETH</button></div><a href="https://faucets.chain.link/sepolia" target="_blank" rel="noreferrer">Get Sepolia gas ETH <Icon name="external" size={12} /></a></details></section>
        </div>
      </div>

      <section className="orders-panel" id="orders" aria-labelledby="orders-title"><div className="orders-heading"><div><h2 id="orders-title">Order activity</h2><p>Track escrow, delivery, and settlement in one place.</p></div><button className="refresh-button" onClick={() => void refresh()} disabled={!escrowAddress || Boolean(busy)}>Refresh <span aria-hidden="true">↻</span></button></div><div className="tabs" role="tablist" aria-label="Order views"><button id="tab-mine" role="tab" aria-selected={tab === "mine"} aria-controls="order-list" className={tab === "mine" ? "selected" : ""} onClick={() => setTab("mine")}>Your orders <span>{ownerOrders.length}</span></button><button id="tab-solver" role="tab" aria-selected={tab === "solver"} aria-controls="order-list" className={tab === "solver" ? "selected" : ""} onClick={() => setTab("solver")}>Solver workspace <span>{snapshot?.orders.filter(o => o.status === 1).length || 0}</span></button></div>
        <div id="order-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "solver" && <p className="solver-help">Solvers supply their own bETH, deliver the exact output, then claim the escrowed bUSD. Approve each fill amount separately. No automated keeper is running.</p>}
          {visibleOrders.length === 0 ? <div className="empty-state"><div className="empty-icon"><Icon name={tab === "mine" ? "layers" : "clock"} size={26} /></div><h3>{!account && tab === "mine" ? "Your orders live here" : tab === "solver" ? "No open orders to fill" : "Your next move starts here"}</h3><p>{!account && tab === "mine" ? "Connect your wallet to see your orders and available claims." : tab === "solver" ? "New orders will appear here after they are confirmed on Sepolia." : "Create your first conditional order using the form above."}</p><span className="empty-network"><span /> Ethereum Sepolia</span></div> : <div className="table-scroll"><table><thead><tr><th>Order</th><th>Locked / output</th><th>Price condition</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleOrders.map(o => {
            const expired = Number(o.deadline) * 1000 <= now;
            const eligible = Boolean(snapshot?.price && snapshot.price <= o.maxPrice && !expired);
            const approved = snapshot && snapshot.outputAllowance >= o.minOutput;
            return <tr key={String(o.id)}><td><strong>#{String(o.id)}</strong><a className="table-address" href={`https://sepolia.etherscan.io/address/${o.recipient}`} target="_blank" rel="noreferrer" title={o.recipient}>{shortAddress(o.recipient)} <Icon name="external" size={10} /></a><small>Expires {new Date(Number(o.deadline) * 1000).toLocaleString()}</small></td><td><strong>{number(o.principal, 6, 2)} bUSD</strong><small>Receive {number(o.minOutput, 18, 8)} bETH</small></td><td>≤ ${money(o.maxPrice)}<small>{o.status === 1 ? expired ? "Expired · close to refund" : eligible ? "Trigger eligible" : "Waiting for price" : "Terms closed"}</small></td><td><span className={`status status-${o.status}`}>{statuses[o.status]}</span>{o.status === 2 && <small>Output delivered</small>}{o.status === 3 && <small>Refund credited</small>}</td><td><div className="row-actions">{o.status === 1 && tab === "mine" && <button className="secondary compact" disabled={!ready} onClick={() => escrowAddress && transact("Cancel order", escrowAddress, "cancelOrder", [o.id])}>Cancel</button>}{o.status === 1 && tab === "solver" && <>{expired ? <button className="secondary compact" disabled={!ready} onClick={() => escrowAddress && transact("Close expired order", escrowAddress, "cancelOrder", [o.id])}>Close expired</button> : <button className="primary compact" disabled={!ready || !eligible || !snapshot || snapshot.eth < o.minOutput || snapshot.price === null} onClick={() => snapshot && escrowAddress && (approved ? transact("Fill order", escrowAddress, "fillOrder", [o.id]) : transact("Approve bETH", snapshot.output, "approve", [escrowAddress, o.minOutput], true))}>{approved ? "Fill order" : "Approve bETH"}</button>}</>}{o.status !== 1 && <span className="muted">Final</span>}</div></td></tr>;
          })}</tbody></table></div>}
        </div><div className="orders-footer"><span>{snapshot ? `Latest ${snapshot.orders.length} of ${snapshot.count} orders · block ${snapshot.block}` : "Waiting for deployment connection"}</span><span>{lastRead ? `Updated ${Math.max(0, Math.floor((now - lastRead) / 1000))}s ago` : "On-chain data only"}</span></div>
        {snapshot && snapshot.count > 50n && <p className="solver-help">This prototype loads only the latest 50 global orders. Older orders and their locked totals are omitted. Claims include all earned credits. Use the contract’s getOrder/cancelOrder functions for older orders.</p>}
      </section>

      {transactions.length > 0 && <section className="transactions"><h2>Recent transactions</h2><div>{transactions.map(t => <a key={t.hash} href={`https://sepolia.etherscan.io/tx/${t.hash}`} target="_blank" rel="noreferrer"><span>{t.label} <small>{shortAddress(t.hash)}</small></span><span className={`tx-${t.state}`}>{t.state} <Icon name="external" size={13} /></span></a>)}</div></section>}

      <section className="how-section" id="how-it-works"><div><h2>A clear path from<br />condition to settlement.</h2><p>Test the lifecycle without moving real assets.</p></div><ol><li><span className="step-number">1</span><div><h3>Set your terms</h3><p>Approve an exact bUSD amount, then create an order with a fixed recipient, minimum output, and expiry.</p></div></li><li><span className="step-number">2</span><div><h3>A solver delivers</h3><p>If the fresh oracle price meets your condition, a solver transfers bETH to your recipient and earns the bUSD.</p></div></li><li><span className="step-number">3</span><div><h3>Settle or cancel</h3><p>Cancel an open order to credit a refund. A fill can win the race; the first confirmed outcome is final. Claim credits separately.</p></div></li></ol></section>
      <footer><a className="footer-brand" href="/">bisharp.</a><span>Built for testing. No real value. No guaranteed fills.</span><div>{escrowAddress && <a href={`https://sepolia.etherscan.io/address/${escrowAddress}`} target="_blank" rel="noreferrer">Escrow contract <Icon name="external" size={12} /></a>}<a href="#workspace">Back to workspace ↑</a></div></footer>
    </main>

    {review && <div className="modal-backdrop"><section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={e => { if (e.key === "Escape" && !busy) setReview(undefined); if (e.key === "Tab") { const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')); const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><div className="panel-heading"><div><h2 id="review-title">Review your order</h2><p>Ethereum Sepolia · Test assets only</p></div><button className="icon-button" autoFocus disabled={Boolean(busy)} onClick={() => setReview(undefined)} aria-label="Close review"><Icon name="close" /></button></div><dl className="review-details"><div><dt>Lock in escrow</dt><dd>{number(review.principal, 6, 6)} bUSD</dd></div><div><dt>Minimum output</dt><dd>{number(review.minOutput, 18, 18)} bETH</dd></div><div><dt>ETH/USD trigger</dt><dd>≤ ${money(review.maxPrice)}</dd></div><div><dt>Expires (your timezone)</dt><dd>{new Date(Number(review.deadline) * 1000).toLocaleString()}</dd></div><div><dt>Recipient</dt><dd className="wrap-address">{review.recipient}</dd></div><div><dt>Solver</dt><dd>Any funded wallet · no signed quote</dd></div><div><dt>Fees</dt><dd>0 protocol fee + Sepolia gas</dd></div></dl><p className="modal-warning">A fill is not guaranteed. Your bUSD stays locked until a fill or cancellation. A solver fill can confirm before your cancellation. A successful fill is final.</p><label className="accept-terms"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />I understand the terms and the cancellation race.</label>{error && <p className="modal-error" role="alert">{error}</p>}{notice && <p role="status" className="modal-status">{notice}</p>}<button className="primary full" disabled={!accepted || !ready || Number(review.deadline) * 1000 < now + 300_000} onClick={() => escrowAddress && snapshot && (snapshot.allowance < review.principal ? transact("Approve bUSD", snapshot.input, "approve", [escrowAddress, review.principal], true) : transact("Create order", escrowAddress, "createOrder", [review.principal, review.minOutput, review.maxPrice, review.deadline, review.recipient]))}>{busy || (needsApproval ? "1. Approve exact bUSD amount" : "2. Confirm and create order")}</button><p className="form-caption">Approval and order creation are separate wallet transactions.</p>{snapshot && <p className="token-identities">bUSD: {snapshot.input}<br />bETH: {snapshot.output}<br />Escrow: {escrowAddress}</p>}</section></div>}
  </>;
}
