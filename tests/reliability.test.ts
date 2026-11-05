import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredRoutes, parseRoutes } from "../src/lib/routes.ts";
import { POST } from "../src/app/api/local/fund/route.ts";

const wallet = "0x0000000000000000000000000000000000000001";
const executor = "0x0000000000000000000000000000000000000002";
const route = {
  id: "eth-op",
  sourceChainId: 11155111,
  destinationChainId: 11155420,
  escrow: wallet,
  executor,
};

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("an invalid configured solver cannot silently become the owner's wallet", () => {
  for (const solver of ["typo", "0x0000000000000000000000000000000000000000"]) {
    withEnv(
      {
        NEXT_PUBLIC_ROUTES_JSON: undefined,
        NEXT_PUBLIC_SOURCE_ADDRESS: wallet,
        NEXT_PUBLIC_DESTINATION_ADDRESS: executor,
        NEXT_PUBLIC_SOLVER_ADDRESS: solver,
      },
      () => {
        const config = configuredRoutes();
        assert.equal(config.routes.length, 0);
        assert.match(config.error || "", /NEXT_PUBLIC_SOLVER_ADDRESS/);
      },
    );
  }
});

test("fallback deployments distinguish invalid addresses from unset addresses", () => {
  withEnv(
    {
      NEXT_PUBLIC_ROUTES_JSON: undefined,
      NEXT_PUBLIC_SOURCE_ADDRESS: "misspelled-address",
      NEXT_PUBLIC_DESTINATION_ADDRESS: executor,
      NEXT_PUBLIC_SOLVER_ADDRESS: undefined,
    },
    () =>
      assert.match(
        configuredRoutes().error || "",
        /NEXT_PUBLIC_SOURCE_ADDRESS/,
      ),
  );
  withEnv(
    {
      NEXT_PUBLIC_ROUTES_JSON: undefined,
      NEXT_PUBLIC_SOURCE_ADDRESS: undefined,
      NEXT_PUBLIC_DESTINATION_ADDRESS: undefined,
      NEXT_PUBLIC_SOLVER_ADDRESS: undefined,
    },
    () => {
      const config = configuredRoutes();
      assert.equal(config.error, undefined);
      assert.equal(config.routes[0].configured, false);
    },
  );
});

test("optional solver configuration accepts omission but rejects invalid JSON types", () => {
  for (const solver of [false, 0, null, {}, [], "bad"])
    assert.throws(() => parseRoutes(JSON.stringify([{ ...route, solver }])));
  assert.equal(parseRoutes(JSON.stringify([route]))[0].solver, undefined);
  assert.equal(
    parseRoutes(JSON.stringify([{ ...route, solver: wallet }]))[0].solver,
    wallet,
  );
});

test("a different website cannot reset local fixture balances", async () => {
  const previousLocal = process.env.NEXT_PUBLIC_ENABLE_LOCAL;
  const previousNetlify = process.env.NETLIFY;
  process.env.NEXT_PUBLIC_ENABLE_LOCAL = "true";
  delete process.env.NETLIFY;
  try {
    const blockedHeaders: HeadersInit[] = [
      { origin: "https://unrelated.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of blockedHeaders) {
      const response = await POST(
        new Request("http://127.0.0.1:3000/api/local/fund", {
          method: "POST",
          headers,
          body: JSON.stringify({ address: wallet, chainId: 31337 }),
        }),
      );
      assert.equal(response.status, 403);
    }
    // Malformed input verifies same-origin and script requests pass the origin
    // boundary without requiring any Anvil node or changing a balance.
    for (const headers of [{ origin: "http://127.0.0.1:3000" }, undefined]) {
      const response = await POST(
        new Request("http://127.0.0.1:3000/api/local/fund", {
          method: "POST",
          headers,
          body: "{}",
        }),
      );
      assert.equal(response.status, 400);
    }
  } finally {
    if (previousLocal === undefined)
      delete process.env.NEXT_PUBLIC_ENABLE_LOCAL;
    else process.env.NEXT_PUBLIC_ENABLE_LOCAL = previousLocal;
    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
  }
});
