import { build, context } from "esbuild";
import { cp } from "node:fs/promises";

const watchMode = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist/assets",
  minify: false,
  sourcemap: false,
  target: "es2020",
  logLevel: "info",
};

async function copyHtml() {
  await cp("src/index.html", "dist/index.html");
}

if (watchMode) {
  const ctx = await context(buildOptions);
  await copyHtml();
  await ctx.watch();
  console.log("Watching frontend files...");
} else {
  await build(buildOptions);
  await copyHtml();
}
