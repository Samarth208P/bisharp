import { createPublicClient, http, isAddress, isHash, formatEther } from "viem";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";

export default async function LocalExplorer({
  params,
}: {
  params: Promise<{ chain: string; kind: string; value: string }>;
}) {
  const { chain, kind, value } = await params;
  if (
    process.env.NEXT_PUBLIC_ENABLE_LOCAL !== "true" ||
    !["31337", "31338"].includes(chain)
  )
    notFound();
  if (kind !== "address" && kind !== "tx") notFound();
  if (kind === "address" ? !isAddress(value) : !isHash(value)) notFound();
  const rpcUrl =
    chain === "31337" ? "http://127.0.0.1:8545" : "http://127.0.0.1:9545";
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 3000, retryCount: 0 }),
  });
  let result: unknown;
  try {
    if ((await client.getChainId()) !== Number(chain))
      throw new Error("Wrong local chain ID");
    if (kind === "address") {
      const address = value as `0x${string}`;
      const [balance, code, nonce, block] = await Promise.all([
        client.getBalance({ address }),
        client.getCode({ address }),
        client.getTransactionCount({ address }),
        client.getBlockNumber(),
      ]);
      result = {
        address,
        nativeETH: formatEther(balance),
        bytecodeBytes: code ? (code.length - 2) / 2 : 0,
        nonce,
        block,
      };
    } else {
      const hash = value as `0x${string}`;
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
      result = { transaction, receipt };
    }
  } catch (e) {
    result = {
      error:
        e instanceof Error
          ? e.message
          : "Local RPC unavailable. Start npm run demo:local.",
    };
  }
  return (
    <main className="local-explorer">
      <a href="/">← Back to Bisharp</a>
      <h1>Local chain {chain}</h1>
      <p>
        Read-only development inspector. This is an Anvil fixture, not a public
        blockchain explorer or CCIP execution proof.
      </p>
      <pre>
        {JSON.stringify(
          result,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        )}
      </pre>
    </main>
  );
}
