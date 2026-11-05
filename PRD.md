# Bisharp PRD v2: Conditional Cross-Chain Orders

Status: proposed design; implementation and deployment unverified. Updated: 2026-11-05 (Asia/Calcutta).

The input working copy, including its existing edits, is preserved in [PRD.original.md](PRD.original.md). See [PRD_REVIEW.md](PRD_REVIEW.md) for findings and [history.md](history.md) for work history.

## 1. Product promise

Bisharp lets a user escrow a supported stablecoin on a source chain and receive a minimum amount of a supported asset on a destination chain when an onchain price condition is satisfied. A solver supplies destination liquidity and earns the source payment only after authenticated delivery confirmation. An unfilled order becomes refundable after the destination irrevocably closes it and the source receives that decision.

This is asynchronous conditional settlement. It does not reverse finalized swaps, guarantee simultaneous cross-chain atomicity, guarantee fills when a price is touched, or guarantee a refund time during outages. Safety depends on contracts, authenticated messaging, chain finality, oracle configuration and supported token behavior. Stablecoin issuer risks and MEV remain.

Initial user: a DeFi user purchasing one destination asset with source stablecoins who accepts asynchronous settlement. Success means receiving at least the agreed net output or recovering escrow principal after confirmed non-execution. Legal trade-finance DvP and real-world ownership settlement require a separate asset/rights/legal design.

## 2. MVP scope

One verified bidirectional messaging lane, one source stablecoin, one destination input stablecoin, one output asset, one vetted Uniswap v3 router/pool, fixed recipients, full fills only, and a disclosed solver operator. Exclude partial fills, arbitrary routers/calldata, receipt minting, transferable orders, leverage, native-asset output, v4 hooks and public LP deposits.

Candidate route: Whitechain Sepolia -> Arbitrum Sepolia. BLOCKED until actual messaging support is verified in both directions. EVM compatibility is insufficient. If unavailable, demonstrate a supported testnet pair and a separate Whitechain escrow flow, accurately labeled. Do not replace CCIP with an unauthenticated relayer while retaining its security claims.

All testnet assets must be labeled test assets. The v1 USDT address is an unverified candidate, not an approved deployment address.

## 3. Feasibility gate before implementation

Maintain a versioned deployment manifest with evidence URLs, verification date, package version/commit, deployed bytecode and configuration:

| Component | Required verification | Current status |
| --- | --- | --- |
| Source network | Chain ID, RPC, explorer, native gas currency, finality policy | Whitechain publicly documents Sepolia ID 1874 and WBT gas; RPC not tested here |
| CCIP both directions | Selectors, routers, enabled lanes, verifier/finality settings, fee assets, callback limits, successful message IDs | Unverified; blocker |
| Source stablecoin | Exact address, deployed code, decimals, issuer/provenance, approval/transfer behavior | Unverified |
| Destination assets | Addresses, decimals, code, liquidity and supported transfer behavior | Unverified |
| Uniswap v3 | Router ABI/address/version, factory, pool, fee tier, usable liquidity | Unverified |
| Feeds | Proxy addresses, pair orientation, decimals, heartbeat/deviation, staleness threshold, sequencer feed and grace period | Unverified |
| Competition | Named event and official track URLs, deadline, eligibility and prize terms | No event URL supplied |

Pin the actual CCIP SDK/contracts release. Do not combine legacy receiver examples with CCIP 2.0 assumptions without compatibility checks. Record selected finality settings. Live docs are mutable: pin implementation references by version/commit and retain deployment evidence.

## 4. Funding and economics

Proposed MVP decision: solver-funded destination execution. User principal stays on the source. The solver spends its own destination tokens and receives source principal after authenticated successful delivery. Messages carry terms and receipts, not user principal.

An accepted solver quote binds the solver identity, authorized destination funding account, fixed source payout address, destination input amount, user output minimum, fee breakdown, quote expiry and terms hash. User creation must occur before quote expiry. Quote authorization binds chain IDs, contract addresses, protocol version and nonce. A quote does not guarantee a fill; an unfilled order carries no principal penalty in MVP.

Example: user locks 100 source USDT; solver spends 99 destination USDC and delivers at least the quoted output; solver receives 100 source USDT. The nominal difference is a disclosed gross spread, not guaranteed profit. Gas, messaging, capital costs, FX and depeg affect economics. Contracts do not assume stablecoins on different chains are equivalent. Users approve a concrete output amount and a separate USD trigger.

MVP protocol fee is zero. Source principal is exactly the success payout OR cancellation refund. Gas/message fees are separate; spent fees are nonrefundable. Define per-order fee-credit ownership, authorized spending, top-ups and withdrawal of unused credits after terminal settlement. Never use principal or another order's fee budget to pay execution costs. Top-ups cannot modify order terms.

Before enabling deposits, configure measured minimum/maximum order sizes, expiry ranges, fee caps, per-route exposure caps and solver inventory requirements. Validate solver capital availability and total user cost against a manual route.

## 5. Immutable order and message data

Order terms include:

- Domain: protocol version, chain IDs and CCIP selectors, source escrow and destination executor.
- Identity: source owner, unique nonce, order ID, fixed source refund address and destination recipient.
- Assets: source token/principal base units; destination input token/solver input base units; output token and nonzero `minAmountOut` base units.
- Execution: BUY only, configured output-token/USD feed, `maxTriggerPriceUsd` in 18-decimal USD units, destination `executeBefore`, allowed router/pool/fee tier.
- Economics: accepted solver quote hash, authorized funding identity, fixed source payout address and fee ownership/caps.

Derive `orderId = keccak256(abi.encode(domain, owner, nonce, termsHash))` using canonical typed encoding. Reject reused nonces, zero amounts/recipients, invalid deadlines, unsupported assets, overflow, domain mismatch and invalid quote authorization. Amendments require cancellation and a new order.

Message envelope: version, type (`CREATE`, `CANCEL`, `FILLED`, `CANCELLED`), order ID, terms hash, domain and bounded typed payload. FILLED binds actual output and the fixed recipient/payout identity. Receivers validate transport router caller, expected remote contract and selector, schema, domain and local terms. Keepers cannot replace recipients or settlement accounts.

CANCEL may arrive before CREATE: authenticated cancellation includes enough terms to persist a tombstone. Retain tombstones throughout the replay lifetime; later CREATE cannot reopen an order. Never rely on message ordering.

## 6. Lifecycle and cancellation safety

Source states: `OPEN`, `CANCEL_REQUESTED`, `SETTLED`, `REFUNDABLE`, `REFUNDED`.
Destination states: `UNKNOWN`, `OPEN`, `FILLED`, `CANCELLED`.

| Action | Preconditions | Effect |
| --- | --- | --- |
| Create source order | Valid accepted quote, full principal received, fee budget available | Lock principal, record terms and enqueue CREATE atomically |
| Receive CREATE | Authenticated terms | UNKNOWN -> OPEN; CANCELLED tombstone stays closed |
| Fill destination | OPEN; timestamp < executeBefore; oracle eligible; authorized solver funding | Atomic funding, swap, net delivery, FILLED state and stored receipt |
| Request source cancellation | Owner while OPEN; anyone may request expiry after deadline | CANCEL_REQUESTED and enqueue CANCEL; no principal released |
| Receive CANCEL | Authenticated terms | UNKNOWN/OPEN -> CANCELLED; already FILLED stays FILLED and returns its stored outcome |
| Expire destination | OPEN; timestamp >= executeBefore; callable by anyone | CANCELLED and stored receipt |
| Receive FILLED source | Matching authenticated outcome; OPEN or CANCEL_REQUESTED | SETTLED; allocate one solver payout credit |
| Receive CANCELLED source | Matching authenticated outcome; OPEN or CANCEL_REQUESTED | REFUNDABLE; allocate one user refund credit |
| Claim refund | REFUNDABLE | Mark REFUNDED and transfer credit once to fixed beneficiary |

Fill and cancellation race on the destination. A fill can win even after cancellation is requested on the source; payment must then settle. If cancellation closes the destination first, every subsequent fill fails. Show this before user submission.

NO timeout-only source principal withdrawal. Source time cannot prove an earlier destination fill did not occur. If a chain or return lane is unavailable, recovery can remain pending indefinitely. A future unilateral escape requires a separately reviewed proof of non-execution or an explicit additional trust model; extending a timeout does not solve this.

A reverting swap leaves the order OPEN, rolls back that attempt's transfers/state and may be retried before expiry. It is not proof of cancellation. A single reverting transaction cannot also persist a rollback message; closing the order is a separate successful transaction.

Terminal receipt creation is atomic with destination fill/cancellation. Dispatch is separate: anyone can fund fees and call bounded retryable dispatch. Send failure must not undo an already committed fill. Every retry derives identical semantics from stored terminal state. Handle duplicate transport IDs AND duplicate logical outcomes in distinct messages idempotently. Contradictory authenticated receipts raise an incident and halt reconciliation without paying a second outcome.

## 7. Oracle, execution and token requirements

Check the oracle onchain during fill regardless of keeper advice. Require positive answer, nonzero/nonfuture `updatedAt` and freshness within a feed-specific threshold. Normalize using actual feed decimals, checked arithmetic and conservative rounding. BUY eligibility is normalized output-token/USD price <= maxTriggerPriceUsd. A trigger does not guarantee an executable pool price or a stablecoin peg.

For an L2 with an applicable sequencer feed, block fills during downtime and a configured post-recovery grace period, validating timestamps under that feed's semantics. Review an explicit alternative before enabling a production route without the required uptime signal. Select and record thresholds; do not copy arbitrary defaults.

Always enforce immutable nonzero minAmountOut, swap deadline, approved route and actual net delivery to the fixed recipient. Never weaken the minimum using current pool reserves. UI minimum received must reflect the user's intended effective purchase price after disclosed costs. Example: an agreed economic cost of 100 USD at a maximum effective 2,000 USD/token requires at least 0.05 token, with correctly scaled amounts and rounding.

Solver funds the fill transaction from its own authorized balance/allowance. Reversion rolls back funding, swap, delivery and state. Support conventional allowlisted ERC-20s only initially; exclude rebasing/fee-on-transfer assets. Use safe transfers, balance-delta accounting, USDT-compatible approvals, bounded allowances, reentrancy guards and checks-effects-interactions. Verify delivery before FILLED. Test frozen/blacklisted tokens; a transfer failure cannot change who owns the credit.

Source payouts/refunds use pull credits so a failed beneficiary transfer cannot revert message receipt. Anyone may trigger a claim only to its fixed beneficiary. Automation can attempt transfers separately; show refund eligibility separately from actual transfer completion.

MEV mitigations: enforce output bounds, limit price impact/order size for the configured pool and optionally submit privately where supported. No claim of immunity or universal best execution. Keeper availability affects liveness, never bypasses eligibility checks.

## 8. Invariants and controls

Required invariants:

1. Each order allocates principal to the solver OR user, never both or more than deposited.
2. Source SETTLED requires an authenticated matching FILLED receipt; destination FILLED requires actual net recipient output >= minAmountOut.
3. Source refund eligibility requires destination CANCELLED, which can never transition to FILLED.
4. Destination terminal outcomes are mutually exclusive and irreversible; late CREATE cannot resurrect an order.
5. For each source token, escrow balance >= open/cancel-pending principal liabilities + unpaid solver credits + unpaid refund credits. Credits move liabilities; claims reduce balances and liabilities equally. Donations create no claim authority.
6. Fee accounting is independent of principal. Administrative rescue can withdraw only proven surplus.
7. Retries, duplicates, failed swaps, reentrant calls and pauses preserve invariants 1-6.

Threat model covers malicious users/solvers/keepers, spoofing/replay, arbitrary delays/reordering, reorgs, sequencer outages, stale/manipulated feeds, thin liquidity, sandwiches, depegs, token blacklists, fee exhaustion, RPC/indexer errors and compromised admin keys. Document prevented, bounded and accepted risks. Transport compromise or reversal of trusted finalized chain state is outside the contract-only guarantee.

Prefer non-upgradeable MVP contracts. A disclosed multisig manages new-route configuration and limited emergency roles. Pin configuration for existing orders. Pause creation/fills independently; preserve cancellation, terminal receipt handling and earned claims where technically safe. No admin arbitrary principal withdrawal, fabricated fills, recipient rewrites or forced timeout refunds. Configure exposure caps and a funded recovery runbook.

## 9. UX and operational requirements

Create: connect, select verified route/assets, enter principal/trigger/minimum received, choose expiry/recipient, review accepted solver quote, approve exact amount and submit. Show native gas assets and wallet/network requirements. Expired quotes require explicit fresh acceptance.

Before signing display exact token identities, principal locked, net minimum received, trigger orientation, estimated/capped costs, expiry timezone, recipient, solver identity and the cancellation-race/outage warning.

Status must distinguish deposit pending/finalized, message pending/failed, destination open, trigger eligible but unfilled, delivery complete/payment pending, cancellation requested, refund eligible and refund transferred. Message failure is not a refund. Show last indexed block and stale-data warnings; actionable state derives from onchain reads. Indexers/events help discover orders but never authorize payouts.

Recovery actions: request cancellation, top up own order fees, retry terminal dispatch, inspect transport/manual execution and claim earned credits. Simulate before wallet prompts; handle wrong network, rejection and revert; persist transaction/message links across reloads. Track orders by owner/domain/nonce without requiring a centralized account.

Usability acceptance: a new tester places an order, identifies where its funds are and its current outcome, cancels and claims an eligible refund without support. Require keyboard navigation, mobile layout, clear errors and token/chain identifiers.

Monitor message and receipt age, solver inventory, fee reserves, execution failures and escrow liabilities. Record incident owner, alert thresholds, top-up/retry procedures and public outage communications before deployment.

## 10. Acceptance and validation

| Scenario | Required outcome |
| --- | --- |
| Funded happy path | Valid trigger/output; user receives output; exactly one source solver credit/claim |
| Trigger touched but no liquidity | No guaranteed fill; escrow remains safe and cancellable |
| Slippage/swap revert | No FILLED receipt; attempt atomic; retry/cancel possible |
| Cancel wins | Destination closes; one refund; later fill fails |
| Fill wins / late success after source expiry | Solver paid; no unsafe refund |
| CANCEL before CREATE | Tombstone persists; late CREATE cannot open |
| Duplicate/conflicting receipts | No duplicate allocation; conflict triggers incident |
| Expiry boundary | Fill fails at/after destination deadline; source expiry alone does not refund |
| Outage/fee exhaustion | Committed outcome retained; top-up/retry resumes; no principal used for fees |
| Invalid/stale oracle, sequencer down/recovery | Fill blocked; safe cancellation/claims preserved |
| Spoofed sender/domain/router, reentrancy | Rejected with liabilities unchanged |
| Token and rounding edges | 6/8/18-decimal combinations, approval variants, frozen transfers verified |
| Concurrent fills and fill/cancel race | Exactly one destination terminal outcome |
| Reorg/stale indexer | Pinned finality policy followed; UI cannot invent final settlement |

Use Foundry unit, fuzz and stateful invariant tests with adversarial message scheduling and actual balance/credit assertions. Fork-test pinned tokens/router/feeds and integration-test the selected SDK. Simulator success alone does not prove lane feasibility. Collect transaction hashes, message IDs, manifests, commit and test results. No implementation exists yet; no runtime checks are currently passed.

## 11. Delivery and release gates

48 hours is a constrained testnet prototype budget, not production assurance:

1. Hours 0-4: verify route, tokens, feeds, pool and event rules; choose documented fallback if unsupported.
2. Hours 4-18: implement typed orders, source liabilities, destination exclusivity, terminal outbox and invariant tests.
3. Hours 18-28: integrate pinned CCIP/v3 versions; test retries and cancellation race on actual testnets. Reduce scope and label mocks if unresolved.
4. Hours 28-40: build quote/review/status/recovery UI, reconciliation and alerts.
5. Hours 40-48: execute acceptance matrix, collect evidence, document operations and record an honest demo.

Production gate: independent security review with critical/high findings resolved; meaningful invariant/fuzz/integration checks passing; finality/oracle policy reviewed; economic and token assumptions validated; restricted roles, exposure caps and recovery drills in place; monitored low-cap rollout. None currently satisfied.

Measure completion rate, trigger-to-fill latency, receipt-to-credit latency, cancellation-to-refund latency, stuck-order count/age, fee shortfalls, solver inventory coverage and total user cost versus a manual route. Publish distributions and observed availability; no guaranteed SLA before measurements.

## 12. Demo and unresolved decisions

Show funded success, confirmed cancellation and a delayed return receipt with no timeout-only withdrawal. Explain asset custody at each stage and label all testnets/mocks. Remove unsupported first-ever, automatic rollback, guaranteed refund and category-wide competitor claims.

Partner checklist items remain unchecked until official event rules and corresponding evidence are attached. Whitechain network documentation does not establish CCIP support, token provenance or prize eligibility. Git progress, verification, README text, feedback and video must exist before being checked off.

Before launch confirm: official event URL; verified route/tokens; solver funding/operator; order, exposure and fee limits; quote/expiry ranges; oracle staleness/deviation/grace settings; admin signers and incident owner. Solver-funded architecture is a proposed decision, not implemented or externally approved.

## 13. Official references

Reviewed 2026-11-05. Proposed application requirements above are design recommendations unless attributed. These mutable references must be pinned for implementation review.

- [CCIP testnet directory](https://docs.chain.link/ccip/directory/testnet): lane/deployment verification starting point.
- [CCIP manual execution](https://docs.chain.link/ccip/concepts/manual-execution): transport recovery and retries.
- [Data Feeds API](https://docs.chain.link/data-feeds/api-reference): values, decimals and update timestamps.
- [L2 sequencer feeds](https://docs.chain.link/data-feeds/l2-sequencer-feeds): outage/recovery handling.
- [Uniswap v3 swaps](https://developers.uniswap.org/docs/protocols/v3/guides/swapping/single-hop-swapping): output minimum and swap deadline.
- [Whitechain developer guide](https://whitechain.io/blog/start-building-on-whitechain): candidate Sepolia network details.
