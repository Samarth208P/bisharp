import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const env = await readFile(".env", "utf8").catch(() => "");
const secrets = [
  ...env.matchAll(
    /^(?:SEPOLIA_PRIVATE_KEY|PRIVATE_KEY)\s*=\s*['"]?(0x[0-9a-fA-F]{64})/gm,
  ),
].map((m) => m[1]);
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const contents = await readFile(file);
      if (secrets.some((secret) => contents.includes(Buffer.from(secret))))
        throw new Error(`Private key found in public build asset: ${file}`);
    }
  }
}
await walk(".next/static");
console.log(
  `PASS: public build assets contain none of the ${secrets.length} locally configured deployment keys. Key values were not printed.`,
);
