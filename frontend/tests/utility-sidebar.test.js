import assert from "node:assert/strict";
import test from "node:test";

import {
  applyUtilitySidebarCollapsedState,
  normalizeUtilitySidebarCollapsed,
} from "../dist/assets/utility-sidebar.js";

class MockRoot {
  constructor() {
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class MockSidebar {
  constructor() {
    this.hidden = false;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

test("normalizeUtilitySidebarCollapsed defaults to a collapsed sidebar", () => {
  assert.equal(normalizeUtilitySidebarCollapsed(true), true);
  assert.equal(normalizeUtilitySidebarCollapsed(false), false);
  assert.equal(normalizeUtilitySidebarCollapsed(undefined), true);
  assert.equal(normalizeUtilitySidebarCollapsed("false"), true);
});

test("applyUtilitySidebarCollapsedState syncs layout and accessibility state", () => {
  const root = new MockRoot();
  const sidebar = new MockSidebar();

  applyUtilitySidebarCollapsedState(root, sidebar, true);
  assert.equal(root.getAttribute("data-utilities-collapsed"), "true");
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");

  applyUtilitySidebarCollapsedState(root, sidebar, false);
  assert.equal(root.getAttribute("data-utilities-collapsed"), "false");
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.getAttribute("aria-hidden"), null);
});
