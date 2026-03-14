import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built sidebar utilities render as a collapsed slim rail by default", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(
    html,
    /<html lang="en" data-utilities-collapsed="true" data-active-utility="environmentUtility">/,
  );
  assert.match(html, /id="appUtilitySidebar"/);
  assert.match(html, /id="appUtilitySidebarBody" class="pm-sidebar-body" hidden/);
  assert.match(
    html,
    /id="utilitySidebarToggle"[\s\S]*?aria-controls="appUtilitySidebarBody"[\s\S]*?aria-expanded="false"/,
  );
  assert.match(html, /id="utilitySidebarToggleText">Show utilities<\/span>/);
  assert.match(html, /activeUtilityPanelId/);

  for (const section of [
    ["environmentRailBtn", "environmentUtility"],
    ["helperRailBtn", "helperUtility"],
    ["importRailBtn", "importUtility"],
    ["pluginRailBtn", "pluginUtility"],
  ]) {
    const [toggleId, panelId] = section;
    const togglePattern = new RegExp(
      `id="${toggleId}"[\\s\\S]*?data-utility-target="${panelId}"[\\s\\S]*?aria-expanded="false"`,
    );
    const panelPattern = new RegExp(`id="${panelId}"[^>]*data-utility-panel[^>]*hidden`);

    assert.match(html, togglePattern);
    assert.match(html, panelPattern);
  }
});

test("utility section headers stay compact without disclosure controls", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  for (const [panelId, title] of [
    ["environmentUtility", "Environments"],
    ["helperUtility", "Variable helpers"],
    ["importUtility", "Import with cURL"],
    ["pluginUtility", "Aggregation plugins"],
  ]) {
    const sectionMatch = html.match(new RegExp(`<section[^>]*id="${panelId}"[\\s\\S]*?<\\/section>`));
    assert.ok(sectionMatch, `${panelId} should exist`);
    assert.match(sectionMatch[0], new RegExp(`class="utility-section-title">${title}</span>`));
    assert.match(sectionMatch[0], /class="utility-section-head"/);
    assert.doesNotMatch(sectionMatch[0], /utility-section-chevron/);
  }

  assert.doesNotMatch(html, /Open only the helpers you need and keep the request editor centered/);
});

test("effective aggregation status lives in the plugin utility panel instead of the request workbench", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const pluginSectionMatch = html.match(/<section id="pluginUtility"[\s\S]*?<\/section>/);
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(pluginSectionMatch, "plugin utility panel should exist");
  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(pluginSectionMatch[0], /id="effectiveAggregationText"/);
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="effectiveAggregationText"/);
});
