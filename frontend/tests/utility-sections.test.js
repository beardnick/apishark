import assert from "node:assert/strict";
import test from "node:test";

import {
  createUtilitySectionController,
  setUtilitySectionActive,
} from "../dist/assets/utility-sections.js";

class MockButton {
  constructor() {
    this.attributes = new Map([["aria-expanded", "false"]]);
    this.clickListener = null;
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

test("setUtilitySectionActive keeps aria-expanded and visibility in sync", () => {
  const button = new MockButton();
  const panel = new MockPanel();

  setUtilitySectionActive(button, panel, true);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.ok(button.tokens.has("is-active"));
  assert.ok(panel.tokens.has("is-active"));

  setUtilitySectionActive(button, panel, false);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.ok(!button.tokens.has("is-active"));
  assert.ok(!panel.tokens.has("is-active"));
});

test("createUtilitySectionController keeps one panel active and toggles back to rail-only", () => {
  const environmentButton = new MockButton();
  const environmentPanel = new MockPanel();
  const importButton = new MockButton();
  const importPanel = new MockPanel();

  const controller = createUtilitySectionController([
    {
      button: environmentButton,
      panel: environmentPanel,
      panelId: "environmentUtility",
    },
    {
      button: importButton,
      panel: importPanel,
      panelId: "importUtility",
    },
  ]);

  assert.equal(controller.getActivePanelId(), null);
  assert.equal(environmentPanel.hidden, true);
  assert.equal(importPanel.hidden, true);

  environmentButton.click();
  assert.equal(controller.getActivePanelId(), "environmentUtility");
  assert.equal(environmentPanel.hidden, false);
  assert.equal(importPanel.hidden, true);

  importButton.click();
  assert.equal(controller.getActivePanelId(), "importUtility");
  assert.equal(environmentPanel.hidden, true);
  assert.equal(importPanel.hidden, false);

  importButton.click();
  assert.equal(controller.getActivePanelId(), null);
  assert.equal(importPanel.hidden, true);

  controller.setActivePanel("environmentUtility");
  assert.equal(controller.getActivePanelId(), "environmentUtility");
  assert.equal(environmentPanel.hidden, false);
});
