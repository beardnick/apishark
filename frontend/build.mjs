import { cp, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { spawn } from "node:child_process";

const watchMode = process.argv.includes("--watch");
const tscBin = "./node_modules/typescript/lib/tsc.js";

async function copyAssets() {
  await mkdir("dist/assets", { recursive: true });
  await cp("src/index.html", "dist/index.html");
  await cp("src/styles.css", "dist/assets/main.css");
}

function runTsc(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscBin, ...args], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tsc exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function buildOnce() {
  await copyAssets();
  await runTsc(["-p", "tsconfig.build.json"]);
}

async function main() {
  if (!watchMode) {
    await buildOnce();
    return;
  }

  await copyAssets();
  watch("src/index.html", async () => {
    await copyAssets();
  });
  watch("src/styles.css", async () => {
    await copyAssets();
  });

  await runTsc(["-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"]);
}

await main();
