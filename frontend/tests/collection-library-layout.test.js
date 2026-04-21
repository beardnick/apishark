import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built collections library exposes a request search input", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const libraryMatch = html.match(/<aside class="pm-library">[\s\S]*?<\/aside>/);

  assert.ok(libraryMatch, "collections library should exist");
  assert.match(libraryMatch[0], /id="requestSearchInput"/);
  assert.match(libraryMatch[0], /placeholder="Search"/);
  assert.ok(
    libraryMatch[0].indexOf('id="newCollectionNameInput"') <
      libraryMatch[0].indexOf('id="requestSearchInput"'),
  );
});

test("built collections library uses a request context menu instead of inline row action buttons", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /id="requestContextMenu"/);
  assert.match(html, /id="requestContextDuplicateBtn"/);
  assert.match(html, /id="requestContextDeleteBtn"/);
  assert.doesNotMatch(html, /request-delete-btn/);
});

test("built utilities render environment variables as grid rows instead of a textarea", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

  assert.match(html, /id="envEditor"/);
  assert.match(html, /class="editor-grid-head env-grid-head"/);
  assert.doesNotMatch(html, /id="envInput"/);
});

test("collections library styles keep the request list scrollable inside the sidebar", async () => {
  const css = await readFile(new URL("../dist/assets/main.css", import.meta.url), "utf8");

  assert.match(css, /\.pm-shell\s*\{[^}]*height:\s*calc\(100vh - 24px\)/);
  assert.match(css, /\.pm-main\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.pm-main\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.pm-library\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.pm-library\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.pm-sidebar,\s*\.pm-main,\s*\.pm-library\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.collections-list\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.collections-list\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(css, /\.collections-list\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.env-editor\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.body-code-editor \.cm-template-env\s*\{/);
  assert.match(css, /\.body-code-editor \.cm-template-dynamic\s*\{/);
});

test("built runtime keeps collection collapse controls and persisted collapse state", async () => {
  const js = await readFile(new URL("../dist/assets/main.js", import.meta.url), "utf8");

  assert.match(js, /collection-collapse-btn/);
  assert.match(js, /collapsedCollectionIds/);
  assert.match(js, /toggleCollectionCollapsed/);
  assert.match(js, /collectRequestSearchValues/);
  assert.match(js, /body_fields/);
  assert.match(js, /showRequestContextMenu/);
  assert.match(js, /duplicateSavedRequest/);
});
