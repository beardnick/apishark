import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built body panel keeps a single editor shell with inline JSON tools", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /<section id="bodyPanel"[\s\S]*?<div id="bodyEditorShell" class="body-editor-shell">/);
  assert.match(html, /<div id="bodyEditorShell"[\s\S]*?<textarea\s+id="bodyInput"/);
  assert.match(html, /<div id="bodyEditorShell"[\s\S]*?id="bodyJsonViewer"/);
  assert.match(html, /id="copyBodyBtn"/);
  assert.match(html, /id="bodyPrettifyBtn"/);
  assert.match(html, /id="bodyCollapseBtn"/);
  assert.match(html, /id="bodyExpandBtn"/);

  assert.doesNotMatch(html, /id="bodyJsonPanel"/);
  assert.doesNotMatch(html, /id="bodyJsonPreview"/);
  assert.doesNotMatch(html, /id="bodyJsonMeta"/);
});
