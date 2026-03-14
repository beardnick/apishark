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
    this.attributes = new Map();
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

test("setUtilitySectionActive keeps aria-expanded and visibility in sync", () => {
  const button = new MockButton();
  const panel = new MockPanel();

  setUtilitySectionActive(button, panel, true);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute("aria-hidden"), null);
  assert.ok(button.tokens.has("is-active"));
  assert.ok(panel.tokens.has("is-active"));

  setUtilitySectionActive(button, panel, false);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  assert.ok(!button.tokens.has("is-active"));
  assert.ok(!panel.tokens.has("is-active"));
});

test("createUtilitySectionController keeps exactly one panel visible at a time", () => {
  const environmentButton = new MockButton();
  const environmentPanel = new MockPanel();
  const helperButton = new MockButton();
  const helperPanel = new MockPanel();
  const importButton = new MockButton();
  const importPanel = new MockPanel();
  const pluginButton = new MockButton();
  const pluginPanel = new MockPanel();

  const controller = createUtilitySectionController([
    {
      button: environmentButton,
      panel: environmentPanel,
      panelId: "environmentUtility",
    },
    {
      button: helperButton,
      panel: helperPanel,
      panelId: "helperUtility",
    },
    {
      button: importButton,
      panel: importPanel,
      panelId: "importUtility",
    },
    {
      button: pluginButton,
      panel: pluginPanel,
      panelId: "pluginUtility",
    },
  ]);

  const panels = [environmentPanel, helperPanel, importPanel, pluginPanel];
  const visiblePanelCount = () => panels.filter((panel) => !panel.hidden).length;

  assert.equal(controller.getActivePanelId(), null);
  assert.equal(visiblePanelCount(), 0);

  environmentButton.click();
  assert.equal(controller.getActivePanelId(), "environmentUtility");
  assert.equal(environmentPanel.hidden, false);
  assert.equal(helperPanel.hidden, true);
  assert.equal(importPanel.hidden, true);
  assert.equal(pluginPanel.hidden, true);
  assert.equal(visiblePanelCount(), 1);

  importButton.click();
  assert.equal(controller.getActivePanelId(), "importUtility");
  assert.equal(environmentPanel.hidden, true);
  assert.equal(importPanel.hidden, false);
  assert.equal(helperPanel.hidden, true);
  assert.equal(pluginPanel.hidden, true);
  assert.equal(visiblePanelCount(), 1);

  pluginButton.click();
  assert.equal(controller.getActivePanelId(), "pluginUtility");
  assert.equal(environmentPanel.hidden, true);
  assert.equal(helperPanel.hidden, true);
  assert.equal(importPanel.hidden, true);
  assert.equal(pluginPanel.hidden, false);
  assert.equal(visiblePanelCount(), 1);

  pluginButton.click();
  assert.equal(controller.getActivePanelId(), null);
  assert.equal(visiblePanelCount(), 0);

  controller.setActivePanel("environmentUtility");
  assert.equal(controller.getActivePanelId(), "environmentUtility");
  assert.equal(environmentPanel.hidden, false);
  assert.equal(visiblePanelCount(), 1);

  controller.setActivePanel("missingUtility");
  assert.equal(controller.getActivePanelId(), null);
  assert.equal(visiblePanelCount(), 0);
});
