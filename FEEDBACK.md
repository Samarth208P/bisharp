# Uniswap integration feedback

Project: Bisharp. Target: ETHGlobal Mumbai, Build with Uniswap. Work recorded 2026-11-05. This file describes actual implementation/testing experience; a developer feedback form has not been submitted. Repository: [Samarth208P/bisharp](https://github.com/Samarth208P/bisharp) (public).

Hosted frontend: [bisharp.netlify.app](https://bisharp.netlify.app/). Public
contracts are deployed; pairing and live cross-chain execution remain pending.

## What we built

A destination executor performs one configured Uniswap v3 exact-input swap using the solver's destination stablecoin. User principal remains on a different chain until an authenticated CCIP terminal receipt arrives. The executor pins the router, its factory's pool and fee tier. It enforces the accepted minimum output and deadline, checks the actual recipient balance increase, and clears router allowances after execution.

Integration: `contracts/src/crosschain/DestinationExecutor.sol`, `fillOrder`, `V3Router`, constructor pool validation. Tests: `contracts/test/RealV3.t.sol`. Local two-node fixture: `contracts/script/DeployLocal.s.sol` and `scripts/local-demo.mjs`.

## What worked

- Official factory, pool, router and NFT-manager bytecode from pinned npm artifacts could be deployed by Foundry and tested without compiling the original 0.7.6 sources into the 0.8.28 application.
- Actual pool integration caught the distinction between a reference-price trigger and executable output. A slippage revert leaves destination funding and source escrow unchanged.
- The official deployment documentation warns that addresses differ by chain. Read-only calls confirmed the OP Sepolia router02 and position manager use factory `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`.

## Friction and missing clarity

- OP Sepolia's deployment table lists both an SDK-core factory mapping and another factory deployment. Verifying the selected router's `factory()` and the position manager's `factory()` was necessary to avoid crossing them.
- SwapRouter and SwapRouter02 have different single-hop parameter layouts. The current executor intentionally uses the original deadline-bearing ABI and deploys the unchanged official router artifact against the chosen factory in the local fixture. Do not point it at router02.
- The supplied prize export had empty Uniswap qualification requirements, while the official live page requires this file and a feedback form. We updated the project checklist from the live rules.

## Highest-impact improvement

Publish a versioned, machine-readable chain deployment example that binds router ABI/version, factory, position manager, wrapped native token and an executable liquidity/swap smoke test together.

## Evidence and limits

The local two-chain integration exercised real Uniswap bytecode and actual token balance changes, plus successful source settlement and cancellation/refund. Extended deterministic fuzz results are in `reports/foundry-results.json`. The frontend is hosted at [bisharp.netlify.app](https://bisharp.netlify.app/), and both main contracts have exact-match Sourcify verification. Public order execution, explorer-specific verification and form submission remain separate tasks. We do not invent a time-to-first-success metric or user feedback we did not measure.
