import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("body editor styles wrap long lines and keep the editor height bounded", async () => {
  const css = await readFile(new URL("../dist/assets/main.css", import.meta.url), "utf8");

  assert.match(css, /\.body-editor-frame\s*\{[^}]*height:\s*clamp\(240px,\s*36vh,\s*420px\)/);
  assert.match(css, /\.body-code-editor \.cm-content,\s*\.body-code-editor \.cm-line\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /\.body-code-editor \.cm-content,\s*\.body-code-editor \.cm-line\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.body-code-editor \.cm-scroller\s*\{[^}]*overflow:\s*auto/);
});
