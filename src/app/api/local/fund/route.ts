import { createPublicClient, createTestClient, http, isAddress } from "viem";

export async function POST(request: Request) {
  if (
    process.env.NETLIFY === "true" ||
    process.env.NEXT_PUBLIC_ENABLE_LOCAL !== "true"
  )
    return Response.json(
      { error: "Local fixtures are disabled." },
      { status: 404 },
    );
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    const { address, chainId } = body as {
      address?: unknown;
      chainId?: unknown;
    };
    if (
      typeof address !== "string" ||
      !isAddress(address) ||
      typeof chainId !== "number" ||
      ![31337, 31338].includes(chainId)
    )
      return Response.json(
        { error: "Valid address and local chain ID required." },
        { status: 400 },
      );
    const transport = http(
      chainId === 31337 ? "http://127.0.0.1:8545" : "http://127.0.0.1:9545",
      { timeout: 3000, retryCount: 0 },
    );
    const client = createPublicClient({ transport });
    if ((await client.getChainId()) !== chainId)
      throw new Error("Unexpected local chain ID");
    // Development-only Anvil RPC. No signer, key, public RPC or public funds are used.
    await createTestClient({ mode: "anvil", transport }).setBalance({
      address,
      value: 10n * 10n ** 18n,
    });
    return Response.json({ address, chainId, localETH: "10", localOnly: true });
  } catch {
    return Response.json(
      { error: "Local Anvil node unavailable. Start npm run demo:local." },
      { status: 503 },
    );
  }
}
