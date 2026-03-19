import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built collections library exposes a request search input", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const libraryMatch = html.match(/<aside class="pm-library">[\s\S]*?<\/aside>/);

  assert.ok(libraryMatch, "collections library should exist");
  assert.match(libraryMatch[0], /id="requestSearchInput"/);
  assert.match(libraryMatch[0], /placeholder="Search requests"/);
  assert.ok(
    libraryMatch[0].indexOf('id="newCollectionNameInput"') <
      libraryMatch[0].indexOf('id="requestSearchInput"'),
  );
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
});

test("built runtime keeps collection collapse controls and persisted collapse state", async () => {
  const js = await readFile(new URL("../dist/assets/main.js", import.meta.url), "utf8");

  assert.match(js, /collection-collapse-btn/);
  assert.match(js, /collapsedCollectionIds/);
  assert.match(js, /toggleCollectionCollapsed/);
});
