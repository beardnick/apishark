import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("left workspace rail keeps only popup launchers", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /id="appUtilitySidebar"/);
  assert.match(
    html,
    /id="openHelperModalBtn"[\s\S]*?aria-controls="helperOverlay"[\s\S]*?aria-expanded="false"/,
  );
  assert.match(
    html,
    /id="openPluginModalBtn"[\s\S]*?aria-controls="pluginOverlay"[\s\S]*?aria-expanded="false"/,
  );
  assert.doesNotMatch(html, /id="appUtilitySidebarBody"/);
  assert.doesNotMatch(html, /id="environmentRailBtn"/);
  assert.doesNotMatch(html, /id="importRailBtn"/);
});

test("helper, plugin, environment, import, and export all use the same modal shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  for (const overlayId of [
    "helperOverlay",
    "pluginOverlay",
    "environmentOverlay",
    "importCurlOverlay",
    "curlExportOverlay",
  ]) {
    const pattern = new RegExp(
      `id="${overlayId}"[\\s\\S]*?class="workspace-modal-overlay"[\\s\\S]*?class="workspace-modal-card`,
    );
    assert.match(html, pattern);
  }

  assert.match(html, /id="effectiveAggregationText"/);
  assert.match(html, /class="helper-token-grid"/);
  assert.match(html, /class="helper-token">\{\{VAR_NAME\}\}<\/code>/);
});

test("request topbar keeps the environment switch next to the request controls", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const topbarMatch = html.match(/<header class="pm-topbar">[\s\S]*?<\/header>/);

  assert.ok(topbarMatch, "request workspace topbar should exist");
  assert.match(topbarMatch[0], /class="workspace-kicker">HTTP workspace<\/span>/);
  assert.match(topbarMatch[0], /class="topbar-label">Request<\/label>/);
  assert.match(topbarMatch[0], /id="requestNameInput"/);
  assert.match(
    topbarMatch[0],
    /id="openEnvironmentModalBtn"[\s\S]*?aria-controls="environmentOverlay"/,
  );
});

test("request workspace keeps import and export next to request actions", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const requestWorkbenchMatch = html.match(
    /<section id="requestWorkbench"[\s\S]*?<\/section>\s*<section id="responseWorkbench"/,
  );

  assert.ok(requestWorkbenchMatch, "request workbench should exist");
  assert.match(requestWorkbenchMatch[0], /id="openImportModalBtn"/);
  assert.match(requestWorkbenchMatch[0], /id="exportCurlBtn"/);
  assert.doesNotMatch(html, /id="openImportModalFromSidebarBtn"/);
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

test("main workspace keeps a single draggable divider for the request library", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../dist/assets/main.css", import.meta.url), "utf8");
  const js = await readFile(new URL("../dist/assets/main.js", import.meta.url), "utf8");

  assert.match(html, /id="libraryResizeHandle"[\s\S]*?data-pane-resize-handle="library"/);
  assert.doesNotMatch(html, /id="sidebarResizeHandle"/);
  assert.match(css, /\.pane-divider\s*\{/);
  assert.match(js, /setupPaneResizeHandles/);
  assert.doesNotMatch(js, /sidebarResizeHandle/);
});
