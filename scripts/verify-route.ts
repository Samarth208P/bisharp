import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createPublicClient, encodeAbiParameters, http, parseAbi } from "viem";
try {
  loadEnvFile(".env.local");
} catch {}
const { configuredRoutes } = await import("../src/lib/routes.ts");
const config = configuredRoutes();
if (config.error) throw new Error(config.error);
const sourceAbi = JSON.parse(
  await readFile("out/SourceEscrow.sol/SourceEscrow.json", "utf8"),
).abi;
const destAbi = JSON.parse(
  await readFile(
    "out/DestinationExecutor.sol/DestinationExecutor.json",
    "utf8",
  ),
).abi;
const routerAbi = parseAbi([
  "function isChainSupported(uint64) view returns (bool)",
]);
let checked = 0;
for (const route of config.routes) {
  if (!route.configured || !route.escrow || !route.executor) continue;
  const source = createPublicClient({
    chain: route.source.chain,
    transport: http(route.source.rpc),
  });
  const destination = createPublicClient({
    chain: route.destination.chain,
    transport: http(route.destination.rpc),
  });
  assert.equal(await source.getChainId(), route.source.chain.id);
  assert.equal(await destination.getChainId(), route.destination.chain.id);
  for (const [client, address, abi, peer, local, remote] of [
    [
      source,
      route.escrow,
      sourceAbi,
      route.executor,
      route.source.selector,
      route.destination.selector,
    ],
    [
      destination,
      route.executor,
      destAbi,
      route.escrow,
      route.destination.selector,
      route.source.selector,
    ],
  ] as const) {
    const get = (functionName: string, args: readonly unknown[] = []) =>
      client.readContract({ address, abi, functionName, args });
    assert.equal(
      ((await get("peer")) as string).toLowerCase(),
      peer.toLowerCase(),
      "peer mismatch",
    );
    assert.equal(await get("localSelector"), local, "local selector mismatch");
    assert.equal(
      await get("remoteSelector"),
      remote,
      "remote selector mismatch",
    );
    assert.equal(
      await get("pairingAuthority"),
      "0x0000000000000000000000000000000000000000",
      "pairing not finalized",
    );
    const router = (await get("getRouter")) as `0x${string}`;
    assert.equal(
      await client.readContract({
        address: router,
        abi: routerAbi,
        functionName: "isChainSupported",
        args: [remote],
      }),
      true,
      "unsupported lane",
    );
    const policy = (await get("getCCVsAndFinalityConfig", [
      remote,
      encodeAbiParameters([{ type: "address" }], [peer]),
    ])) as readonly [unknown, unknown, unknown, string];
    assert.equal(policy[3], "0x00000000", "receiver allows non-final messages");
  }
  const price = (await destination.readContract({
    address: route.executor,
    abi: destAbi,
    functionName: "currentPrice",
  })) as bigint;
  assert(price > 0n, "price is not valid and fresh");
  console.log(
    `PASS ${route.id}: chain IDs, immutable pairing, both selectors, both router lanes, finality policy, fresh price.`,
  );
  checked++;
}
if (!checked)
  throw new Error(
    "No configured route was verified. Deploy locally or configure paired contracts first.",
  );
