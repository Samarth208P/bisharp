# Gas and payload measurements

Solidity 0.8.28, Cancun EVM, optimizer 200 runs. Before/after snapshots are retained in `gas-legacy.snap`, `gas-via-ir.snap`, and the final `.gas-snapshot`. All numbers below are **whole test-scenario gas**, including local transport fixtures and multiple calls. They are not production gas quotations, isolated swap costs, or live CCIP fee measurements.

| Same test scenario | Legacy pipeline, full receipt | via-IR, full receipt | via-IR, compact receipt |
| --- | ---: | ---: | ---: |
| Real v3 swap and round trip | 1,780,063 | 1,773,115 | 1,592,091 |
| Mock swap, source fill and claim | 1,809,585 | 1,803,029 | 1,622,047 |
| Source cancellation before CREATE | 2,217,290 | 2,212,803 | 2,032,918 |

The final snapshot may differ by a small amount as test dispatch tables change. The recorded comparison held the scenario, fuzz seed and optimizer run count constant. The local mock stores message bytes, so reducing payload disproportionately improves these scenario totals compared with a live router. Do not present the table as a measured percentage saving on public CCIP.

The 2026-11-06 hardening pass refreshed `.gas-snapshot`. Exact source payout
balance checks increase the real-v3 round trip to 1,596,144 scenario gas and the
mock fill/claim to 1,626,100. The table above preserves the earlier optimization
comparison; the snapshot records the current implementation.

## Optimizations retained

- Return receipts are **128 bytes instead of 384 bytes** (256 bytes / 66.7% less application payload). The source already stores immutable terms and their domain-bound hash. A receipt needs only version, outcome, order ID and terms hash, authenticated by the pinned router, remote selector and peer.
- CREATE and CANCEL keep the complete 384-byte envelope so a cancellation arriving first can create a fully committed tombstone.
- The destination no longer reads all five Terms storage slots just to send a terminal receipt.
- Terms pack pairs of uint128 amounts and share the solver-address slot with the uint64 deadline. Bounds are checked at creation; no lossy casts are used on external order amounts.
- No second copy of a receipt payload is persisted: the irreversible terminal state is the outbox.
- via-IR reduced gas in every baseline scenario measured; it is enabled in `foundry.toml`.
- The solver approves only the exact input; router allowance is cleared after execution. We retain this control despite its gas cost.

We retain replay checks, actual balance-delta checks, finality-required CCIP policy, pull claims, and per-route exposure caps. No gas optimization weakens user minimum output, fee/principal separation or destination exclusivity. Tests explicitly reject a compact receipt with a changed terms hash and verify duplicates cannot allocate another payout.
