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

class MockToggle {
  constructor() {
    this.attributes = new Map();
    this.ariaLabel = "";
    this.title = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class MockLabel {
  constructor() {
    this.textContent = null;
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
  const toggle = new MockToggle();
  const label = new MockLabel();

  applyUtilitySidebarCollapsedState(root, sidebar, toggle, label, true);
  assert.equal(root.getAttribute("data-utilities-collapsed"), "true");
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.ariaLabel, "Show utilities");
  assert.equal(toggle.title, "Show utilities");
  assert.equal(label.textContent, "Show utilities");

  applyUtilitySidebarCollapsedState(root, sidebar, toggle, label, false);
  assert.equal(root.getAttribute("data-utilities-collapsed"), "false");
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.getAttribute("aria-hidden"), null);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.ariaLabel, "Hide utilities");
  assert.equal(toggle.title, "Hide utilities");
  assert.equal(label.textContent, "Hide utilities");
});
