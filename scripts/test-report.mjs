import { readFile, writeFile, mkdir } from "node:fs/promises";
const file = process.argv[2] || "deployments/local-test-results.json";
const raw = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
// Forge logs may precede --json output. Parse only the suite-result object.
const index = raw.indexOf('{"contracts/');
if (index < 0) throw new Error("No Forge suite JSON found");
const suites = JSON.parse(raw.slice(index));
const results = Object.entries(suites).flatMap(([suite, value]) =>
  Object.entries(value.test_results || {}).map(([name, result]) => ({
    suite,
    name,
    status: result.status,
    kind: result.kind.Fuzz
      ? "fuzz"
      : result.kind.Invariant
        ? "invariant"
        : "unit",
    runs: result.kind.Fuzz?.runs || result.kind.Invariant?.runs || 1,
    calls: result.kind.Invariant?.calls || 0,
  })),
);
const report = {
  seed: process.argv[3] || process.env.FOUNDRY_FUZZ_SEED || null,
  passed: results.filter((r) => r.status === "Success").length,
  failed: results.filter((r) => r.status !== "Success").length,
  fuzzCases: results
    .filter((r) => r.kind === "fuzz")
    .reduce((n, r) => n + r.runs, 0),
  invariantCalls: results.reduce((n, r) => n + r.calls, 0),
  results,
};
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/foundry-results.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    passed: report.passed,
    failed: report.failed,
    fuzzCases: report.fuzzCases,
    invariantCalls: report.invariantCalls,
  }),
);
if (report.failed) process.exitCode = 1;
