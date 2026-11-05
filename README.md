# Bisharp

A Next.js frontend and Foundry contracts for conditional asset orders on **Ethereum Sepolia (11155111)**. Based on [PRD.md](PRD.md), with a deliberately smaller, single-chain testnet implementation.

## Implemented scope

- Connect an injected Ethereum wallet and switch to Sepolia.
- Mint free, **unbacked** 6-decimal bUSD and 18-decimal bETH test tokens. Neither token represents money, wrapped ETH, or a redeemable asset.
- Approve the exact input amount, review immutable terms, and escrow bUSD.
- Use a Chainlink ETH/USD feed to enforce `price <= maxPrice`, positive/fresh/nonfuture answers, and a fixed minimum output.
- Any funded solver can approve and deliver the exact bETH output directly to the fixed recipient. Delivery and credit allocation are atomic.
- Owners cancel open orders; anyone can close them at expiry. Cancellation allocates a refund credit. Fill and cancel are mutually exclusive.
- Claim refund or solver credits in a separate transaction to the fixed beneficiary. No administrator can withdraw escrow.
- Simulate contract writes before wallet prompts; persist recent transaction hashes and recover pending receipts after reload; poll on-chain state with stale-data handling.

**Not implemented:** cross-chain transport/CCIP, Whitechain, Uniswap routing, signed solver quotes, keeper automation, production stablecoins, native ETH output, deployment/indexer services, or production security assurance. Single-chain cancellation does not demonstrate the PRD's asynchronous cross-chain safety model. The test token output tracks an ETH/USD *condition*, not a redeemable ETH asset or guaranteed market execution. No protocol fee; users and solvers pay their own gas. All contracts are non-upgradeable and there is no admin.

## Run the frontend

Requirements: Node.js >=20.9 and npm. The lockfile pins the installed dependency graph.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:3000>. The initial interface works without deployment and clearly disables on-chain operations. After deployment, set `NEXT_PUBLIC_ESCROW_ADDRESS` in `.env.local` and restart Next.js. The app reads token/feed addresses from the escrow rather than trusting separate frontend addresses. All configured RPC endpoints must support Ethereum Sepolia. `NEXT_PUBLIC_*` values are public: never put private RPC secrets or wallet keys there.

```powershell
npm run typecheck
npm run build
```

## Foundry

Install [Foundry](https://getfoundry.sh/introduction/installation/). Solidity dependencies use the exact OpenZeppelin version from npm; no `forge install` is needed. If Forge is not on PATH on Windows, use `& "$env:USERPROFILE\.foundry\bin\forge.exe"` in place of `forge`.

```powershell
forge build
forge test -vv
npm run abi
```

Tests cover happy settlement, cancel/fill exclusion, double claims, unauthorized cancellation, the exact expiry boundary, invalid/stale/future oracle data, failed output funding atomicity, and fuzzed principal conservation. A stateful handler schedules create/fill/cancel/claim calls and checks escrow balance and exact liability accounting.

## Deploy to Sepolia

A disposable testing wallet has been generated with `cast wallet new` and stored in the Git-ignored `.env` as `SEPOLIA_PRIVATE_KEY` and `SEPOLIA_DEPLOYER_ADDRESS`. The key is server/deployment-only and must never use a `NEXT_PUBLIC_` prefix. Fund its public address with Ethereum Sepolia ETH. Foundry automatically loads `.env`, and the deployment script uses this key when present:

```powershell
# Simulate with the disposable testnet key from .env.
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url sepolia

# Deploy after the address is funded and the simulation passes.
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast
```

No public deployment has been performed. This wallet is for testnet use only. The `.env` file is local and is not included when cloning the repository.

For an encrypted-keystore alternative, remove `SEPOLIA_PRIVATE_KEY` from `.env` and the shell environment, then import interactively:

```powershell
cast wallet import bisharp-sepolia --interactive
```

Set shell variables for Foundry (Next.js `.env.local` is not automatically loaded by Forge):

```powershell
$env:SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'
$env:PRICE_FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306'
$env:MAX_PRICE_AGE = '3600'

# First simulate; no transaction is broadcast.
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url sepolia --account bisharp-sepolia

# Broadcast using the encrypted keystore after reviewing the simulation.
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url sepolia --account bisharp-sepolia --broadcast
```

`PRICE_FEED` is a **candidate** Sepolia ETH/USD proxy; check the current [official feed directory](https://docs.chain.link/data-feeds/price-feeds/addresses) and verify its identity on your RPC. The script verifies the Sepolia chain ID, deployed feed code, 8 decimals, a positive answer, and freshness before broadcasting. Code and decimals alone do not establish feed identity. `MAX_PRICE_AGE=3600` is a demo policy, not a production heartbeat recommendation; deployment fails if the current feed exceeds it.

The script creates bUSD, bETH, and Bisharp, and writes `deployments/sepolia.json`. **A simulation also writes predicted addresses.** Only configure the frontend after a successful broadcast and receipt/code verification. Record transaction hashes and feed/configuration evidence in your deployment manifest. See [deployments/README.md](deployments/README.md).

## Try the full lifecycle

1. Configure the deployed escrow, open the app, connect a wallet, and switch to Sepolia.
2. Expand “Need test tokens?” and mint bUSD. Keep native Sepolia ETH for gas.
3. Set principal, a nonzero bETH minimum, a trigger, expiry, and optional recipient. Review, approve exact bUSD, then create the order.
4. With a separate solver wallet, mint bETH. Open Solver workspace, approve that order's bETH output, and fill when the fresh trigger is eligible. Claim the solver's earned bUSD. A solver cannot fill to itself: the recipient's balance must actually increase. For a one-wallet demo, create an order with a different recipient address.
5. For a separate open order, cancel as its owner. Claim the returned bUSD from “Your test funds.”
6. Reload to recover recent transaction links. An unconfirmed transaction may still complete: inspect its explorer link before retrying.

The interface loads the **latest 50 global orders** and displays that limit. Older orders are not included in the visible locked total. The aggregate claim balance covers all orders. Use `getOrder(id)`, `cancelOrder(id)` and `claim(beneficiary)` via the contract for older orders; a paginated owner index is future work. One RPC-confirmed receipt is used for testnet UX, not a production finality guarantee. Wallet connection supports the browser's injected provider; WalletConnect/mobile deep links are not included.

## Files

- `src/app/page.tsx`: wallet, order review, lifecycle and solver interface.
- `src/lib/abi.ts`: ABI generated from the compiled Foundry artifact.
- `contracts/src/Bisharp.sol`: escrow, oracle eligibility, settlement, credits.
- `contracts/src/TestToken.sol`: unrestricted demo faucet tokens.
- `contracts/test/Bisharp.t.sol`: unit, fuzz and stateful invariant tests.
- `contracts/test/Adversarial.t.sol`: taxed transfers, frozen claims and reentrant token callbacks.
- `contracts/script/Deploy.s.sol`: Sepolia deployment and manifest output.

For a local viem/ABI integration smoke test, start `anvil --host 127.0.0.1 --chain-id 31337` in another terminal, then run `forge build` and `npm run smoke:local`. The script deploys locally, simulates and submits transactions with Anvil's unlocked development accounts, checks delivery and both claim paths, and refuses any chain other than local 31337. It does not configure the Sepolia-only frontend or deploy publicly.

Implementation references: [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [viem contract simulation](https://viem.sh/docs/contract/simulateContract), [Chainlink Data Feeds API](https://docs.chain.link/data-feeds/api-reference), and [OpenZeppelin Contracts 5.4.0](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.4.0). The deployed source is compiled with Solidity 0.8.28; libraries are pinned by `package-lock.json`.

This prototype is unaudited. Use test assets only. It makes no cross-chain, leaderboard, security-audit, or production-readiness claims.
