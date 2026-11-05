# Research applicability

Reviewed 2026-11-05 against the supplied RESEARCH.md, PRD.md, and official implementation references. This is an engineering review, not a formal proof or audit.

| Research topic | Decision for Bisharp | Reason |
| --- | --- | --- |
| Separate execution from transport | Adopt | A committed destination fill must survive return-message fee exhaustion. Persist a terminal receipt and dispatch/retry separately. |
| Pull payments and CEI | Adopt | Token blacklisting or a reverting beneficiary must not prevent receipt reconciliation. Failed claims retain the same beneficiary's credit. |
| CCIP 2.0 policy | Use pinned official 2.0 contracts, V3 extra args and finality-required receiver policy | Legacy API compatibility does not establish use of the new verification model. Test caller, remote selector, sender, payload and replay validation. |
| Catch failed swaps in receiver | Separate registration and execution instead | Register immutable orders in the receiver; execute swaps in independent solver transactions. A failed swap rolls back funding and remains retryable. |
| Automatically loosen slippage on retry | Reject | A retry cannot change the user's minimum output, recipient or economic terms. |
| Deterministic bounded refunds | Reject for the selected transport model | A maximum network delay assumption is absent. Source expiry cannot establish destination non-execution. Only an authenticated terminal cancellation permits a refund. |
| Instantaneous/global atomicity | Do not claim | Destination delivery precedes source payment; messaging/finality failure can delay reimbursement indefinitely. |
| V4 hooks, decryption oracles, VSA, alternative verification fabrics | Outside the selected route | These do not remove the need to authenticate receipts or prove that this concrete implementation is safe. No validated implementation or proof was supplied. |
| Formal verification | Outstanding release gate | Passing fuzz campaigns is evidence for tested properties, not a theorem of arbitrary liveness or absence of all flaws. |

Use the protocol's wait-for-finality setting. Do not introduce Faster-Than-Finality solely to reduce demo latency. Source principal, message fees and destination solver capital must remain separate.

References: [CCIPReceiver 2.0](https://docs.chain.link/ccip/api-reference/evm/v2.0.0/ccip-receiver), [CCIP V3 message arguments](https://docs.chain.link/ccip/evm/tutorials/application-developers/send-arbitrary-data), [Data Feeds API](https://docs.chain.link/data-feeds/api-reference), [Uniswap v3 single-hop swaps](https://docs.uniswap.org/contracts/v3/guides/swaps/single-swaps). Implementation dependencies and their integrity hashes are pinned in the dependency lockfile; deployed bytecode/configuration and chain transaction evidence must be recorded separately.
