import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built sidebar utilities render as collapsed disclosures by default", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  for (const section of [
    ["environmentSectionToggle", "environmentSection"],
    ["helperSectionToggle", "helperSection"],
    ["importSectionToggle", "importSection"],
    ["pluginSectionToggle", "pluginSection"],
  ]) {
    const [toggleId, panelId] = section;
    const togglePattern = new RegExp(
      `id="${toggleId}"[\\s\\S]*?aria-expanded="false"[\\s\\S]*?aria-controls="${panelId}"`,
    );
    const panelPattern = new RegExp(`id="${panelId}"[^>]*data-utility-panel[^>]*hidden`);

    assert.match(html, togglePattern);
    assert.match(html, panelPattern);
  }
});

test("effective aggregation status lives in the plugin utility panel instead of the request workbench", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const pluginSectionMatch = html.match(/<div id="pluginSection"[\s\S]*?<\/div>\s*<\/section>/);
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(pluginSectionMatch, "plugin utility panel should exist");
  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(pluginSectionMatch[0], /id="effectiveAggregationText"/);
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="effectiveAggregationText"/);
});
