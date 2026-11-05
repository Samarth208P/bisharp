# Local readiness review

This is an implementation review supported by executable tests, not an independent security audit or a proof that no flaws exist. Public deployment and publication are deferred by the user.

## Resolved failure modes

| Failure | Implemented control | Executable evidence |
| --- | --- | --- |
| Source timeout refunds after a destination fill | No timeout withdrawal; authenticated destination outcome required | delayed-receipt and fill/cancel race tests |
| CANCEL arrives before CREATE | Domain-bound cancellation tombstone cannot reopen | cancellation-before-create test and fuzz scheduling |
| Duplicate messages or logical outcomes pay twice | Message-ID replay tracking plus irreversible logical outcomes and per-order claims | duplicate receipt tests and cross-chain invariant |
| Spoofed router, peer, selector or terms | Router-only callback, peer/selector/version/schema/hash checks | spoofing tests and compact-receipt changed-hash test |
| Swap reverts after solver funding | Funding, swap, output and terminal state are one transaction | real v3 slippage rollback test |
| Receipt dispatch fails after output delivery | Terminal outbox independent of dispatch; anyone can fund retries | fee-outage retry test and two-node smoke test |
| Frozen claim loses creditor or blocks reconciliation | Receipt creates credit; token transfer is a separate atomic claim | frozen-beneficiary test |
| Fees consume principal or another payer's change | ERC-20 liabilities separate from native message funding and payer credits | fee exhaustion / native-credit tests |
| Stale, zero, negative or future oracle answer | On-chain checks during fill | invalid-answer tests |
| Sequencer down or recovery too recent | Optional uptime feed and strict grace boundary | outage/grace test; public OP test configuration omission is disclosed |
| Amount rounding or malformed route | Exact decimal parsing, uint128 bounds, testnet/route validation | frontend input/route tests |
| Older orders disappear from recovery UI | Paginated owner/global reads | owner pagination test |
| Local fixture reaches public network | Dedicated 31337/31338 chain IDs, constructor checks, local-only API RPC allowlist | two-node smoke and local-faucet public-chain rejection tests |
| Duplicated deployment math regresses | Use pinned OpenZeppelin Math.sqrt | real pool tests and fresh two-node deployment after the fix |

## Remaining release gates

- Independent contract/security review, operational monitoring and incident ownership before any real funds.
- Actual CCIP 2.0 round-trip transactions, message IDs, code/configuration verification and finality evidence on each selected public route. Local mock transport is deliberately unauthenticated and is not equivalent evidence.
- A reviewed L2 sequencer policy. Optional support exists; the proposed OP Sepolia demo uses no uptime feed and is test-only.
- Production-token provenance/behavior and economic/liquidity review. All bUSD contracts are permissionless, unbacked faucets. No production stablecoin or peg guarantee is claimed.
- A solver quote/authorization service if required for a production operator. Current terms bind the manually chosen solver and payout identity but do not guarantee inventory or execution.
- Hosted automation for dispatch and monitoring, and manual-execution/runbook drills. The frontend exposes recovery actions; no production keeper/SLA is supplied.
- Wallet-click and visual/browser verification. This session's browser/native automation host is unavailable. HTTP, route, build and contract checks do not substitute for those observations.
- Public repository, partner feedback form, live demo/video and event eligibility/submission checks. These remain deferred as requested.

Receivers depend on the selected router, lane, default verifiers and chain finality. Transport compromise, source-chain finalized-state reversal, stolen user keys and malicious deployment configuration are outside the contracts' guarantees. Immutable pairing removes ongoing peer-rewrite authority but makes bootstrap verification essential.
