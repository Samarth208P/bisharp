import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";

const root = process.cwd();
const binary = (name) =>
  join(
    homedir(),
    ".foundry",
    "bin",
    `${name}${process.platform === "win32" ? ".exe" : ""}`,
  );
const developer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const smokeOnly = process.argv.includes("--smoke");
function localPort(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error(
      "Local demo ports must be integers between 1024 and 65535.",
    );
  return Number(value);
}
const sourcePort = localPort(process.env.BISHARP_LOCAL_SOURCE_PORT, 8545);
const destinationPort = localPort(
  process.env.BISHARP_LOCAL_DESTINATION_PORT,
  9545,
);
if (sourcePort === destinationPort)
  throw new Error("Local source and destination ports must be distinct.");
if (!smokeOnly && (sourcePort !== 8545 || destinationPort !== 9545))
  throw new Error(
    "Custom ports require --smoke; the browser fixture uses ports 8545 and 9545.",
  );
const endpoints = [
  { id: 31337, port: sourcePort, selector: 1n, name: "Local source" },
  { id: 31338, port: destinationPort, selector: 2n, name: "Local destination" },
].map((e) => ({
  ...e,
  rpc: `http://127.0.0.1:${e.port}`,
  chain: defineChain({
    id: e.id,
    name: e.name,
    nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`http://127.0.0.1:${e.port}`] } },
  }),
}));
const children = [];
const nodeLogs = [];
let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) child.kill();
  for (const file of nodeLogs) void file.close().catch(() => {});
}
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
const occupied = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
const artifact = async (name) =>
  JSON.parse(await readFile(`out/${name}.sol/${name}.json`, "utf8"));
async function command(executable, args, env = {}, logFile) {
  const log = await open(logFile, "w");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, ...env, RUST_LOG: "error" },
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
    });
    children.push(child);
    child.once("error", async (e) => {
      await log.close();
      reject(e);
    });
    child.once("exit", async (code) => {
      await log.close();
      code === 0
        ? resolve()
        : reject(
            new Error(`Foundry command failed (${code}). See ${logFile}.`),
          );
    });
  });
}
const client = (e) =>
  createPublicClient({
    chain: e.chain,
    transport: http(e.rpc, { retryCount: 0, timeout: 3000 }),
  });
const wallet = (e, account) =>
  createWalletClient({ chain: e.chain, transport: http(e.rpc), account });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function write(
  e,
  account,
  address,
  abi,
  functionName,
  args = [],
  value = 0n,
) {
  const { request } = await client(e).simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
    value,
  });
  const receipt = await client(e).waitForTransactionReceipt({
    hash: await wallet(e, account).writeContract(request),
  });
  assert.equal(receipt.status, "success");
  return receipt;
}
try {
  await mkdir(".tools", { recursive: true });
  for (const endpoint of endpoints)
    if (await occupied(endpoint.port))
      throw new Error(
        `Port ${endpoint.port} is already occupied. No existing process was stopped or modified.`,
      );
  for (const endpoint of endpoints) {
    const log = await open(`.tools/anvil-${endpoint.id}.log`, "w");
    nodeLogs.push(log);
    const child = spawn(
      binary("anvil"),
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(endpoint.port),
        "--chain-id",
        String(endpoint.id),
        "--silent",
      ],
      {
        stdio: ["ignore", log.fd, log.fd],
        windowsHide: true,
        env: { ...process.env, RUST_LOG: "error" },
      },
    );
    child.on("error", (error) => {
      console.error(error.message);
      stop();
    });
    children.push(child);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        assert.equal(await client(endpoint).getChainId(), endpoint.id);
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error(`${endpoint.name} did not start.`);
  }
  console.log(
    "Two isolated Anvil chains started (31337 and 31338). Public testnet keys and funds are not used.",
  );
  const [sourceEndpoint, destinationEndpoint] = endpoints;
  const script = "contracts/script/DeployLocal.s.sol:DeployLocal";
  const forge = async (fn, endpoint, env = {}) =>
    command(
      binary("forge"),
      [
        "script",
        script,
        "--sig",
        `${fn}()`,
        "--rpc-url",
        endpoint.rpc,
        "--broadcast",
        // Serialize unlocked sends: batched local submissions can be assigned
        // mismatched nonces and leave the remaining deployment queue stranded.
        "--slow",
        "--unlocked",
        "--sender",
        developer,
        "--non-interactive",
      ],
      env,
      `.tools/${fn}.log`,
    );
  await forge("deploySource", sourceEndpoint);
  console.log("Local source deployed with Foundry.");
  await forge("deployDestination", destinationEndpoint);
  console.log("Local destination deployed with real Uniswap v3 pool bytecode.");
  const source = JSON.parse(
    await readFile("deployments/local-source.json", "utf8"),
  );
  const destination = JSON.parse(
    await readFile("deployments/local-destination.json", "utf8"),
  );
  const pairing = {
    LOCAL_SOURCE_ADDRESS: source.escrow,
    LOCAL_DESTINATION_ADDRESS: destination.executor,
  };
  await forge("pairSource", sourceEndpoint, pairing);
  await forge("pairDestination", destinationEndpoint, pairing);
  const sourceAbi = (await artifact("SourceEscrow")).abi,
    destAbi = (await artifact("DestinationExecutor")).abi;
  const tokenAbi = (await artifact("TestToken")).abi,
    routerAbi = (await artifact("LocalRouter")).abi;
  assert.equal(
    await client(sourceEndpoint).readContract({
      address: source.escrow,
      abi: sourceAbi,
      functionName: "peer",
    }),
    destination.executor,
  );
  const cursor = [0n, 0n];
  const queued = parseAbi([
    "event Queued(bytes32 indexed messageId, uint64 destinationSelector, address receiver, address sender, bytes data)",
  ])[0];
  async function relay() {
    for (let i = 0; i < 2; i++) {
      const from = endpoints[i],
        to = endpoints[1 - i];
      const fromDeployment = i === 0 ? source : destination,
        toDeployment = i === 0 ? destination : source;
      const block = await client(from).getBlockNumber({ cacheTime: 0 });
      if (cursor[i] > block) continue;
      const logs = await client(from).getLogs({
        address: fromDeployment.router,
        event: queued,
        fromBlock: cursor[i],
        toBlock: block,
      });
      for (const log of logs) {
        const a = log.args;
        assert.equal(a.destinationSelector, to.selector);
        assert.equal(
          a.sender.toLowerCase(),
          (i === 0 ? source.escrow : destination.executor).toLowerCase(),
        );
        assert.equal(
          a.receiver.toLowerCase(),
          (i === 0 ? destination.executor : source.escrow).toLowerCase(),
        );
        await write(to, developer, toDeployment.router, routerAbi, "relay", [
          a.messageId,
          from.selector,
          a.sender,
          a.receiver,
          a.data,
        ]);
      }
      cursor[i] = block + 1n;
    }
  }
  const accounts = await wallet(sourceEndpoint, developer).getAddresses();
  const owner = accounts[0],
    solver = accounts[1],
    recipient = accounts[2];
  const deadline = (await client(sourceEndpoint).getBlock()).timestamp + 86400n;
  const terms = {
    owner,
    recipient,
    solver,
    deadline,
    principal: 5_000_000n,
    amountIn: 5_000_000n,
    minOutput: 1_500_000_000_000_000n,
    maxPrice: 2100n * 10n ** 18n,
  };
  await write(sourceEndpoint, owner, source.inputToken, tokenAbi, "approve", [
    source.escrow,
    10_000_000n,
  ]);
  await write(
    destinationEndpoint,
    solver,
    destination.inputToken,
    tokenAbi,
    "faucet",
  );
  await write(
    destinationEndpoint,
    solver,
    destination.inputToken,
    tokenAbi,
    "approve",
    [destination.executor, terms.amountIn],
  );
  await write(
    sourceEndpoint,
    owner,
    source.escrow,
    sourceAbi,
    "createOrder",
    [terms, 400000],
    1_000_000_000_000n,
  );
  await relay();
  await write(
    destinationEndpoint,
    solver,
    destination.executor,
    destAbi,
    "fillOrder",
    [1n],
  );
  await assert.rejects(() =>
    client(sourceEndpoint).simulateContract({
      account: owner,
      address: source.escrow,
      abi: sourceAbi,
      functionName: "claim",
      args: [1n],
    }),
  );
  await write(
    destinationEndpoint,
    solver,
    destination.executor,
    destAbi,
    "dispatchReceipt",
    [1n, 300000],
    1_000_000_000_000n,
  );
  await relay();
  await write(sourceEndpoint, owner, source.escrow, sourceAbi, "claim", [1n]);
  await write(
    sourceEndpoint,
    owner,
    source.escrow,
    sourceAbi,
    "createOrder",
    [terms, 400000],
    1_000_000_000_000n,
  );
  await write(
    sourceEndpoint,
    owner,
    source.escrow,
    sourceAbi,
    "requestCancel",
    [2n, 400000],
    1_000_000_000_000n,
  );
  await relay();
  await write(
    destinationEndpoint,
    solver,
    destination.executor,
    destAbi,
    "dispatchReceipt",
    [2n, 300000],
    1_000_000_000_000n,
  );
  await relay();
  await write(sourceEndpoint, owner, source.escrow, sourceAbi, "claim", [2n]);
  assert.equal(
    await client(sourceEndpoint).readContract({
      address: source.escrow,
      abi: sourceAbi,
      functionName: "totalLiability",
    }),
    0n,
  );
  const output = await client(destinationEndpoint).readContract({
    address: destination.outputToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [recipient],
  });
  assert(output >= terms.minOutput);
  console.log(
    "PASS: two-chain registration, real Uniswap swap, delayed receipt protection, solver claim, cancellation/refund and zero source liabilities.",
  );
  await writeFile(
    "deployments/local-smoke-summary.json",
    JSON.stringify(
      {
        localOnly: true,
        transport: "Unauthenticated local fixture, not live CCIP",
        chains: [31337, 31338],
        source: source.escrow,
        destination: destination.executor,
        deliveredOutput: output.toString(),
        sourceLiability: "0",
        result: "passed",
      },
      null,
      2,
    ),
  );
  if (smokeOnly) {
    stop();
  } else {
    const routes = [
      {
        id: "local-demo",
        sourceChainId: 31337,
        destinationChainId: 31338,
        escrow: source.escrow,
        executor: destination.executor,
      },
    ];
    let env = await readFile(".env.local", "utf8").catch(() => "");
    for (const [key, value] of Object.entries({
      NEXT_PUBLIC_ENABLE_LOCAL: "true",
      NEXT_PUBLIC_ROUTES_JSON: JSON.stringify(routes),
    })) {
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^${key}=.*$`, "m");
      env = pattern.test(env)
        ? env.replace(pattern, line)
        : `${env.trimEnd()}\n${line}\n`;
    }
    await writeFile(".env.local", env.trimStart());
    console.log(
      "Public local route configuration written to Git-ignored .env.local. Restart Next.js if needed.",
    );
    console.log(
      "Use an Anvil development account, not the funded testnet wallet. Local relayer is running; Ctrl+C stops both nodes.",
    );
    while (!stopping) {
      await relay();
      await delay(1500);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
}
