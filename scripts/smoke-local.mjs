import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { foundry } from "viem/chains";

// Local unlocked Anvil accounts only. Never accepts keys or a public-network URL.
const transport = http("http://127.0.0.1:8545");
const client = createPublicClient({ chain: foundry, transport });
const wallet = createWalletClient({ chain: foundry, transport });
assert.equal(
  await client.getChainId(),
  31337,
  "Refusing to run outside local Anvil chain 31337",
);
const [owner, solver, recipient] = await wallet.getAddresses();
assert(
  owner && solver && recipient,
  "Start Anvil with unlocked development accounts",
);
const artifact = async (name) =>
  JSON.parse(
    await readFile(
      `out/${name}.sol/${name === "Bisharp.t" ? "MockFeed" : name}.json`,
      "utf8",
    ),
  );
const token = await artifact("TestToken");
const feed = await artifact("Bisharp.t");
const escrow = await artifact("Bisharp");
async function confirmed(hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
}
async function deploy(contract, args = []) {
  const receipt = await confirmed(
    await wallet.deployContract({
      account: owner,
      abi: contract.abi,
      bytecode: contract.bytecode.object,
      args,
    }),
  );
  assert(receipt.contractAddress);
  return receipt.contractAddress;
}
async function write(account, address, abi, functionName, args = []) {
  // Same simulate-before-sign sequence used by the Next.js client.
  const { request } = await client.simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
  });
  return confirmed(await wallet.writeContract(request));
}
const usd = await deploy(token, ["Bisharp Test USD", "bUSD", 6]);
const eth = await deploy(token, ["Bisharp Test Ether", "bETH", 18]);
const oracle = await deploy(feed);
const address = await deploy(escrow, [usd, eth, oracle, 3600n]);
const read = (functionName, args = []) =>
  client.readContract({ address, abi: escrow.abi, functionName, args });
await write(owner, usd, token.abi, "faucet");
await write(solver, eth, token.abi, "faucet");
await write(owner, usd, token.abi, "approve", [address, 200_000_000n]);
await write(solver, eth, token.abi, "approve", [
  address,
  parseUnits("0.05", 18),
]);
const { timestamp } = await client.getBlock();
const terms = [
  100_000_000n,
  parseUnits("0.05", 18),
  parseUnits("2100", 18),
  timestamp + 3600n,
  recipient,
];
await write(owner, address, escrow.abi, "createOrder", terms);
await write(solver, address, escrow.abi, "fillOrder", [1n]);
assert.equal((await read("getOrder", [1n])).status, 2);
assert.equal(
  await client.readContract({
    address: eth,
    abi: token.abi,
    functionName: "balanceOf",
    args: [recipient],
  }),
  parseUnits("0.05", 18),
);
assert.equal(await read("credits", [solver]), 100_000_000n);
await write(solver, address, escrow.abi, "claim", [solver]);
await assert.rejects(() =>
  client.simulateContract({
    account: owner,
    address,
    abi: escrow.abi,
    functionName: "cancelOrder",
    args: [1n],
  }),
);
await write(owner, address, escrow.abi, "createOrder", terms);
await write(owner, address, escrow.abi, "cancelOrder", [2n]);
assert.equal((await read("getOrder", [2n])).status, 3);
await write(owner, address, escrow.abi, "claim", [owner]);
assert.equal(await read("totalLiability"), 0n);
assert.equal(
  await client.readContract({
    address: usd,
    abi: token.abi,
    functionName: "balanceOf",
    args: [address],
  }),
  0n,
);
console.log(
  "PASS: viem deployment, exact approvals, escrow, oracle-eligible delivery, solver claim, rejected late cancel, refund claim, zero residual liabilities.",
);
console.log("Local Anvil only. No public testnet deployment was performed.");
