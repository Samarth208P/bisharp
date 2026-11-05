import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const local = join(
  homedir(),
  ".foundry",
  "bin",
  process.platform === "win32" ? "forge.exe" : "forge",
);
const child = spawn(
  existsSync(local) ? local : "forge",
  process.argv.slice(2),
  { stdio: "inherit", windowsHide: true },
);
child.on("error", (error) => {
  console.error(`Foundry unavailable: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
