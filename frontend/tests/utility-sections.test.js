import assert from "node:assert/strict";
import test from "node:test";

import {
  bindUtilitySectionToggle,
  isUtilitySectionExpanded,
  setUtilitySectionExpanded,
} from "../dist/assets/utility-sections.js";

class MockButton {
  constructor(expanded = "false") {
    this.attributes = new Map([["aria-expanded", expanded]]);
    this.clickListener = null;
  }

  addEventListener(type, listener) {
    if (type === "click") {
      this.clickListener = listener;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  click() {
    this.clickListener?.();
  }
}

class MockPanel {
  constructor() {
    this.hidden = false;
    this.tokens = new Set();
    this.classList = {
      toggle: (token, force) => {
        if (force) {
          this.tokens.add(token);
          return;
        }
        this.tokens.delete(token);
      },
    };
  }
}

test("setUtilitySectionExpanded keeps aria-expanded and visibility in sync", () => {
  const button = new MockButton();
  const panel = new MockPanel();

  setUtilitySectionExpanded(button, panel, true);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.ok(panel.tokens.has("is-expanded"));

  setUtilitySectionExpanded(button, panel, false);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.ok(!panel.tokens.has("is-expanded"));
});

test("bindUtilitySectionToggle normalizes collapsed defaults and toggles on click", () => {
  const button = new MockButton("false");
  const panel = new MockPanel();

  bindUtilitySectionToggle(button, panel);
  assert.equal(isUtilitySectionExpanded(button), false);
  assert.equal(panel.hidden, true);

  button.click();
  assert.equal(isUtilitySectionExpanded(button), true);
  assert.equal(panel.hidden, false);
  assert.ok(panel.tokens.has("is-expanded"));

  button.click();
  assert.equal(isUtilitySectionExpanded(button), false);
  assert.equal(panel.hidden, true);
});
