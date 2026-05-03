import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built body panel keeps a single editor shell with visible body editor controls", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const bodyPanelMatch = html.match(/<section id="bodyPanel"[\s\S]*?<\/section>/);

  assert.ok(bodyPanelMatch, "body panel should exist");
  const bodyPanel = bodyPanelMatch[0];

  assert.match(bodyPanel, /<div id="bodyEditorShell" class="body-editor-shell">/);
  assert.match(bodyPanel, /id="bodyModeInput"/);
  assert.match(bodyPanel, /id="addBodyFieldBtn"/);
  assert.match(bodyPanel, /id="bodyFieldsPanel"/);
  assert.match(bodyPanel, /id="bodyFieldsEditor"/);
  assert.match(bodyPanel, /id="bodyEditorBanner"/);
  assert.match(bodyPanel, /id="bodyEditorModeBadge"/);
  assert.match(bodyPanel, /id="bodyEditorHint"/);
  assert.match(bodyPanel, /<div id="bodyEditorShell"[\s\S]*?<div[\s\S]*?id="bodyEditor"/);
  assert.match(bodyPanel, /<div id="bodyEditorShell"[\s\S]*?<textarea[\s\S]*?id="bodyInput"/);
  assert.match(bodyPanel, /id="bodyUndoBtn"/);
  assert.match(bodyPanel, /id="copyBodyBtn"/);
  assert.match(bodyPanel, /id="bodyPrettifyBtn"/);
  assert.match(bodyPanel, /id="bodyCollapseBtn"/);
  assert.match(bodyPanel, /id="bodyExpandBtn"/);
  assert.match(bodyPanel, /id="requestFindBar"/);
  assert.match(bodyPanel, /id="requestFindInput"/);
  assert.match(bodyPanel, /id="requestFindPrevBtn"/);
  assert.match(bodyPanel, /id="requestFindNextBtn"/);
  assert.match(bodyPanel, />\s*Collapse\s*</);
  assert.match(bodyPanel, />\s*Expand\s*</);
  assert.match(bodyPanel, />\s*Undo\s*</);
  assert.match(bodyPanel, />\s*Copy\s*</);
  assert.match(bodyPanel, />\s*Prettify\s*</);

  assert.ok(bodyPanel.indexOf('id="bodyCollapseBtn"') < bodyPanel.indexOf('id="copyBodyBtn"'));
  assert.ok(bodyPanel.indexOf('id="bodyExpandBtn"') < bodyPanel.indexOf('id="copyBodyBtn"'));
  assert.ok(bodyPanel.indexOf('id="bodyUndoBtn"') < bodyPanel.indexOf('id="copyBodyBtn"'));
  assert.ok(bodyPanel.indexOf('id="requestFindBar"') < bodyPanel.indexOf('id="bodyEditorShell"'));

  assert.doesNotMatch(bodyPanel, /id="bodyJsonPanel"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonPreview"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonMeta"/);
  assert.doesNotMatch(bodyPanel, /id="bodyJsonViewer"/);
});
