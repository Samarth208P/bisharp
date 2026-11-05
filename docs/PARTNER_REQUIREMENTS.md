# Partner requirements and evidence

User-selected targets: **Chainlink CCIP 2.0** and **Uniswap Foundation**. The supplied prize JSON is supporting material; current authoritative rules are the [ETHGlobal Mumbai prize page](https://ethglobal.com/events/mumbai/prizes), checked 2026-11-05. Recheck at submission time. Prize selection, eligibility and judging are not guaranteed by this repository.

## Chainlink: Best use of CCIP 2.0

- Required: CCIP used inside smart contracts to cause an on-chain state change. Price-feed reads alone do not qualify.
- Intended evidence: authenticated CREATE from Ethereum Sepolia registers an order on OP Sepolia; destination FILLED/CANCELLED receipts allocate exactly one source entitlement. Retain source transactions, CCIP message IDs, destination execution transactions, contract addresses, verified source and configuration.
- Status at baseline: **not met**. The existing single-chain prototype has no CCIP integration. Implementation and evidence must be added before changing this status.
- CRE is a separate track; no CRE workflow is claimed.

## Uniswap Foundation: Build with Uniswap

- Official rules allow integration with the Uniswap AMM v2, v3 or v4 and other parts of its stack. A v4 hook is not mandatory.
- The live page adds requirements missing from the supplied JSON: a public open-source GitHub repository, `FEEDBACK.md`, and a completed [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) linking that file. README must point to the integration contracts/code. Form submission remains outstanding until actually sent with the public repository URL.
- Intended integration: solver funds one fixed v3 exact-input route; immutable minimum output and recipient are enforced by the destination executor. No arbitrary router or calldata.
- Intended evidence: pinned official router/factory/pool addresses, an actual swap transaction with token balance deltas, repeatable fork/integration tests, and a demo showing the output reaching the user.
- Status at baseline: **not met**. Direct demo-token transfers are not Uniswap swaps. The supplied JSON has empty detailed requirements for Uniswap; verify the live page rather than treating an empty array as no obligations.

## Submission evidence that cannot be inferred

Public repository URL, permitted event track, participant registration/team eligibility, demo video, live demo URL, and the final submission must be supplied or completed truthfully. Local commits establish actual progress from this point; never backdate or fabricate earlier event work. Current repository has no configured Git remote. Do not mark a prize requirement complete merely because code compiles or mock tests pass.

Whitechain is not a selected target. Its requirements include a verified Whitechain Sepolia deployment and a payment with the specified partner USDT. Neither funding OP Sepolia nor minting our own token fulfills those requirements.
