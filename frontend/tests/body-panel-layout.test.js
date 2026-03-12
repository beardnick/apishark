import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built body panel keeps a single textarea editor with in-place actions", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /<section id="bodyPanel"[\s\S]*?<textarea\s+id="bodyInput"/);
  assert.match(html, /id="copyBodyBtn"/);
  assert.match(html, /id="bodyPrettifyBtn"/);

  assert.doesNotMatch(html, /id="bodyJsonPanel"/);
  assert.doesNotMatch(html, /id="bodyJsonPreview"/);
  assert.doesNotMatch(html, /id="bodyJsonMeta"/);
  assert.doesNotMatch(html, /id="bodyCollapseBtn"/);
  assert.doesNotMatch(html, /id="bodyExpandBtn"/);
});
