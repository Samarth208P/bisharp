
# PRD: Bisharp - Cross-Chain Conditional DvP & Limit Orders

## 1. Executive Summary

**Bisharp** is a cross-chain state machine that enables trustless, conditional limit orders and Delivery-versus-Payment (DvP) settlements across independent blockchains.

Users lock stablecoins (USDT) on a source chain (Whitechain). The protocol uses **Chainlink CCIP 2.0** arbitrary messaging to transmit the order parameters to a destination chain (Arbitrum). A keeper monitors **Chainlink Data Feeds**, and when the target price is hit, it executes the swap via **Uniswap**. Crucially, Bisharp guarantees an automated state rollback: if the destination swap fails, times out, or slips, a CCIP 2.0 return message automatically unlocks and refunds the user's funds on the source chain.

## 2. Problem Statement

Current cross-chain DeFi infrastructure is "fire-and-forget."

1. **Stranded Funds:** If a cross-chain swap fails on the destination chain due to slippage or low liquidity, the user's bridged funds are stranded, requiring manual support tickets to recover.
2. **No Conditional Execution:** Existing bridges only support immediate execution. There is no native way to lock funds on Chain A, wait for a specific price oracle condition on Chain B, and execute atomically.
3. **MEV & Front-Running:** Cross-chain limit orders executed by centralized solvers are highly susceptible to MEV extraction.

## 3. Technical Architecture & State Machine

The protocol operates as a **Request-Response Escrow Pattern** utilizing CCIP 2.0 arbitrary messaging.

### Phase 1: Escrow & Intent (Source Chain: Whitechain)

1. User approves and deposits USDT into the `BisharpEscrow` contract on Whitechain.
1. The contract records the order parameters: `{ orderId, targetToken, minPrice, userAddress, timeoutTimestamp }`.
1. The contract pays the CCIP fee and sends an arbitrary message to the `BisharpSolver` contract on the destination chain.

### Phase 2: Monitoring & Execution (Destination Chain: Arbitrum)

1. The `BisharpSolver` receives the CCIP message and stores the order state.
1. An off-chain Keeper (or Chainlink Automation) monitors **Chainlink Data Feeds** for the `targetToken` price.
1. **Execution Path:** If `currentPrice <= minPrice`, the contract executes the swap via **Uniswap V3/V4**. It then sends a CCIP 2.0 "Success" message back to Whitechain to finalize settlement.
1. **Rollback Path:** If the price is never hit, the swap reverts, or the `timeoutTimestamp` is reached, the contract sends a CCIP 2.0 "Failure/Rollback" message back to Whitechain.

### Phase 3: Settlement or Refund (Source Chain: Whitechain)

1. The `BisharpEscrow` contract receives the return CCIP message.
1. If "Success", the escrowed USDT is released to the protocol's settlement account (or minted as a wrapped receipt).
1. If "Failure", the escrowed USDT is **automatically unlocked and refunded** to the user's original wallet.
1. *Safety Valve:* If the destination chain goes offline and no return message is ever sent, the user can manually call `claimRefund(orderId)` after the `timeoutTimestamp` expires.

---

## 4. Partner Integrations & Prize Qualification Checklist

To maximize our chances of winning, we are targeting three specific partner tracks. Below is the exact minimum criteria we must hit to qualify for each.

### 🏆 Track 1: Chainlink - Best use of Chainlink CCIP 2.0 ($3,500)

**Why we fit:** We are using CCIP 2.0 not just for simple token bridging, but for complex, bi-directional arbitrary messaging to coordinate a cross-chain state machine with automated rollback logic.

**Minimum Qualification Requirements:**

- [x] **Use CCIP to make a state change:** The destination contract alters its state upon receiving the initial order, and the source contract alters its state (releasing/refunding funds) upon receiving the return message.
- [x] **Use CCIP inside smart contracts:** Both `BisharpEscrow` (Whitechain) and `BisharpSolver` (Arbitrum) inherit the `CCIPReceiver` and use `_ccipReceive` to process arbitrary bytes.
- [x] **Bonus (Highly Recommended):** Use **Chainlink Data Feeds** on the destination chain to check the price condition before executing the Uniswap swap.

### 🏦 Track 2: Whitechain - Tokenize · Real World Finance ($4,000)

**Why we fit:** We are framing this cross-chain limit order as a **Cross-Chain Delivery-versus-Payment (DvP) and Trade Finance Escrow**. The Whitechain track explicitly asks for "Trade finance flows where... funds are released" and "settlement conditions".

**Minimum Qualification Requirements:**

- [x] **Deploy on Whitechain Sepolia:** Contracts must be deployed on Whitechain Sepolia (Chain ID `1874`) and verified on the explorer.
- [x] **Use Real USDT:** At least one payment in USDT (Token Address: `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`) must be settled on Whitechain in the main flow. (No custom minted test tokens).
- [x] **README Justification:** Include a specific line in the README explaining: *"Why this flow needs onchain stablecoin settlement on Whitechain and what a regular payment rail couldn't do here."* (Answer: Regular rails cannot enforce conditional, cross-chain escrow with automated rollback).
- [x] **Git History:** Public GitHub repo showing steady progress (no single-commit uploads at the end).
- [x] **Demo Video:** 2 to 4 minutes showing the flow.
- [x] **Feedback File:** Include a `WHITECHAIN_FEEDBACK.md` in the repo with honest feedback on docs/tooling.

### 🦄 Track 3: Uniswap Foundation - Build with Uniswap ($10,000 / $5,000)

**Why we fit:** We are using Uniswap as the core execution venue for the destination chain swap, routing the cross-chain liquidity into Uniswap's permissionless pools.

**Minimum Qualification Requirements:**

- [x] **Use Uniswap Protocol:** The `BisharpSolver` contract on the destination chain must call the Uniswap V3 `SwapRouter` or V4 `PoolManager` to execute the actual token swap when the price condition is met.
- [x] **On-chain Execution:** The final demo must show the actual Uniswap swap transaction hash on the destination chain explorer.

---

## 5. 48-Hour Hackathon Execution Plan

### Phase 1: Smart Contracts & Local Simulation (Hours 0 - 16)

- **Tooling:** Foundry (Solidity) + Chainlink CCIP Local Simulator.

- **Tasks:**
    1. Write `BisharpEscrow.sol` (Source) and `BisharpSolver.sol` (Destination).
    1. Implement the CCIP `_ccipReceive` logic to parse the arbitrary bytes (Order ID, Token, Min Price, Timeout).
    1. Implement the Uniswap V3 `exactInputSingle` swap logic in the destination contract.
    1. Write Foundry tests simulating the full Request -> Execute -> Return Message loop using the CCIP Local Simulator.

### Phase 2: Testnet Deployment & Keeper Setup (Hours 16 - 28)

- **Tooling:** Whitechain Sepolia, Arbitrum Sepolia, Chainlink CCIP Testnet.

- **Tasks:**
    1. Deploy contracts to Whitechain Sepolia (Chain ID 1874) and Arbitrum Sepolia. Verify on explorers.
    2. Fund contracts with testnet CCIP fees (LINK) and testnet USDT (`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`).
    3. Write a lightweight TypeScript/Python off-chain keeper script that listens to Chainlink Data Feeds and triggers the destination contract.

### Phase 3: Frontend & Demo Video (Hours 28 - 40)

- **Tooling:** React, Wagmi/Viem, FFMPEG.

- **Tasks:**
    1. Build a minimal UI: "Lock USDT on Whitechain", "View Order Status", "Claim Refund".
    2. Record the demo video. **Crucial:** Spend 30% of the video on the UI, and 70% showing the Etherscan/Whitechain explorer transaction traces, the CCIP message payloads, and the automated refund mechanism.
    3. Write the `README.md`, `WHITECHAIN_FEEDBACK.md`, and architecture diagrams.

### Phase 4: Buffer & Polish (Hours 40 - 48)

- Fix any testnet deployment quirks.

- Ensure all Git commits are pushed with clean messages.
- Submit to Devpost/ETHGlobal platform.

---

## 6. Demo & Pitch Strategy for Judges

**The Hook (30 seconds):**
*"Cross-chain DeFi is broken because it's fire-and-forget. If a swap fails on the destination chain, your funds are stranded. Today, we're introducing Bisharp: the first cross-chain state machine that guarantees automated, trustless refunds using Chainlink CCIP 2.0."*

**The Technical Proof (2 minutes):**
*Do not just show the UI.* Judges for these tracks are protocol engineers.

1. Show the user locking USDT on **Whitechain Sepolia**. Show the exact USDT token address (`0xcedf...`) to prove compliance with the Whitechain track.
2. Show the CCIP transaction on the explorer. Highlight the `data` payload containing the limit order parameters.
3. Show the destination contract on Arbitrum receiving the message.
4. **The Magic Moment:** Show a scenario where the price condition *fails* or times out. Show the destination contract sending the CCIP return message. Show the Whitechain contract receiving it and **automatically unlocking the USDT back to the user's wallet** without any human intervention.

**The Close (30 seconds):**
*"We used Whitechain for the conditional escrow, Chainlink CCIP 2.0 for the bi-directional state coordination, and Uniswap for the destination execution. We didn't just bridge tokens; we bridged state, safely."*
