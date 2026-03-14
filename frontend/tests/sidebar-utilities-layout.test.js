import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built sidebar utilities render as collapsed disclosures by default", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="en" data-utilities-collapsed="true">/);
  assert.match(html, /id="appUtilitySidebar"/);
  assert.match(
    html,
    /id="utilitySidebarToggle"[\s\S]*?aria-controls="appUtilitySidebar"[\s\S]*?aria-expanded="false"/,
  );
  assert.match(html, /id="utilitySidebarToggleText">Show utilities<\/span>/);
  assert.match(html, /sidebarCollapsed/);

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

test("utility section headers stay single-line and omit collapsed helper copy", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  for (const [toggleId, title] of [
    ["environmentSectionToggle", "Environments"],
    ["helperSectionToggle", "Variable helpers"],
    ["importSectionToggle", "Import with cURL"],
    ["pluginSectionToggle", "Aggregation plugins"],
  ]) {
    const buttonMatch = html.match(new RegExp(`<button[^>]*id="${toggleId}"[\\s\\S]*?<\\/button>`));
    assert.ok(buttonMatch, `${toggleId} should exist`);
    assert.match(buttonMatch[0], new RegExp(`class="utility-section-title">${title}</span>`));
    assert.match(buttonMatch[0], /class="utility-section-chevron"/);
    assert.doesNotMatch(buttonMatch[0], /utility-section-caption/);
  }

  assert.doesNotMatch(html, /Open only the helpers you need and keep the request editor centered/);
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
