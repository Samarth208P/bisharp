# Bisharp PRD review

Reviewed: 2026-11-05 (Asia/Calcutta). Scope: supplied PRD and repository. No contracts, tests, frontend, deployment artifacts or official event URL were present. This is a design review, not a deployed-contract security audit. Corrections are proposed in [PRD.md](PRD.md); input is preserved in [PRD.original.md](PRD.original.md).

## Findings by severity

| ID | Severity | Original flaw | Consequence | Correction in v2 |
| --- | --- | --- | --- | --- |
| B-01 | Critical | Source principal remains locked; messages are treated as destination liquidity | No defined funds for the swap | Explicit solver-funded execution and source reimbursement |
| B-02 | Critical | Source refunds solely on elapsed time | Delayed success can leave user with both output and refund, solver unpaid | Destination fill/cancel exclusivity and authenticated terminal receipt before principal release |
| B-03 | Critical | Reverted swap supposedly sends automatic rollback | Reversion discards that transaction's state and sends | Separate failed attempt, terminal cancellation and durable retryable receipt dispatch |
| B-04 | High | Assumes route and CCIP version compatibility | Proposed route may not be deployable | Verify both directions, deployed routers/selectors and pinned SDK |
| B-05 | High | Success pays unspecified account or mints receipt | No defined creditor or enforceable delivery/payout accounting | Immutable solver payout and user recipient; actual delivery before credit |
| B-06 | High | Oracle trigger substitutes for execution protection | Trigger can pass while actual purchase price is poor | Separate BUY maximum trigger from immutable net minimum output |
| B-07 | High | No authentication/replay/reordering specification | Spoofed payment, duplicate credit or reopened cancelled order | Domain/sender checks, logical idempotence and cancellation tombstones |
| B-08 | High | No feed freshness, units, sequencer or depeg rules | Bad eligibility, wrong amounts and false peg assumptions | Actual decimals, timestamp validation, explicit grace and token assumptions |
| B-09 | High | No return-fee or keeper liveness model | Delivery can occur while source payment remains indefinitely pending | Separate funded budgets, permissionless dispatch/top-up/retry, monitoring |
| B-10 | High | Missing solvency, token restrictions and role controls | Principal can be consumed or claims blocked | Liability invariants, separate fees, pull credits and restricted administration |
| B-11 | Medium | V3/V4 treated interchangeably in 48 hours | Different execution models increase untested scope | One vetted v3 router/pool for MVP |
| B-12 | Medium | Asset buying called real-world DvP without underlying rights | Product/legal promise exceeds token transfers | Conditional-order positioning; separate trade-finance scope |
| B-13 | Medium | Unsupported novelty/competitor/MEV claims | Misleading user and judge expectations | Describe actual bounds and residual risks |
| B-14 | Medium | Planned prize criteria checked complete | Misrepresents readiness and eligibility | Official event evidence and implementation artifacts before checking off |
| B-15 | Medium | UI covers only lock/view/refund; tests cover happy loop | No understandable cancellation race or recovery | Complete lifecycle UX and adversarial acceptance matrix |
| B-16 | Medium | No success metrics, economics or production gate | Demo confused with viable financial product | Cost/latency/capital measures, exposure limits and independent review |

Severity reflects potential funds loss or inability to deliver the design, not confirmed exploits in deployed code.

## Counterexample: timeout double payment

1. User locks 100 source USDT.
2. Destination swap delivers output immediately before expiry.
3. Success receipt is delayed by messaging outage or fee shortage.
4. Source timestamp passes expiry and original claimRefund returns 100 USDT.
5. Success arrives; source reimbursement is no longer backed.

A longer timeout cannot rule out arbitrary delay. The proposed handshake resolves the race on destination and waits for its terminal receipt. This preserves safety at the cost of potentially unbounded waiting during outages. A new unilateral escape needs a separately reviewed non-execution proof or a disclosed additional trust model.

## Proposed architecture and tradeoffs

Solver funding supplies the missing destination capital while retaining source escrow. It introduces solver inventory, capital lockup, basis risk and possible non-fill. The solver is disclosed and no fill guarantee is offered. This decision remains proposed for product-owner review.

Alternative not selected: transfer user principal through a supported token lane, then swap or hold destination refund assets. That requires verified token-pool support and actual return-value transfers. A failure message cannot return value that has already moved. Do not mix this model with source refunds without separate accounting.

V2 uses delivery-before-payment and permanent cancellation-before-refund under explicit messaging/finality assumptions. It does not establish simultaneous, unconditional atomic DvP.

## Official evidence and verification limits

Only focused official-source queries were used. No STARK records were retrieved; they are unrelated to this DeFi review.

- [CCIP manual execution](https://docs.chain.link/ccip/concepts/manual-execution) documents retryable transport execution failures and manual recovery. Application inference: message delivery is distinct from swap success and user refund; cancellation/outbox behavior must be designed by Bisharp.
- [CCIP testnet directory](https://docs.chain.link/ccip/directory/testnet) did not establish Whitechain bidirectional support in retrieved content. This is unverified, not proof of unsupported status. Verify real routers/selectors and send both-direction test messages.
- [Uniswap v3 swap guide](https://developers.uniswap.org/docs/protocols/v3/guides/swapping/single-hop-swapping) documents output minimum and deadline protections. Design inference: an oracle eligibility check alone cannot bound actual output.
- [Data Feeds API](https://docs.chain.link/data-feeds/api-reference) specifies decimals and update timestamps, and marks answeredInRound deprecated. Select freshness checks for actual feed configuration rather than copying arbitrary defaults.
- [L2 sequencer feed guidance](https://docs.chain.link/data-feeds/l2-sequencer-feeds) supplies the outage/recovery implementation reference. No selected deployment address or grace value was verified here.
- [Whitechain developer guide](https://whitechain.io/blog/start-building-on-whitechain) documents Sepolia ID 1874 and WBT gas. It does not establish supplied token provenance, CCIP compatibility or any event requirement. No RPC/code/issuer check was performed on the candidate token.

These are mutable live references, not immutable protocol snapshots. Pin versions, bytecode and configuration for implementation review. No formal or mathematical verification is claimed from these searches.

## Completion boundary

Completed: review, original preservation, proposed revised requirements and work-log initialization. Remaining: route certification, economic parameter confirmation, contracts/frontend, adversarial tests, formal verification if pursued, deployment, liquidity arrangements, independent security review and event verification. A PRD review cannot make a financial app perfect; it can make assumptions and obligations explicit and testable.
