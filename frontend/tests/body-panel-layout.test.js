import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built body panel keeps a single editor shell with inline JSON tools", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const bodyPanelMatch = html.match(/<section id="bodyPanel"[\s\S]*?<\/section>/);

  assert.ok(bodyPanelMatch, "body panel should exist");
  const bodyPanel = bodyPanelMatch[0];

  assert.match(bodyPanel, /<div id="bodyEditorShell" class="body-editor-shell">/);
  assert.match(bodyPanel, /<div id="bodyEditorShell"[\s\S]*?<textarea[\s\S]*?id="bodyInput"/);
  assert.match(bodyPanel, /<div id="bodyEditorShell"[\s\S]*?id="bodyEditor"/);
  assert.match(bodyPanel, /id="copyBodyBtn"/);
  assert.match(bodyPanel, /id="bodyPrettifyBtn"/);
  assert.match(bodyPanel, /id="bodyCollapseBtn"/);
  assert.match(bodyPanel, /id="bodyExpandBtn"/);

  assert.ok(bodyPanel.indexOf('id="bodyCollapseBtn"') < bodyPanel.indexOf('id="copyBodyBtn"'));
  assert.ok(bodyPanel.indexOf('id="bodyExpandBtn"') < bodyPanel.indexOf('id="copyBodyBtn"'));

  assert.doesNotMatch(bodyPanel, /id="bodyJsonPanel"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonPreview"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonMeta"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonViewer"/);
});
