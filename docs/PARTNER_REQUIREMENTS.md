# Partner requirements and evidence

User-selected targets: **Chainlink CCIP 2.0** and **Uniswap Foundation**. The supplied prize JSON is supporting material; current authoritative rules are the [ETHGlobal Mumbai prize page](https://ethglobal.com/events/mumbai/prizes), checked 2026-11-05. Recheck at submission time. Prize selection, eligibility and judging are not guaranteed by this repository.

Hosted frontend: [bisharp.netlify.app](https://bisharp.netlify.app/). Public
contract addresses and the pending pairing status are recorded in
[deployments/README.md](../deployments/README.md). Hosting alone does not prove
public CCIP delivery or a public order fill.

## Chainlink: Best use of CCIP 2.0

- Required: CCIP used inside smart contracts to cause an on-chain state change. Price-feed reads alone do not qualify.
- Intended evidence: authenticated CREATE from Ethereum Sepolia registers an order on OP Sepolia; destination FILLED/CANCELLED receipts allocate exactly one source entitlement. Retain source transactions, CCIP message IDs, destination execution transactions, contract addresses, verified source and configuration.
- Current status: **implemented and tested locally; public criterion not yet met**. SourceEscrow and DestinationExecutor use pinned CCIP 2.0 contracts, V3 arguments and authenticated terminal receipts. Both main contracts are publicly deployed and source-verified; pairing and real public CCIP execution evidence remain outstanding. The local transport fixture cannot satisfy the on-chain CCIP requirement.
- CRE is a separate track; no CRE workflow is claimed.

## Uniswap Foundation: Build with Uniswap

- Official rules allow integration with the Uniswap AMM v2, v3 or v4 and other parts of its stack. A v4 hook is not mandatory.
- The live page adds requirements missing from the supplied JSON: a public open-source GitHub repository, `FEEDBACK.md`, and a completed [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) linking that file. README must point to the integration contracts/code. Form submission remains outstanding until actually sent with the public repository URL.
- Intended integration: solver funds one fixed v3 exact-input route; immutable minimum output and recipient are enforced by the destination executor. No arbitrary router or calldata.
- Intended evidence: pinned official router/factory/pool addresses, an actual swap transaction with token balance deltas, repeatable fork/integration tests, and a demo showing the output reaching the user.
- Current status: **integration exercised locally against official protocol bytecode**. RealV3 tests and the two-node demo execute actual pool swaps. FEEDBACK.md exists. The source repository is [Samarth208P/bisharp](https://github.com/Samarth208P/bisharp) (public); the feedback form remains outstanding. The supplied JSON has empty detailed requirements for Uniswap; the live page's additional obligations remain mandatory.

## Submission evidence that cannot be inferred

The public repository and hosted frontend URLs are recorded above. Permitted event track, participant registration/team eligibility, demo video and the final submission must still be supplied or completed truthfully. Local commits establish actual progress from this point; never backdate or fabricate earlier event work. The configured GitHub repository is [Samarth208P/bisharp](https://github.com/Samarth208P/bisharp). Do not mark a prize requirement complete merely because code compiles or mock tests pass.

Whitechain is not a selected target. Its requirements include a verified Whitechain Sepolia deployment and a payment with the specified partner USDT. Neither funding OP Sepolia nor minting our own token fulfills those requirements.
