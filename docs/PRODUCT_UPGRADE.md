# Product upgrade — 2026-11-06

This increment makes order costs and recovery steps visible before users sign.
It preserves the existing visual system and the asynchronous settlement model.
It is local implementation work, not an independent security audit or a claim
that the deployed testnet contracts have acquired these changes.

## Trade planning and minimum protection

The workspace now includes **Check your trade**, usable without a wallet.
It calculates the acquisition price implied by the accepted minimum, solver
spread, minimum-output reference value, and a break-even price including a
user-entered fee budget. An unknown fee budget stays unknown. The budget is a
planning estimate and does not impose an on-chain spending cap.

Price references are either a fresh on-chain oracle observation or an explicitly
labeled user scenario. A three-row scenario table shows minimum-output values
at the reference and at prices 20% below/above it. These are arithmetic scenarios,
not forecasts or realized savings. All USD comparisons assume the input token
is worth $1; faucet bUSD is unbacked.

The reference-minimum helper applies an explicit 0.5%, 1%, or 2% haircut to the
oracle-only output estimate. It does not quote Uniswap liquidity, price impact,
or pool fees. Applied values remain editable and must be reviewed before signing.

When the owner is also the solver, acquisition scenarios use destination input
as the cost basis. Source principal is separate working capital, locked until
settlement and returned to the owner as solver payment. A separate solver uses
source principal as the owner's acquisition cost. All monetary calculations use
BigInt with the contract's 6/18-decimal units and normalized 18-decimal price.

The signing review repeats a **Minimum protection check** using the exact signed
terms at the trigger price and the captured fee estimate. A minimum worth less
than that input cost requires a separate acknowledgement. This is a comparison
at the trigger reference, not protection against future price declines.

## Recovery and continuity

- Each loaded order explains its next lifecycle step: registration, assigned
  solver, cancellation in transit, destination expiry, receipt dispatch, or claim.
  Source expiry alone never implies refund eligibility.
- Activity summarizes locked principal, principal claimable to the connected
  beneficiary, and orders with an available next step. These figures cover only
  the current page of up to ten orders, not the entire portfolio.
- Search by order ID or wallet, filter by progress/next step/claim transfer, and
  export the current page to CSV. Exports retain exact token amounts and identify
  missing destination observations separately from an unknown on-chain order.
- Save and restore a validated draft in browser storage scoped to its route.
  Restoring a draft does not restore an approval, a fee quote, or a fixed expiry;
  the order is validated and reviewed again before signing.

## Confirmed defects fixed

- A destination executor could be designated as solver even though it cannot
  invoke its own fill entry point. Source validation and the frontend now reject
  this unfillable identity. A contract regression verifies rejection spends no
  principal or message funding and queues no message. **Existing deployments
  require redeployment to obtain this Solidity fix.**
- Source snapshots were withheld until destination RPC and per-order reads
  finished. Each chain now publishes independently; attaching destination data
  preserves the original source timestamp. Context and wallet-generation guards
  discard obsolete reads.
- Malformed saved transaction message IDs could reach rendering and crash
  activity. History restoration now validates and bounds hashes, chains, labels,
  states and message arrays, and deduplicates by chain plus transaction hash.
- Wallet cancellation or replacement could be announced as successful execution
  of the original action. Receipt handling now records the actual mined hash and
  distinguishes repricing from cancellation or changed-call replacement.
- Wallet connection results could overwrite a newer wallet event. Connection
  results now use a generation guard. Account changes reset owner pagination;
  ordinary chain switches preserve it so older-order actions can proceed.
- Review dismissal now restores focus to the element captured before opening.
  The wallet chain and current snapshot age are checked again after simulation.
- Invalid default solver/deployment configuration no longer silently falls back
  to a different identity. The development faucet rejects cross-origin requests.
- Parallel unlocked Foundry deployment calls could strand local deployment
  transactions in Anvil's nonce queue. The local deployer now uses `--slow` so
  each deployment transaction confirms before the next is submitted.

## Verification

- **50 frontend/library/API tests passed** through `npm run test:ui`.
- **43 Foundry contract tests passed**, including fuzz and invariant suites.
- TypeScript, formatting, optimized Next.js production build, and the existing
  public-build secret check passed.
- Fresh two-node integration on isolated ports 28545/29545 passed registration,
  real Uniswap v3 execution, delayed receipt protection, solver payment,
  cancellation/refund and zero source liabilities. Only its own nodes were stopped;
  existing demo nodes and `.env.local` were preserved.
- Browser checks at 1440px and 390px covered calculations, applying a reference
  minimum, save/restore drafts, malformed input feedback, order search, keyboard
  status filters, CSV download, and missing-wallet feedback. No overflow was found
  at the mobile viewport. No injected wallet was available for interactive signing.

## Remaining product limits

This remains testnet software. There is no signed competitive solver quote,
production keeper, guaranteed solver inventory, execution SLA, or executable
pool quote in this increment. Real-fund readiness still requires independent
security review, appropriate assets/oracle/sequencer configuration, deployment
verification, live-chain validation and connected-wallet end-to-end testing.
Message outages can delay settlement and recovery indefinitely.

Pending transaction history survives reload, but replacement discovery during
the active wallet wait does not provide a nonce-indexed replacement monitor after
reload. Users should inspect the linked explorer before retrying a transaction
that remains pending.
