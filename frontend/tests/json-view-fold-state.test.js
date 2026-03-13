import assert from "node:assert/strict";
import test from "node:test";

import { renderJSONText } from "../dist/assets/json-view.js";

class FakeNode {
  parentNode = null;
}

class FakeTextNode extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this._text = text;
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.tokens = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      if (token) {
        this.tokens.add(token);
      }
    }
  }

  setFromString(value) {
    this.tokens = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  toString() {
    return [...this.tokens].join(" ");
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.childNodes = [];
    this._textContent = "";
    this._classList = new FakeClassList(this);
    this.open = false;
  }

  get classList() {
    return this._classList;
  }

  get className() {
    return this._classList.toString();
  }

  set className(value) {
    this._classList.setFromString(value);
  }

  get textContent() {
    if (this.childNodes.length === 0) {
      return this._textContent;
    }
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this.childNodes = [];
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    this._textContent = "";
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      if (typeof node === "string") {
        this.appendChild(new FakeTextNode(node));
        return;
      }
      this.appendChild(node);
    });
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  get childElementCount() {
    return this.childNodes.filter((child) => child instanceof FakeElement).length;
  }

  querySelectorAll(selector) {
    const expectedTag = selector.toUpperCase();
    const matches = [];
    const visit = (node) => {
      if (!(node instanceof FakeElement)) {
        return;
      }
      for (const child of node.childNodes) {
        if (child instanceof FakeElement) {
          if (child.tagName === expectedTag) {
            matches.push(child);
          }
          visit(child);
        }
      }
    };
    visit(this);
    return matches;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }
}

test("renderJSONText preserves fold state across rerenders and invalid JSON", () => {
  const originalDocument = globalThis.document;
  globalThis.document = new FakeDocument();

  try {
    const container = document.createElement("div");
    let controller = renderJSONText(container, '{"a":{"b":1},"c":{"d":2}}', { expandDepth: 2 });

    assert.equal(controller.hasJSON, true);
    controller.collapseAll();
    const collapsedState = controller.captureFoldState();
    assert.deepEqual(collapsedState, {
      $: true,
      "$/a": false,
      "$/c": false,
    });

    controller = renderJSONText(container, '{"a":{"b":1},"c":{"d":2},"e":3}', {
      expandDepth: 2,
      foldState: collapsedState,
    });
    assert.deepEqual(controller.captureFoldState(), collapsedState);

    const invalidController = renderJSONText(container, '{"a"', {
      expandDepth: 2,
      foldState: collapsedState,
    });
    assert.equal(invalidController.hasJSON, false);

    controller = renderJSONText(container, '{"a":{"b":1},"c":{"d":2},"e":{"f":4}}', {
      expandDepth: 2,
      foldState: collapsedState,
    });
    const restoredState = controller.captureFoldState();
    assert.equal(restoredState.$, true);
    assert.equal(restoredState["$/a"], false);
    assert.equal(restoredState["$/c"], false);
    assert.equal(restoredState["$/e"], true);
  } finally {
    globalThis.document = originalDocument;
  }
});
