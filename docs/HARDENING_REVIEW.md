# Hardening review — 2026-11-06

This is a local implementation review with regression testing, not an independent
audit or a guarantee of flawless operation on public networks.

## Changes

- Source claims now require both an exact escrow debit and an exact beneficiary
  credit. A token that starts charging transfer fees after deposit cannot silently
  underpay a solver/refund or debit another order's principal. Failed checks revert
  the entire claim, preserving its credit and liability. The same protection is
  applied to the retained single-chain reference contract. Fee-taking, rebasing or
  dishonest tokens remain unsupported; recovery requires compatible token behavior.
- Reject the source escrow as the designated solver so its payment cannot be
  credited to an address without a way to use it.
- Ignore fee-review results after account/route changes, including wallet events
  while a quote is pending. Recheck RPC chain ID, selected context and wallet account
  after simulation before asking the wallet to send a transaction.
- Reject invalid clocks and zero owners during order-input validation.
- Extend cross-chain invariant scheduling with time advances, price refreshes,
  transport outages, CREATE retries and destination expiry. After each sequence,
  restore transport, deliver pending messages, close open expired orders, dispatch
  outcomes and claim every remaining principal. Require zero remaining liability.
  This recovery check assumes transport eventually resumes and transactions are funded.
- Add `npm run test:integration` for local verification. It deploys two fresh local chains, performs
  real Uniswap v3 swaps, verifies delayed-receipt protection, solver settlement and
  cancellation/refund, then stops only the nodes it started. It leaves `.env.local`
  alone and supports separate smoke-test ports when a demo is already running.

## Verification

- Deterministic seed `0x6d756d626169`: **42 contract tests passed**, including
  **40,000 fuzz cases** and **262,144 invariant calls** (1,024 sequences at depth
  128 for each of two invariant suites). See `reports/foundry-results.json`.
- **8 frontend/API tests passed**; TypeScript, formatting, optimized production
  build, high-severity cross-chain contract lint and public-build secret scan passed.
- Fresh two-node integration passed on isolated ports 28545/29545: registration,
  real Uniswap swap, delayed-receipt protection, solver payment, cancellation/refund
  and zero source liabilities. See `deployments/local-smoke-summary.json`.
- `npm audit --omit=dev --json` reported **zero known production vulnerabilities**.
  This is a registry advisory check, not a complete supply-chain security audit.

## Remaining limits

Public CCIP round trips and finality/configuration evidence are still required for
each public route. The two-node transport is an intentionally unauthenticated fixture.
No public deployments, wallet spending, publishing or submissions were performed.

Orders need a designated solver with destination inventory and someone to trigger
fills, receipt dispatches and claims. The application currently exposes manual actions;
it does not supply a production keeper, guaranteed liquidity or an execution SLA.
An eligible price does not guarantee a fill. Network outages can delay settlement
indefinitely; source expiry alone cannot safely authorize a refund.

Independent security review, production token/liquidity approval, L2 sequencer policy
and browser wallet-flow verification remain release gates. Existing deployments do
not acquire these contract changes automatically: redeploy and verify fresh paired
contracts before using the changes on another network.
