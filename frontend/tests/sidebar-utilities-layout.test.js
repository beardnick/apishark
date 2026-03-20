import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built sidebar utilities render as a collapsed slim rail driven by rail buttons", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(
    html,
    /<html lang="en" data-utilities-collapsed="true" data-active-utility="environmentUtility">/,
  );
  assert.match(html, /id="appUtilitySidebar"/);
  assert.match(html, /id="appUtilitySidebarBody" class="pm-sidebar-body" hidden/);
  assert.doesNotMatch(html, /utilitySidebarToggle/);
  assert.doesNotMatch(html, /Show utilities/);
  assert.doesNotMatch(html, /Hide utilities/);
  assert.match(html, /activeUtilityPanelId/);

  for (const section of [
    ["environmentRailBtn", "environmentUtility"],
    ["helperRailBtn", "helperUtility"],
    ["importRailBtn", "importUtility"],
    ["pluginRailBtn", "pluginUtility"],
  ]) {
    const [toggleId, panelId] = section;
    const togglePattern = new RegExp(
      `id="${toggleId}"[\\s\\S]*?aria-controls="${panelId}"[\\s\\S]*?data-utility-target="${panelId}"[\\s\\S]*?aria-expanded="false"`,
    );
    const panelPattern = new RegExp(
      `id="${panelId}"[^>]*data-utility-panel[^>]*aria-labelledby="${toggleId}"[^>]*aria-hidden="true"[^>]*hidden`,
    );

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

test("utility panels render as drawer-style shells with helper token snippets", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /class="utility-section-panel drawer-panel"/);
  assert.match(html, /class="helper-token-grid"/);
  assert.match(html, /class="helper-token">\{\{VAR_NAME\}\}<\/code>/);
  assert.match(html, /class="utility-action-row"/);
});

test("effective aggregation status lives in the plugin utility panel instead of the request workbench", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const pluginSectionMatch = html.match(/<section[\s\S]*?id="pluginUtility"[\s\S]*?<\/section>/);
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(pluginSectionMatch, "plugin utility panel should exist");
  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(pluginSectionMatch[0], /id="effectiveAggregationText"/);
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="effectiveAggregationText"/);
});

test("curl export uses a compact overlay instead of an inline request workbench panel", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(
    html,
    /id="exportCurlBtn"[\s\S]*?aria-controls="curlExportOverlay"[\s\S]*?aria-expanded="false"[\s\S]*?aria-haspopup="dialog"/,
  );
  assert.match(
    html,
    /<div[\s\S]*?id="curlExportOverlay"[\s\S]*?hidden[\s\S]*?<section[\s\S]*?class="curl-export-card"[\s\S]*?id="copyExportCurlBtn"[\s\S]*?id="curlExportOutput"/,
  );
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="curlExportPanel"/);
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="curlExportOverlay"/);
  assert.doesNotMatch(requestWorkbenchMatch[0], /id="curlExportOutput"/);
});

test("environment and import tools use dedicated modal overlays", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /id="openEnvironmentModalBtn"/);
  assert.match(html, /id="environmentOverlay"[\s\S]*?class="utility-modal-card"/);
  assert.match(html, /id="environmentSelect"/);
  assert.match(html, /id="openImportModalFromSidebarBtn"/);
  assert.match(
    html,
    /id="openImportModalBtn"[\s\S]*?aria-controls="importCurlOverlay"[\s\S]*?aria-expanded="false"/,
  );
  assert.match(html, /id="importCurlOverlay"[\s\S]*?class="utility-modal-card"/);
});

test("request workspace topbar stays compact without descriptive chrome", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const topbarMatch = html.match(/<header class="pm-topbar">[\s\S]*?<\/header>/);

  assert.ok(topbarMatch, "request workspace topbar should exist");
  assert.match(topbarMatch[0], /class="workspace-kicker">HTTP workspace<\/span>/);
  assert.match(topbarMatch[0], /class="topbar-label">Request<\/label>/);
  assert.match(topbarMatch[0], /id="requestNameInput"/);
  assert.doesNotMatch(topbarMatch[0], /Stream-aware request builder/);
  assert.doesNotMatch(topbarMatch[0], /utilitySidebarToggle/);
});

test("request workspace keeps a grid-style control strip for request settings", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(requestWorkbenchMatch[0], /class="request-tool-grid"/);
  assert.match(requestWorkbenchMatch[0], /class="request-tool-grid-head"/);
  assert.match(requestWorkbenchMatch[0], /class="workspace-row workspace-row-request"/);
  assert.match(requestWorkbenchMatch[0], /class="workspace-row workspace-row-meta"/);
  assert.match(requestWorkbenchMatch[0], /class="request-meta-label">Aggregation<\/span>/);
  assert.match(requestWorkbenchMatch[0], /class="request-meta-label">Timeout \(seconds\)<\/span>/);
});

test("headers panel keeps a compact table-style heading", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const headersPanelMatch = html.match(/<section id="headersPanel"[\s\S]*?<\/section>/);

  assert.ok(headersPanelMatch, "headers panel should exist");
  assert.match(headersPanelMatch[0], /class="panel-head headers-panel-head"/);
  assert.match(headersPanelMatch[0], /class="headers-panel-copy"/);
  assert.match(headersPanelMatch[0], /class="editor-grid-head header-grid-head"/);
  assert.match(html, /id="headerContextMenu"/);
  assert.doesNotMatch(headersPanelMatch[0], />Actions<\/span>/);
});

test("response workspace keeps a summary strip and grid-aligned headers panel", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const responseWorkbenchMatch = html.match(/<section id="responseWorkbench"[\s\S]*?<\/section>\s*<\/main>/);

  assert.ok(responseWorkbenchMatch, "response workbench should exist");
  assert.match(responseWorkbenchMatch[0], /class="response-status-strip"/);
  assert.match(responseWorkbenchMatch[0], /class="response-status-label">Status<\/span>/);
  assert.match(responseWorkbenchMatch[0], /class="response-status-label">Inspector<\/span>/);
  assert.match(responseWorkbenchMatch[0], /class="response-headers-grid-head"/);
  assert.match(responseWorkbenchMatch[0], /class="headers-panel-stack response-headers-stack"/);
});

test("built utility sidebar body contains only the four dedicated tool panels", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const sidebarBodyMatch = html.match(
    /<div id="appUtilitySidebarBody" class="pm-sidebar-body" hidden>[\s\S]*?<\/div>\s*<\/aside>/,
  );

  assert.ok(sidebarBodyMatch, "sidebar body should exist");
  const panelMatches = sidebarBodyMatch[0].match(/<section[^>]*data-utility-panel/g) ?? [];

  assert.equal(panelMatches.length, 4);
  assert.doesNotMatch(sidebarBodyMatch[0], /sidebar-copy/);
  assert.doesNotMatch(sidebarBodyMatch[0], /data-utility-toggle/);
});

test("main workspace exposes draggable pane dividers", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../dist/assets/main.css", import.meta.url), "utf8");
  const js = await readFile(new URL("../dist/assets/main.js", import.meta.url), "utf8");

  assert.match(html, /id="sidebarResizeHandle"[\s\S]*?data-pane-resize-handle="sidebar"/);
  assert.match(html, /id="libraryResizeHandle"[\s\S]*?data-pane-resize-handle="library"/);
  assert.match(css, /\.pane-divider\s*\{/);
  assert.match(css, /--pane-divider-size:\s*8px/);
  assert.match(js, /setupPaneResizeHandles/);
  assert.match(js, /PANE_LAYOUT_STORAGE_KEY/);
});
