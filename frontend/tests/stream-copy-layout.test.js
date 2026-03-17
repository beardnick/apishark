import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built SSE payload inspector exposes copy-all and copy-payload actions", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const rawPanelMatch = html.match(/<section id="responseRawPanel"[\s\S]*?<\/section>/);

  assert.ok(rawPanelMatch, "raw response panel should exist");
  const rawPanel = rawPanelMatch[0];

  assert.match(rawPanel, /id="copySseStreamBtn"/);
  assert.match(rawPanel, /id="copySsePayloadBtn"/);
  assert.ok(
    rawPanel.indexOf('id="copySseStreamBtn"') < rawPanel.indexOf('id="copySsePayloadBtn"'),
  );
  assert.ok(
    rawPanel.indexOf('id="copySsePayloadBtn"') < rawPanel.indexOf('id="ssePayloadCollapseBtn"'),
  );
});
