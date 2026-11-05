# Work history

Append dated entries for meaningful work. Include request, files changed, reasons, validation and remaining work. Distinguish proposed requirements from implemented/deployed behavior. Never record planned work or unchecked tests as completed.

## 2026-11-05 — PRD review and design revision

Request: find flaws in the Bisharp DeFi PRD, improve the specification and maintain history.md.

Changes:

- Preserved existing PRD working copy, including pre-existing uncommitted edits, as PRD.original.md.
- Added PRD_REVIEW.md with 16 ranked findings, a timeout double-payment sequence, architecture alternatives, official sources and verification limits.
- Revised PRD.md with proposed solver funding, immutable settlement identities, destination fill/cancel exclusivity, terminal receipt retries, principal/fee solvency, output/oracle protection, recovery UX, metrics and release gates.
- Replaced unsupported completion/integration assumptions with evidence requirements. Whitechain remains a candidate pending route verification.
- Initialized this work log. No application code, deployment, Git commit or competition submission was performed.

Validation:

- Inspected repository contents and Git status/diff/history. Initially only PRD.md and Git metadata were present.
- Consulted targeted official Chainlink, Uniswap and Whitechain documentation; evidence and limits are in PRD_REVIEW.md.
- Reviewed lifecycle requirements against late success, cancellation races, CANCEL-before-CREATE, duplicates, swap revert and fee exhaustion at specification level.
- Checked local Markdown links, original-copy preservation and diff whitespace after edits.
- No runtime tests exist or were run. Documentation checks do not establish protocol security.

Remaining work: verify deployment manifest and event rules; confirm solver/economic limits; implement contracts and frontend; execute adversarial/integration tests; satisfy independent production review before real deposits.

## 2026-11-05 — Next.js and Foundry Sepolia prototype

Request: build Bisharp using PRD.md as supporting documentation, Next.js, Foundry, Ethereum Sepolia and a simple frontend.

Implemented a single-chain testnet subset: unbacked faucet bUSD/bETH, immutable conditional orders, fresh ETH/USD oracle checks, solver-funded ERC-20 delivery, mutually exclusive fills/cancellations, separate pull claims and liability accounting. Added the Next.js workspace with injected wallet connection, network switching, exact approvals, order review, solver controls, faucet controls, receipt tracking and RPC/staleness handling. Added a Sepolia-only Foundry deployment script, generated ABI, environment template, lockfile, local viem integration script and README setup/scope documentation. Preserved the pre-existing PRD and review documents.

Validation: TypeScript and Next.js production build passed; local HTTP returned 200 with workspace and deployment instructions. Foundry unit/fuzz/adversarial tests and a 128-run, 4,096-call stateful invariant campaign passed. The local Anvil/viem smoke test deployed contracts, simulated/submitted writes, verified actual delivery, solver payment, cancellation/refund and zero residual liabilities. No Sepolia broadcast was performed. Browser tools reported no available browser/native host, so visual layout and wallet UI interactions remain unverified.

Scope boundary: no CCIP/bridge, Uniswap, signed quotes, automated keeper, production assets, audit, production finality policy or public deployment. Single-chain cancellation is atomic and must not be presented as cross-chain cancellation. The UI loads the latest 50 global orders and labels the limit; older-order recovery is documented through direct contract calls. A funded Sepolia keystore and live feed/configuration verification are required for public testnet deployment. Test assets only.

## 2026-11-05 — Disposable Foundry test wallet

Request: generate a new testing key pair with Foundry, put the key in the environment and provide a faucet/funding address. Generated with `cast wallet new` and verified the derived address using `cast wallet address`. Saved the private key only in Git-ignored, untracked `.env` as `SEPOLIA_PRIVATE_KEY`; saved its public address as `SEPOLIA_DEPLOYER_ADDRESS`. The private key was not printed. Updated the deployment script to use the optional test key while preserving the keystore fallback, and documented both workflows. Public address: `0xdA600Dcd13E8BaB17E3c5f35242d840B8c88cB92`. No public transaction or deployment was performed; funding is pending.

## 2026-11-05 — Destination funding confirmed on OP Sepolia

User funded OP Sepolia rather than Arbitrum Sepolia. Foundry read-only RPC checks returned chain ID 11155420, successful receipt for `0x2e01d9667a3c8f6e8e30359831a0c45693e67ec07ff1bfd4852903599bdf7906`, the generated wallet as recipient, and a 0.2 ETH balance. The earlier Ethereum Sepolia receipt was also successful and its wallet balance was verified as 0.2 ETH. Added OP_SEPOLIA_RPC_URL to local .env and the public environment template, and an op_sepolia Foundry RPC alias. This selects the funded destination for further implementation; it does not change the single-chain contracts into cross-chain contracts. No transactions were broadcast by the agent. Chainlink's OP Sepolia directory lists native ETH fee support and an outbound lane to Ethereum Sepolia; round-trip application integration remains untested.

## 2026-11-06 — Cross-chain local release candidate

Request: use RESEARCH.md and the supplied ETHGlobal prize JSON, improve correctness and gas, perform proper fuzz testing, fulfill selected partner requirements and commit frequently. User selected Chainlink and Uniswap, then explicitly deferred publishing and public deployment while prioritizing local quality and multiple-chain compatibility.

Implemented SourceEscrow, DestinationExecutor and a permanently paired CCIPLane using unchanged pinned CCIP 2.0 receiver/codec sources. Orders bind domain, identities, amounts and deadline. Cancellation is destination-arbitrated; authenticated outcomes allocate one immutable beneficiary and claims are separate. Added real v3 exact-input execution with fixed pool/router, oracle and optional sequencer checks, actual balance deltas, exact solver funding, cleared allowances and exposure caps. Native fee change and ERC-20 principal have independent ledgers. Terminal receipts are compact 128-byte commitments instead of repeating 384-byte terms; CREATE/CANCEL retain complete terms for tombstones. via-IR and gas comparisons are recorded in reports/GAS.md.

Replaced the main frontend with two-chain reads, pairing/selector validation, paginated owner/global orders, exact approvals, explicit order review, network switching, solver fills, cancellation/expiry, receipt retries, fixed-beneficiary claims, native fee-change recovery, transaction/message persistence and separate RPC freshness. Added Ethereum Sepolia, OP Sepolia, Arbitrum Sepolia and Base Sepolia configuration presets; these are not claims of public deployment. Added a two-Anvil-node Foundry fixture, real Uniswap pool liquidity, local relaying, development inspector and strictly local native-gas faucet. Local transport/oracle are prominently labeled mocks and cannot be deployed to public chain IDs.

The fresh local redeployment caught a formatting regression in duplicated square-root helpers. Replaced them with pinned OpenZeppelin Math.sqrt, reran real-v3 tests and the complete two-node demo successfully, then reran the extended campaign. No public funds were used. Local demo output: 2,486,302,890,046,558 wei of wrapped local ETH delivered for the tested 5 bUSD input; both settlement and cancellation/refund completed with zero residual source liabilities.

Final verification: 37 Foundry tests passed, 40,000 fuzz cases, 262,144 stateful invariant calls, deterministic seed 0x6d756d626169. Seven frontend/API tests passed. Type generation/typecheck, production build, formatting check and high-severity Forge lint on cross-chain source passed. Local route verification passed; workspace and inspector HTTP responses were 200; the local gas faucet rejected an Ethereum Sepolia target with 400. Public static assets were scanned against the configured deployment key and contained no match; key values were never printed. Reports and local manifests are retained without raw logs or environment secrets.

Partner rules were checked against the official event page, which adds Uniswap requirements absent from the JSON: FEEDBACK.md, public open-source GitHub and a developer feedback form linking that file. Added FEEDBACK.md, docs/PARTNER_REQUIREMENTS.md, docs/RESEARCH_REVIEW.md, docs/LOCAL_REVIEW.md, README setup/recovery instructions and a prepared CI workflow. Real CCIP public-chain state-change/message evidence, public hosting/source verification, feedback form/video/submission and independent production review remain outstanding/deferred. Browser/native automation host is unavailable, so visual layout and wallet-click flows were not verified. No Git push or external form submission was performed.

Git checkpoints use actual short commit messages and timestamps; no fabricated or backdated event history. Initial checkpoint preserved the user's PRD/research working state. Production flawlessness, formal verification and partner eligibility are not claimed.
